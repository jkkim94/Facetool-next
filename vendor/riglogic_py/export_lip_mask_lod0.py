# -*- coding: utf-8 -*-
"""MetaHuman Head LOD0 anatomical lip vertex mask (MH-LVE-LIP v1).

Final lip mask defined on the NEUTRAL head_lod0_mesh from the Epic identity
region UV map (T_Gray_Head_D.PNG), which explicitly paints the anatomical lip
area in UV space:

  - dark gray-brown oval  (~RGB 113-125,106-113,104-108) : vermilion lip surface
  - vivid red band        (~RGB 190,97,102)              : inner lip / closure zone
  - dark blue-gray line   (b > r)                        : oral cavity entrance (excluded)
  - warm tan ring         (r >= 140)                     : perioral skin (excluded)

The classification is keyed to mesh topology/UV (Epic-authored anatomical
region map), NOT to any facial control, satisfying requirement 4.1.

Pipeline:
  1. per-vertex region color via UV patch sampling (wireframe pixels rejected,
     median of remaining -> robust against the blue wireframe overlay drawn
     exactly through vertex texel positions)
  2. candidate = (vermilion | red) inside the mouth UV window
  3. topology cleanup: largest connected component + enclosed-hole filling
  4. subgroups: corners (3D radius at lip extremes) -> inner (red band)
     -> upper/lower outer (UV v against the closure line)

Usage:
  python export_lip_mask_lod0.py
  python export_lip_mask_lod0.py --debug-plot
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import riglogic  # noqa: E402
from bake import load_mesh_static  # noqa: E402
from gray_head_uv import DNA, REGION_TEXTURE, load_texture  # noqa: E402

PROTOCOL = "MH-LVE-LIP-v1"

# Mouth UV window (lip oval spans ~u[0.43,0.575], v[0.37,0.46])
UV_WIN = dict(u0=0.400, u1=0.600, v0=0.345, v1=0.475)
# Closure (lip contact) line in UV space — center of the red inner-lip band
SEAM_V = 0.4133
# Mouth corner radius (cm) around anatomical corner landmarks (not lip x-extremes)
CORNER_RADIUS_CM = 0.35
# DNA-verified mouth-corner landmarks (0421_V33, see vertex_index_verification.json)
LEFT_CORNER_VID = 6142   # character left (+x)
RIGHT_CORNER_VID = 40    # character right (-x)
UPPER_LIP_CENTER_VID = 12207
LOWER_LIP_CENTER_VID = 2881
LIP_ANCHOR_VIDS = (
    LEFT_CORNER_VID,
    RIGHT_CORNER_VID,
    UPPER_LIP_CENTER_VID,
    LOWER_LIP_CENTER_VID,
)
PATCH = 3  # half-size of (2*PATCH+1)^2 sampling patch
# Closure interface strips (UV-island mapped, v > 0.9): BFS rings from the lip
# set into the contact zone; deeper rings belong to the oral cavity (excluded)
CLOSURE_RINGS = 2


# ---------------------------------------------------------------- sampling

def per_vertex_region_color(tex: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Median patch color per vertex, ignoring blue wireframe pixels."""
    h, w = tex.shape[:2]
    px = np.clip((uv[:, 0] * (w - 1)).round().astype(int), PATCH, w - 1 - PATCH)
    py = np.clip(((1.0 - uv[:, 1]) * (h - 1)).round().astype(int), PATCH, h - 1 - PATCH)
    out = np.zeros((uv.shape[0], 3), np.float64)
    for i in range(uv.shape[0]):
        patch = tex[py[i] - PATCH:py[i] + PATCH + 1,
                    px[i] - PATCH:px[i] + PATCH + 1].reshape(-1, 3).astype(np.int64)
        r, g, b = patch[:, 0], patch[:, 1], patch[:, 2]
        keep = ~((b > r + 2) & (b > g + 2))  # drop blue wireframe / cavity-line pixels
        sel = patch[keep] if keep.any() else patch
        out[i] = np.median(sel, axis=0)
    return out


