# -*- coding: utf-8 -*-
"""Render preview images of a vertex mask on the MetaHuman Head LOD0 mesh.

Painter's-algorithm software rasterizer (matplotlib PolyCollection):
loads head_lod0_mesh from the DNA, colors faces by mask subgroup, renders
front / left45 / right45 / mouth close-up views.

Usage:
  python mask_preview_script.py --mask E:\\...\\metahuman_head_lod0_lip_mask.json
  python mask_preview_script.py --mask mask.json --flat-ids   # single-color id list masks
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import riglogic  # noqa: E402
from bake import load_mesh_static  # noqa: E402

DEFAULT_DNA = r"E:\Viewer\DNA\0421_V33\head.dna"

SKIN = np.array([0.80, 0.72, 0.66])
GROUP_COLORS = {
    "upper_outer_lip": (0.90, 0.25, 0.10),
    "lower_outer_lip": (0.15, 0.45, 0.95),
    "upper_inner_lip": (0.95, 0.78, 0.10),
    "lower_inner_lip": (0.15, 0.80, 0.40),
    "left_mouth_corner": (0.80, 0.15, 0.80),
    "right_mouth_corner": (0.05, 0.78, 0.78),
    "_flat": (0.90, 0.15, 0.15),
}


def rot_y(deg: float) -> np.ndarray:
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(deg: float) -> np.ndarray:
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def render(ax, pos, tris, vert_colors, yaw=0.0, pitch=0.0,
           center=None, half_w=None, half_h=None):
    """Orthographic painter's render. View looks down -z after rotation."""
    R = rot_x(pitch) @ rot_y(yaw)
    p = (pos - pos.mean(axis=0)) @ R.T
    v0, v1, v2 = p[tris[:, 0]], p[tris[:, 1]], p[tris[:, 2]]
    nrm = np.cross(v1 - v0, v2 - v0)
    nlen = np.linalg.norm(nrm, axis=1, keepdims=True)
    nlen[nlen == 0] = 1
    nrm = nrm / nlen
    front = nrm[:, 2] > 0.0

    if center is not None:
        c = (np.asarray(center) - pos.mean(axis=0)) @ R.T
        cx, cy = c[0], c[1]
    else:
        cx = cy = None

    # render ALL faces, painter-sorted; backfaces shaded dark so interior
    # gaps (e.g. the slightly open lip seam) don't read as background
    depth = (v0[:, 2] + v1[:, 2] + v2[:, 2]) / 3.0
    order = np.argsort(depth)
    tf = tris[order]
    nf = nrm[order]
    is_front = front[order]

    light = np.array([0.3, 0.4, 0.85])
    light = light / np.linalg.norm(light)
    lam = np.clip(nf @ light, 0.0, 1.0) * 0.65 + 0.35

    fcol = vert_colors[tf].mean(axis=1) * lam[:, None]
    fcol[~is_front] = np.array([0.22, 0.20, 0.20])
    verts2d = p[:, :2][tf]
    coll = PolyCollection(verts2d, facecolors=np.clip(fcol, 0, 1),
                          edgecolors="none", antialiaseds=False)
    ax.add_collection(coll)

    if cx is not None and half_w is not None:
        ax.set_xlim(cx - half_w, cx + half_w)
        ax.set_ylim(cy - half_h, cy + half_h)
    else:
        ax.set_xlim(p[:, 0].min() - 1, p[:, 0].max() + 1)
        ax.set_ylim(p[:, 1].min() - 1, p[:, 1].max() + 1)
    ax.set_aspect("equal")
    ax.axis("off")


def load_mask_groups(mask_path: Path, flat: bool):
    data = json.loads(mask_path.read_text(encoding="utf-8"))
    groups = {}
    if not flat and isinstance(data.get("lip_vertices"), dict):
        for k, v in data["lip_vertices"].items():
            if isinstance(v, list) and v:
                groups[k] = np.asarray(v, int)
    else:
        ids = (data.get("combined", {}).get("all_lip")
               or data.get("vertex_ids") or data.get("lip_vertex_ids")
               or data.get("ids") or [])
        groups["_flat"] = np.asarray(ids, int)
    return data, groups


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mask", required=True)
    ap.add_argument("--dna", default=DEFAULT_DNA)
    ap.add_argument("--flat-ids", action="store_true",
                    help="treat mask as a flat id list (single color)")
    ap.add_argument("--prefix", default="",
                    help="output filename prefix (default: mask filename stem)")
    ap.add_argument("--out-dir", default="", help="default: alongside mask json")
    args = ap.parse_args()

    mask_path = Path(args.mask)
    out_dir = Path(args.out_dir) if args.out_dir else mask_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or mask_path.stem

    rig = riglogic.Rig(args.dna)
    mm = load_mesh_static(rig, 0)
    pos, tris, n = mm["pos"], mm["tris"], int(mm["V"])

    data, groups = load_mask_groups(mask_path, args.flat_ids)
    vert_colors = np.tile(SKIN, (n, 1))
    legend = []
    for name, ids in groups.items():
        col = GROUP_COLORS.get(name, GROUP_COLORS["_flat"])
        vert_colors[ids] = col
        legend.append((name, col, len(ids)))

    all_ids = np.unique(np.concatenate(list(groups.values())))
    mouth_center = pos[all_ids].mean(axis=0)
    mouth_half_w = max(np.abs(pos[all_ids, 0] - mouth_center[0]).max() * 1.9, 3.2)
    mouth_half_h = mouth_half_w * 0.62

    views = [
        ("front", dict(yaw=0)),
        ("left45", dict(yaw=-45)),
        ("right45", dict(yaw=45)),
        ("closeup", dict(yaw=0, center=mouth_center,
                         half_w=mouth_half_w, half_h=mouth_half_h)),
    ]
    for vname, kw in views:
        fig, ax = plt.subplots(figsize=(10, 11))
        render(ax, pos, tris, vert_colors, **kw)
        handles = [plt.Line2D([0], [0], marker="s", linestyle="", markersize=9,
                              markerfacecolor=c, label="%s (%d)" % (nm, cnt))
                   for nm, c, cnt in legend]
        ax.legend(handles=handles, loc="lower right", fontsize=8, framealpha=0.85)
        out = out_dir / ("%s_preview_%s.png" % (prefix, vname))
        fig.tight_layout()
        fig.savefig(out, dpi=120, facecolor="white")
        plt.close(fig)
        print("wrote", out, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
