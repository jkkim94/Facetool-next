# -*- coding: utf-8 -*-
"""MetaHuman Lip Vertex Region (MH-LVR) — reproducible lip mask for LVE-style metrics.

Motivation
----------
Academic LVE uses FLAME/BIWI ``lve.txt`` on a fixed topology. MetaHuman DNA has no
equivalent. This script defines a **documented, reproducible** lip vertex set on
the FaceModel combined head mesh (LOD1).

Protocol MH-LVR v1
------------------
Given DNA path and LOD:

1. **Speech control set S** — MetaHuman raw controls whose names match
   ``jaw*`` or ``mouth*``, excluding cheek/teeth/throat helpers
   (``mouthCheek*``, ``mouthTeeth*``, ``mouthThroat*``).

2. **V_bs** — Union of ``blend_shape_target_vertex_indices`` for every BS channel
   that receives non-zero weight when any control in S is set to 1.0
   (single-control perturbation, others 0).

3. **V_motion** — Union of vertices with L2 displacement > ``motion_eps_cm``
   (same perturbation protocol).

4. **V_geo** — Vertices within ``geo_radius_cm`` (Euclidean, cm) of the centroid
   of neutral positions of V_bs on the combined head mesh.

5. **Final mask M** — ``(V_bs | V_motion) & V_geo`` (speech BS support, motion-
   confirmed, locally bounded around the mouth).

6. **Validation** (optional NPY clip) — ratio of frame-to-frame motion energy
   inside M vs outside M; higher is better for a lip-only mask.

Output JSON records every threshold, control list, and vertex ids for citation in
papers ("we define lip vertices following MH-LVR v1 …").

Usage
-----
  set PYTHONPATH=e:\\Viewer\\riglogic_py
  python define_lip_vertices.py --dna E:\\Viewer\\DNA\\0421_V33\\head.dna
  python define_lip_vertices.py --dna ... --npy clip.npy --columns clip.columns.txt
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# riglogic + FaceModel live in same package root
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import riglogic  # noqa: E402
from face_model import FaceModel  # noqa: E402

PROTOCOL_VERSION = "MH-LVR-v1"

# ARKit-aligned core speech controls (MetaHuman raw name suffix after CTRL_expressions_)
_CORE_SUFFIXES = [
    "jawOpen", "jawForward", "jawLeft", "jawRight",
    "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
    "mouthCornerPullL", "mouthCornerPullR",
    "mouthLipsTogetherUL", "mouthLipsTogetherUR",
    "mouthLipsTogetherDL", "mouthLipsTogetherDR",
    "mouthStretchL", "mouthStretchR",
    "mouthSmileL", "mouthSmileR",
]

# Controls excluded from the broad speech set
_EXCLUDE_RE = re.compile(
    r"(?i)(mouthCheek|mouthTeeth|mouthThroat|mouthLipsTowardsTeeth|mouthSticky)"
)


def _norm_control_name(raw_name: str) -> str:
    return raw_name.replace("CTRL_expressions.", "").replace("CTRL_expressions_", "")


def is_speech_control(raw_name: str) -> bool:
    n = _norm_control_name(raw_name)
    if _EXCLUDE_RE.search(n):
        return False
    return bool(re.match(r"(?i)(jaw|mouth)", n))


def is_core_speech_control(raw_name: str) -> bool:
    n = _norm_control_name(raw_name)
    return n in _CORE_SUFFIXES


def speech_control_indices(rig: riglogic.Rig) -> list[tuple[int, str]]:
    out = []
    for i, name in enumerate(rig.raw_control_names()):
        if is_speech_control(name):
            out.append((i, name))
    return out


def bs_vertices_for_channel(rig: riglogic.Rig, head_mesh_indices: list[int], ch: int) -> set[int]:
    """Local vertex ids (per mesh) unioned with mesh offset applied later."""
    verts: set[int] = set()
    for m in head_mesh_indices:
        for t in range(rig.blend_shape_target_count(m)):
            if rig.blend_shape_channel_index(m, t) != ch:
                continue
            for v in rig.blend_shape_target_vertex_indices(m, t):
                verts.add(int(v))
    return verts


def perturbation_masks(
    fm: FaceModel,
    controls: list[tuple[int, str]],
    motion_eps_cm: float,
) -> tuple[set[int], set[int], dict[str, set[int]]]:
    """Return (V_bs_union, V_motion_union, per_control_motion)."""
    n = fm.raw_control_count
    base = fm.eval_raw(np.zeros(n, np.float32))

    v_bs: set[int] = set()
    v_motion: set[int] = set()
    per_ctrl: dict[str, set[int]] = {}

    names = fm.rig.mesh_names()
    head_meshes = fm.sel
    offsets = fm.offsets

    # Precompute which BS channels activate per control (via blend_shape_outputs)
    for idx, name in controls:
        raw = np.zeros(n, np.float32)
        raw[idx] = 1.0
        fm.rig.set_raw_controls(raw)
        fm.rig.calculate()
        bs = np.array(fm.rig.blend_shape_outputs())
        active_ch = np.where(np.abs(bs) > 1e-5)[0]
        for ch in active_ch:
            for mi, m in enumerate(head_meshes):
                off = offsets[mi]
                for t in range(fm.rig.blend_shape_target_count(m)):
                    if fm.rig.blend_shape_channel_index(m, t) != int(ch):
                        continue
                    for v in fm.rig.blend_shape_target_vertex_indices(m, t):
                        v_bs.add(off + int(v))

        moved = fm.eval_raw(raw)
        delta = np.linalg.norm(moved - base, axis=1)
        hit = set(np.where(delta > motion_eps_cm)[0].tolist())
        v_motion |= hit
        per_ctrl[name] = hit

    return v_bs, v_motion, per_ctrl


def dilate_from_seeds(neutral: np.ndarray, seed_ids: set[int], radius_cm: float) -> set[int]:
    """All vertices within radius_cm of any seed vertex (neutral positions)."""
    if not seed_ids:
        return set()
    seeds = neutral[list(seed_ids)]
    # (V, S) distances — vectorized for typical head sizes
    diff = neutral[:, None, :] - seeds[None, :, :]
    dmin = np.linalg.norm(diff, axis=2).min(axis=1)
    return set(np.where(dmin <= radius_cm)[0].tolist())


def seed_controls(per_ctrl: dict[str, set[int]], names: list[str]) -> set[int]:
    out: set[int] = set()
    for n in names:
        out |= per_ctrl.get(n, set())
    return out


def motion_energy_ratio(verts: np.ndarray, mask: set[int]) -> float:
    """Fraction of total frame-to-frame motion L2 inside mask."""
    if verts.shape[0] < 2:
        return 0.0
    m = sorted(mask)
    if len(m) == 0:
        return 0.0
    diff = np.diff(verts, axis=0)
    mag = np.linalg.norm(diff, axis=2)
    inside = mag[:, m].sum()
    total = mag.sum()
    return float(inside / total) if total > 0 else 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description="Define MetaHuman lip vertex region (MH-LVR v1)")
    ap.add_argument("--dna", required=True, help="MetaHuman head.dna")
    ap.add_argument("--lod", type=int, default=0)
    ap.add_argument("--meshes", default="head", help="FaceModel mesh selection")
    ap.add_argument("--motion-eps-cm", type=float, default=0.02,
                    help="Min vertex displacement (cm) for V_motion")
    ap.add_argument("--geo-radius-cm", type=float, default=1.6,
                    help="Expand lip seeds by this radius (cm) on neutral mesh")
    ap.add_argument("--use-all-speech", action="store_true",
                    help="Use all jaw/mouth controls (default: ARKit core set only)")
    ap.add_argument("--out", default="", help="Output JSON (default: next to DNA)")
    ap.add_argument("--npy", default="", help="Optional clip for validation")
    ap.add_argument("--columns", default="", help="columns.txt for optional NPY")
    args = ap.parse_args()

    dna = Path(args.dna)
    if not dna.is_file():
        print("DNA not found:", dna)
        return 1

    out_path = Path(args.out) if args.out else dna.parent / "lip_vertices_mhlvr_v1.json"

    print("Loading FaceModel ...", flush=True)
    fm = FaceModel(str(dna), lod=args.lod, meshes=args.meshes)
    all_speech = speech_control_indices(fm.rig)
    if args.use_all_speech:
        controls = all_speech
        control_mode = "all_speech"
    else:
        controls = [(i, n) for i, n in all_speech if is_core_speech_control(n)]
        control_mode = "core_arkit"
    if not controls:
        print("No speech controls matched; check DNA / naming.")
        return 1
    print("Speech controls:", len(controls), f"({control_mode})",
          "| vertices:", fm.vertex_count, flush=True)

    v_bs, v_motion, per_ctrl = perturbation_masks(fm, controls, args.motion_eps_cm)

    # Lip seeds: primary articulation controls (ARKit mouth subset)
    seed_names = []
    for suffix in ("jawOpen", "mouthClose", "mouthPucker", "mouthFunnel"):
        key = next((n for _, n in controls if _norm_control_name(n) == suffix), None)
        if key:
            seed_names.append(key)
    v_seed = seed_controls(per_ctrl, seed_names)
    v_geo = dilate_from_seeds(fm.neutral_vertices, v_seed, args.geo_radius_cm)

    # Final: dilated lip seeds, confirmed by motion under any core control
    m_final = v_geo & v_motion if v_motion else v_geo
    ids = sorted(m_final)

    validation = {}
    if args.npy and args.columns:
        cols_path = Path(args.columns)
        if cols_path.is_file():
            fm.set_columns_file(str(cols_path))
            data = np.load(args.npy)
            seq = fm.eval_columns_batch(data)
            validation["motion_energy_ratio_inside_mask"] = motion_energy_ratio(seq, m_final)
            validation["n_frames"] = int(data.shape[0])
            validation["clip_npy"] = str(Path(args.npy).name)

    payload = {
        "protocol": PROTOCOL_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dna": str(dna.resolve()),
        "metaHumanName": dna.parent.name,
        "lod": args.lod,
        "meshes": fm.mesh_names,
        "vertex_count_total": fm.vertex_count,
        "lip_vertex_count": len(ids),
        "lip_vertex_ids": ids,
        "parameters": {
            "motion_eps_cm": args.motion_eps_cm,
            "geo_radius_cm": args.geo_radius_cm,
            "control_mode": control_mode,
            "geo_seed_controls": [_norm_control_name(n) for n in seed_names],
            "combination": "dilate(jawOpen|mouthClose|mouthPucker|mouthFunnel motion seeds) & V_motion",
        },
        "sets": {
            "V_bs_count": len(v_bs),
            "V_motion_count": len(v_motion),
            "V_seed_count": len(v_seed),
            "V_geo_dilated_count": len(v_geo),
        },
        "speech_controls": [name for _, name in controls],
        "validation": validation,
        "citation_hint": (
            "Lip vertices defined by MH-LVR v1: ARKit-aligned core MetaHuman speech "
            "controls perturbed individually; lip seeds from jawOpen/mouthClose/"
            "mouthPucker/mouthFunnel displacements dilated by geo_radius_cm on the "
            "neutral head mesh; final set intersected with vertices movable by any "
            "core ARKit-aligned control."
        ),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print("Wrote:", out_path, flush=True)
    print("  lip vertices:", len(ids), flush=True)
    print("  V_bs / V_motion / V_geo:", len(v_bs), len(v_motion), len(v_geo), flush=True)
    if validation:
        print("  motion energy inside mask:", validation.get("motion_energy_ratio_inside_mask"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