def classify(colors: np.ndarray) -> dict[str, np.ndarray]:
    r, g, b = colors[:, 0], colors[:, 1], colors[:, 2]
    red = (r >= 165) & (g <= 125) & (b <= 125) & ((r - g) >= 35) & ((r - b) >= 30)
    # transition rows between the red band and the cavity entrance line
    # (red blended with dark blue-gray; perioral tan rejected via g <= 110)
    blend = (~red) & (r >= 112) & (r < 165) & ((r - g) >= 22) & \
        (g >= 78) & (g <= 110) & (b >= 85) & (b <= 120)
    verm = (~red) & (~blend) & (r >= 100) & (r <= 137) & (g >= 95) & (g <= 122) & \
        (b >= 96) & (b <= 116) & ((r - g) >= 4) & ((r - g) <= 24) & (np.abs(g - b) <= 12)
    return {"red": red | blend, "verm": verm}


# ---------------------------------------------------------------- topology

def build_adjacency(tris: np.ndarray, n: int) -> list[set]:
    adj = [set() for _ in range(n)]
    for a, b, c in tris:
        a, b, c = int(a), int(b), int(c)
        adj[a].update((b, c))
        adj[b].update((a, c))
        adj[c].update((a, b))
    return adj


def connected_components(ids: np.ndarray, adj: list[set]) -> list[set]:
    in_set = set(int(i) for i in ids)
    seen: set[int] = set()
    comps = []
    for s in in_set:
        if s in seen:
            continue
        comp = {s}
        q = deque([s])
        seen.add(s)
        while q:
            v = q.popleft()
            for nb in adj[v]:
                if nb in in_set and nb not in seen:
                    seen.add(nb)
                    comp.add(nb)
                    q.append(nb)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def prune_dangling_boundary(
    lip: set,
    adj: list[set],
    *,
    max_lip_neighbors: int = 2,
    protect: set[int] | None = None,
    max_passes: int = 4,
) -> set:
    """Drop thin mesh spikes on the lip boundary (<=max_lip_neighbors lip adjacencies)."""
    protect = protect or set()
    out = set(lip)
    for _ in range(max_passes):
        remove: set[int] = set()
        for v in out:
            if v in protect:
                continue
            if not any(nb not in out for nb in adj[v]):
                continue
            lip_nb = sum(1 for nb in adj[v] if nb in out)
            if lip_nb <= max_lip_neighbors:
                remove.add(v)
        if not remove:
            break
        out -= remove
    return out


def open_mesh_window(
    lip: set,
    adj: list[set],
    pool: set,
    in_window: set[int],
    *,
    erode_rings: int = 1,
    dilate_rings: int = 1,
    protect: set[int] | None = None,
) -> set:
    """Morphological open on the main UV-window lip to trim jagged outer boundary."""
    protect = protect or set()
    sub = {v for v in lip if v in in_window}
    other = lip - sub
    out = set(sub)
    for _ in range(erode_rings):
        out -= {
            v for v in out
            if v not in protect and any(nb not in out for nb in adj[v])
        }
    for _ in range(dilate_rings):
        add: set[int] = set()
        for v in out:
            for nb in adj[v]:
                if nb in pool and nb in in_window and nb not in out:
                    add.add(nb)
        out |= add
    return other | out


def fill_surrounded_pool_vertices(
    lip: set,
    adj: list[set],
    pool: set,
    *,
    min_lip_neighbors: int = 3,
    max_passes: int = 6,
) -> set:
    """Add pool verts nearly enclosed by lip (fixes 1-vertex mesh holes)."""
    out = set(lip)
    for _ in range(max_passes):
        add: set[int] = set()
        for v in pool:
            if v in out:
                continue
            lip_nb = sum(1 for nb in adj[v] if nb in out)
            if lip_nb >= min_lip_neighbors:
                add.add(v)
        if not add:
            break
        out |= add
    return out


