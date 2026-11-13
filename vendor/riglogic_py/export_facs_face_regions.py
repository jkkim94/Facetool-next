# -*- coding: utf-8 -*-
"""FACS face regions from actual GUI control vertex displacement (174 controls).

Problem with Creator/MeshColorAsset regions: they mark broad "influence zones"
regardless of how many vertices each FACS control actually moves.

This export assigns each head vertex to the FACS *region* (brow, eye, nose, …)
of the single GUI control that produces the largest displacement at that vertex
when driven to 1.0 (others 0). Same region taxonomy as serve.py / Face Board.

Usage:
  python export_facs_face_regions.py
"""
from __future__ import annotations

import json
import os

import numpy as np
from face_model import FaceModel

DNA = os.environ.get("RIGLOGIC_DNA", r"E:\Viewer\DNA\0421_V33\head.dna")
OUT = os.path.join(os.path.dirname(__file__), "face_regions_facs.json")
THRESH_CM = 0.001

REGION_ORDER = (
    "jaw", "mouth", "eye", "brow", "nose", "tongue",
    "eyelashes", "teeth", "neck", "ear", "cheek", "chin", "other",
)

REGION_META = {
    "jaw": {"label": "턱 (Jaw)", "color": [0.85, 0.38, 0.62]},
    "mouth": {"label": "입 (Mouth)", "color": [0.92, 0.38, 0.58]},
    "eye": {"label": "눈 (Eye)", "color": [0.34, 0.72, 0.38]},
    "brow": {"label": "눈썹 (Brow)", "color": [0.18, 0.28, 0.62]},
    "nose": {"label": "코 (Nose)", "color": [0.42, 0.24, 0.14]},
    "tongue": {"label": "혀 (Tongue)", "color": [0.72, 0.32, 0.45]},
    "eyelashes": {"label": "속눈썹", "color": [0.55, 0.78, 0.95]},
    "teeth": {"label": "치아", "color": [0.92, 0.9, 0.85]},
    "neck": {"label": "목 (Neck)", "color": [0.22, 0.32, 0.55]},
    "ear": {"label": "귀 (Ear)", "color": [0.55, 0.55, 0.58]},
    "cheek": {"label": "볼 (Cheek)", "color": [0.72, 0.55, 0.82]},
    "chin": {"label": "턱끝 (Chin)", "color": [0.18, 0.28, 0.62]},
    "other": {"label": "기타", "color": [0.78, 0.62, 0.55]},
}


def gui_region(name: str) -> str:
    n = name[5:] if name.startswith("CTRL_") else name
    parts = n.split("_")
    if parts and parts[0] in ("L", "R", "C"):
        parts = parts[1:]
    region = parts[0].split(".")[0] if parts else "other"
    known = ("brow", "ear", "eye", "eyelashes", "nose", "mouth",
             "jaw", "tongue", "teeth", "neck", "chin", "cheek")
    return region if region in known else "other"


def main():
    print("loading FaceModel...", flush=True)
    fm = FaceModel(DNA, lod=0, meshes="face")
    neutral = fm.neutral_vertices
    gui_names = list(fm.rig.gui_control_names())
    head_max = fm._meshes[0]["V"]

    control_regions = [gui_region(n) for n in gui_names]
    owner_delta = np.zeros(head_max, dtype=np.float64)
    owner_control = np.full(head_max, -1, dtype=np.int32)

    print("evaluating %d GUI controls (dominant displacement)..." % len(gui_names), flush=True)
    for i, gname in enumerate(gui_names):
        g = np.zeros(fm.gui_control_count, np.float32)
        g[i] = 1.0
        v = fm.eval_gui(g)
        delta = np.linalg.norm(v[:head_max] - neutral[:head_max], axis=1)
        mask = delta > owner_delta
        owner_delta[mask] = delta[mask]
        owner_control[mask] = i
        if i % 20 == 0:
            print("  %d/%d %s" % (i, len(gui_names), gname), flush=True)

    present_regions = []
    for r in REGION_ORDER:
        if r in control_regions:
            present_regions.append(r)
    for r in sorted(set(control_regions)):
        if r not in present_regions:
            present_regions.append(r)

    region_to_id = {r: i for i, r in enumerate(present_regions)}
    vertex_region = []
    vertex_colors = []
    vertex_owner_name = []
    for vid in range(head_max):
        ci = int(owner_control[vid])
        if ci < 0 or owner_delta[vid] < THRESH_CM:
            vertex_region.append(-1)
            vertex_colors.append([0.78, 0.62, 0.55])
            vertex_owner_name.append("")
            continue
        rk = control_regions[ci]
        rid = region_to_id[rk]
        meta = REGION_META.get(rk, REGION_META["other"])
        vertex_region.append(rid)
        vertex_colors.append(meta["color"])
        vertex_owner_name.append(gui_names[ci])

    regions = []
    for rid, rkey in enumerate(present_regions):
        meta = REGION_META.get(rkey, REGION_META["other"])
        ctrl_idxs = [i for i, r in enumerate(control_regions) if r == rkey]
        regions.append({
            "id": rid,
            "key": rkey,
            "label": meta["label"],
            "color": meta["color"],
            "guiControlCount": len(ctrl_idxs),
            "guiControlIndices": ctrl_idxs,
            "vertexCount": vertex_region.count(rid),
        })

    payload = {
        "headVertexCount": int(head_max),
        "meshName": "head_lod1_mesh",
        "method": "FACS dominant GUI control displacement (174 controls, per-vertex argmax)",
        "thresholdCm": THRESH_CM,
        "source": {"dna": DNA},
        "regions": regions,
        "vertexRegion": vertex_region,
        "vertexColors": vertex_colors,
        "vertexDominantControl": vertex_owner_name,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print("wrote %s" % OUT)
    for r in regions:
        print("  %s: %d verts (%d controls)" % (
            r["label"], r["vertexCount"], r["guiControlCount"]))


if __name__ == "__main__":
    main()