def fill_enclosed_holes(lip: set, window: set, adj: list[set]) -> set:
    """Non-lip components inside the UV window fully surrounded by lip -> lip."""
    non_lip = np.array(sorted(window - lip))
    if non_lip.size == 0:
        return lip
    out = set(lip)
    for comp in connected_components(non_lip, adj):
        boundary_ok = True
        touches_border = False
        for v in comp:
            for nb in adj[v]:
                if nb in out:
                    continue
                if nb in comp:
                    continue
                # neighbor outside lip and outside this hole
                touches_border = True
                break
            if touches_border:
                boundary_ok = False
                break
        if boundary_ok:
            out |= comp
    return out


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description="Export MetaHuman LOD0 anatomical lip mask")
    ap.add_argument("--dna", default=DNA)
    ap.add_argument("--texture", default=REGION_TEXTURE)
    ap.add_argument("--out", default="")
    ap.add_argument("--corner-radius-cm", type=float, default=CORNER_RADIUS_CM)
    ap.add_argument("--debug-plot", action="store_true")
    args = ap.parse_args()

    dna = Path(args.dna)
    out_path = Path(args.out) if args.out else \
        dna.parent / "lip_mask_v1" / "metahuman_head_lod0_lip_mask.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print("Loading DNA + texture ...", flush=True)
    rig = riglogic.Rig(str(dna))
    mm = load_mesh_static(rig, 0)
    pos, uv, tris, n = mm["pos"], mm["uv"], mm["tris"], int(mm["V"])
    tex = load_texture(args.texture)

    in_win = (uv[:, 0] >= UV_WIN["u0"]) & (uv[:, 0] <= UV_WIN["u1"]) & \
             (uv[:, 1] >= UV_WIN["v0"]) & (uv[:, 1] <= UV_WIN["v1"])
    win_ids = np.where(in_win)[0]
    print("UV window verts:", len(win_ids), flush=True)

    print("Patch-sampling region colors ...", flush=True)
    colors = np.zeros((n, 3))
    colors[win_ids] = per_vertex_region_color(tex, uv[win_ids])
    cls = classify(colors)
    red = set(np.where(cls["red"] & in_win)[0].tolist())
    verm = set(np.where(cls["verm"] & in_win)[0].tolist())
    print("classified: vermilion=%d red(inner)=%d" % (len(verm), len(red)), flush=True)

    adj = build_adjacency(tris, n)
    candidate = np.array(sorted(verm | red))
    comps = connected_components(candidate, adj)
    print("candidate components:", [len(c) for c in comps[:6]], flush=True)
    lip = set(comps[0])

    window = set(win_ids.tolist())
    before = len(lip)
    lip = fill_enclosed_holes(lip, window, adj)
    print("hole fill: +%d verts -> %d" % (len(lip) - before, len(lip)), flush=True)

    # Lip seam (cavity entrance line): the dark line where the closed lips part.
    # It is the anatomical inner-lip boundary -> include (requirement 7.1),
    # bounded laterally by the lip oval and spatially by the closure zone.
    r, g, b = colors[:, 0], colors[:, 1], colors[:, 2]
    dark_line = (r < 140) & (b >= g - 4)  # blue-gray cavity-line shades, not tan/skin
    seam_band = (uv[:, 1] >= SEAM_V - 0.012) & (uv[:, 1] <= SEAM_V + 0.012) & \
        in_win & dark_line & \
        (np.abs(pos[:, 0]) < 3.2) & (pos[:, 1] > 155.0) & (pos[:, 1] < 158.0) & \
        (pos[:, 2] > 8.5)
    seam_extra = [int(v) for v in np.where(seam_band)[0] if int(v) not in lip]
    if seam_extra:
        lip |= set(seam_extra)
        red |= set(seam_extra)  # closure-zone rows belong to the inner lip
        lip = set(connected_components(np.array(sorted(lip)), adj)[0])
        lip = fill_enclosed_holes(lip, window, adj)
    print("seam strip: +%d verts -> %d" % (len(seam_extra), len(lip)), flush=True)

    # Closure interface strips: the lip-contact surface rows are UV-mapped to
    # separate islands (uv.v > 0.9). Grow CLOSURE_RINGS topology rings from the
    # lip set into those islands, bounded by the lip bbox (slightly padded);
    # deeper rings transition into the oral cavity and stay excluded.
    lip_arr0 = np.array(sorted(lip))
    bx = np.abs(pos[lip_arr0, 0]).max() + 0.5
    by0, by1 = pos[lip_arr0, 1].min() - 0.10, pos[lip_arr0, 1].max() + 0.20
    bz0 = pos[lip_arr0, 2].min() - 0.35
    island_box = (uv[:, 1] > 0.9) & (np.abs(pos[:, 0]) < bx) & \
        (pos[:, 1] > by0) & (pos[:, 1] < by1) & (pos[:, 2] > bz0)
    island_set = set(np.where(island_box)[0].tolist())

    # side propagation: upper/lower inherited from the main-window lip rows
    side = {}
    for v in lip:
        side[v] = "upper" if uv[v, 1] > SEAM_V else "lower"
    closure_added: set[int] = set()
    frontier = set(lip)
    seen = set(lip)
    for _ring in range(CLOSURE_RINGS):
        nxt = {}
        for v in frontier:
            for nb in adj[v]:
                if nb not in seen and nb in island_set:
                    nxt.setdefault(nb, side[v])
        for nb, s in nxt.items():
            side[nb] = s
        seen |= set(nxt)
        closure_added |= set(nxt)
        frontier = set(nxt)
    lip |= closure_added
    red |= closure_added
    print("closure strips (%d rings): +%d verts -> %d"
          % (CLOSURE_RINGS, len(closure_added), len(lip)), flush=True)

    # ---- boundary cleanup (reduce corner/edge noise on LOD0 tessellation) ----
    candidate_pool = verm | red
    main_window_ids = {int(v) for v in win_ids if float(uv[int(v), 1]) <= 0.9}
    anchors = {v for v in LIP_ANCHOR_VIDS if v in candidate_pool}
    before_clean = len(lip)
    lip = open_mesh_window(
        lip, adj, candidate_pool, main_window_ids,
        erode_rings=1, dilate_rings=1, protect=anchors,
    )
    lip = prune_dangling_boundary(lip, adj, max_lip_neighbors=2, protect=anchors)
    lip |= anchors
    lip = fill_surrounded_pool_vertices(lip, adj, candidate_pool, min_lip_neighbors=3)
    lip = set(connected_components(np.array(sorted(lip)), adj)[0])
    lip = fill_enclosed_holes(lip, window, adj)
    lip |= anchors
    print("boundary cleanup: %d -> %d verts (anchors %d)"
          % (before_clean, len(lip), len(anchors)), flush=True)

    lip_ids = np.array(sorted(lip))
    lp = pos[lip_ids]
    lu = uv[lip_ids]

    # ---- subgroups (priority: corner > inner > outer upper/lower) ----
    left_lm = pos[LEFT_CORNER_VID]
    right_lm = pos[RIGHT_CORNER_VID]
    d_left = np.linalg.norm(lp - left_lm, axis=1)
    d_right = np.linalg.norm(lp - right_lm, axis=1)

    red_arr = np.array([int(v) in red for v in lip_ids])
    upper = np.array([side.get(int(v), "upper" if uv[int(v), 1] > SEAM_V else "lower") == "upper"
                      for v in lip_ids])

    grp = np.full(len(lip_ids), "", dtype=object)
    grp[upper] = "upper_outer_lip"
    grp[~upper] = "lower_outer_lip"
    grp[red_arr & upper] = "upper_inner_lip"
    grp[red_arr & ~upper] = "lower_inner_lip"
    # corners: landmark ball on outer lip only (inner red band stays separate)
    outer = (grp == "upper_outer_lip") | (grp == "lower_outer_lip")
    is_corner_l = (d_left <= args.corner_radius_cm) & outer
    is_corner_r = (d_right <= args.corner_radius_cm) & outer
    grp[is_corner_l] = "left_mouth_corner"
    grp[is_corner_r] = "right_mouth_corner"

    groups = {}
    for name in ("upper_outer_lip", "lower_outer_lip", "upper_inner_lip",
                 "lower_inner_lip", "left_mouth_corner", "right_mouth_corner"):
        groups[name] = sorted(int(v) for v in lip_ids[grp == name])
        print("  %-20s %5d" % (name, len(groups[name])), flush=True)
    all_lip = sorted(int(v) for v in lip_ids)
    print("  %-20s %5d / %d (%.2f%%)" % ("all_lip", len(all_lip), n,
                                         100.0 * len(all_lip) / n), flush=True)

    payload = {
        "metadata": {
            "protocol": PROTOCOL,
            "character_name": dna.parent.name,
            "mesh_name": "head_lod0_mesh",
            "mesh_index": 0,
            "lod": 0,
            "source": "MetaHuman Head LOD0 neutral mesh",
            "coordinate_source": "head.dna via riglogic API (DNA-verified vertex order)",
            "region_definition_source":
                "Epic identity region UV map T_Gray_Head_D.PNG "
                "(anatomical lip area painted in UV space) + mesh topology cleanup",
            "vertex_index_base": 0,
            "total_head_vertex_count": n,
            "dna": str(dna.resolve()),
            "texture": str(Path(args.texture).resolve()),
            "uv_window": UV_WIN,
            "seam_uv_v": SEAM_V,
            "corner_radius_cm": args.corner_radius_cm,
            "corner_landmarks": {
                "left_mouth_corner": LEFT_CORNER_VID,
                "right_mouth_corner": RIGHT_CORNER_VID,
            },
            "closure_rings": CLOSURE_RINGS,
            "boundary_cleanup": "mesh open (1,1) on UV window + dangling spike prune",
            "created_by": "automated pipeline (export_lip_mask_lod0.py) + visual review",
            "created_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "version": "v1.2",
        },
        "lip_vertices": groups,
        "combined": {"all_lip": all_lip},
        "statistics": {
            "all_lip_count": len(all_lip),
            "group_counts": {k: len(v) for k, v in groups.items()},
            "lip_ratio_of_head": round(len(all_lip) / n, 6),
            "upper_count": len(groups["upper_outer_lip"]) + len(groups["upper_inner_lip"]),
            "lower_count": len(groups["lower_outer_lip"]) + len(groups["lower_inner_lip"]),
            "corner_count": len(groups["left_mouth_corner"]) + len(groups["right_mouth_corner"]),
            "position_bbox_cm": {
                "x": [round(float(lp[:, 0].min()), 4), round(float(lp[:, 0].max()), 4)],
                "y": [round(float(lp[:, 1].min()), 4), round(float(lp[:, 1].max()), 4)],
                "z": [round(float(lp[:, 2].min()), 4), round(float(lp[:, 2].max()), 4)],
            },
        },
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("Wrote:", out_path, flush=True)

    if args.debug_plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axes = plt.subplots(1, 2, figsize=(20, 9))
        palette = {
            "upper_outer_lip": "#e6552e", "lower_outer_lip": "#2e7de6",
            "upper_inner_lip": "#f2c230", "lower_inner_lip": "#34c46e",
            "left_mouth_corner": "#c637c1", "right_mouth_corner": "#13c2c2",
        }
        for ax, (cx, cy, title) in zip(
                axes, [(uv[:, 0], uv[:, 1], "UV space"),
                       (pos[:, 0], pos[:, 1], "front view (x/y)")]):
            ax.scatter(cx[win_ids], cy[win_ids], s=2, c="#cccccc")
            for name, ids in groups.items():
                ids = np.array(ids, int)
                ax.scatter(cx[ids], cy[ids], s=4, c=palette[name], label=name)
            ax.set_title(title)
            ax.set_aspect("equal")
            ax.legend(markerscale=3, fontsize=8)
        dbg = out_path.parent / "_debug_lip_mask.png"
        fig.tight_layout()
        fig.savefig(dbg, dpi=110)
        print("debug plot:", dbg, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
