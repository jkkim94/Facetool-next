# -*- coding: utf-8 -*-
"""Export MetaHuman Creator-style face regions (Custom Mesh / influence patches).

Ground truth for the colored regions in MetaHuman Creator (Custom Mesh tab) comes
from PatchBlendModel gizmo patches, NOT from coarse MeshColorAsset bucketing.

Seed points: IdentityTemplate/landmarks_config.json  (gizmo_* entries, LOD0 vIDs)
LOD1 assignment: nearest gizmo in 3D on head_lod1_mesh (RigLogic DNA neutral pose)

Epic references:
  MetaHumanCharacter/Content/Face/IdentityTemplate/landmarks_config.json
  MetaHumanCoreTechLib PatchBlendModel / BlendFaceRegion (InRegionIndex = patch id)
  Mesh-to-MetaHuman influence sliders (region + overall) — Epic video / yelzkizi blog

Usage:
  python export_creator_face_regions.py
  python export_creator_face_regions.py --dna ... --out face_regions_creator.json
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import riglogic

DEFAULT_DNA = os.environ.get("RIGLOGIC_DNA", r"E:\Viewer\DNA\0421_V33\head.dna")
DEFAULT_LANDMARKS = os.environ.get(
    "METAHUMAN_LANDMARKS",
    r"C:\Program Files\Epic Games\UE_5.6\Engine\Plugins\MetaHuman"
    r"\MetaHumanCharacter\Content\Face\IdentityTemplate\landmarks_config.json",
)
def default_out(lod: int) -> str:
    return os.path.join(os.path.dirname(__file__), "face_regions_creator_lod%d.json" % lod)


OUT = default_out(0)

# Gizmo patch name (without gizmo_ prefix) -> Creator-style semantic group
SEMANTIC_GROUPS = {
    "forehead": {
        "label": "이마",
        "color": [0.55, 0.78, 0.95],
        "patches": ["forheadTop", "forhead_L", "forhead_R", "skullTop"],
    },
    "brow_eye": {
        "label": "눈썹/눈",
        "color": [0.18, 0.45, 0.42],
        "patches": ["eye_L", "eye_R"],
    },
    "nose": {
        "label": "코",
        "color": [0.82, 0.68, 0.52],
        "patches": ["nose"],
    },
    "cheek": {
        "label": "볼/광대",
        "color": [0.72, 0.55, 0.82],
        "patches": ["cheek_L", "cheek_R", "cheekbone_L", "cheekbone_R"],
    },
    "mouth_chin": {
        "label": "입/턱",
        "color": [0.95, 0.62, 0.45],
        "patches": ["mouth", "chin", "jaw", "jaw_L", "jaw_R"],
    },
    "ear": {
        "label": "귀",
        "color": [0.55, 0.55, 0.58],
        "patches": ["ear_L", "ear_R"],
    },
    "skull_side": {
        "label": "두상 측면/후면",
        "color": [0.78, 0.62, 0.55],
        "patches": ["skullSide_L", "skullSide_R", "skullBack"],
    },
}

PATCH_TO_GROUP = {}
for gkey, meta in SEMANTIC_GROUPS.items():
    for p in meta["patches"]:
        PATCH_TO_GROUP[p] = gkey

# Per-patch colors (MetaHuman Creator Custom Mesh / reference figure style)
PATCH_COLORS = {
    "skullTop": [0.34, 0.36, 0.46],
    "skullSide_L": [0.48, 0.50, 0.55],
    "skullSide_R": [0.48, 0.50, 0.55],
    "skullBack": [0.44, 0.46, 0.50],
    "forheadTop": [0.34, 0.36, 0.46],
    "forhead_L": [0.38, 0.40, 0.50],
    "forhead_R": [0.38, 0.40, 0.50],
    "eye_L": [0.70, 0.86, 0.58],
    "eye_R": [0.70, 0.86, 0.58],
    "cheekbone_L": [0.58, 0.42, 0.72],
    "cheekbone_R": [0.58, 0.42, 0.72],
    "ear_L": [0.52, 0.54, 0.58],
    "ear_R": [0.52, 0.54, 0.58],
    "nose": [0.90, 0.78, 0.50],
    "cheek_L": [0.55, 0.38, 0.68],
    "cheek_R": [0.55, 0.38, 0.68],
    "mouth": [0.96, 0.42, 0.22],
    "chin": [0.92, 0.52, 0.34],
    "jaw": [0.88, 0.48, 0.32],
    "neck": [0.50, 0.52, 0.56],
    "jaw_L": [0.85, 0.45, 0.30],
    "jaw_R": [0.85, 0.45, 0.30],
}


def head_mesh_index(rig, lod=0):
    for mi in rig.mesh_indices_for_lod(lod):
        if rig.mesh_names()[mi].startswith("head_"):
            return mi
    raise RuntimeError("head mesh not found for LOD %d" % lod)


def load_gizmo_seeds(landmarks_path: str, rig) -> list[dict]:
    with open(landmarks_path, encoding="utf-8") as f:
        lm = json.load(f)

    lod0_head = None
    for mi in rig.mesh_indices_for_lod(0):
        if rig.mesh_names()[mi] == "head_lod0_mesh":
            lod0_head = mi
            break
    if lod0_head is None:
        raise RuntimeError("head_lod0_mesh not found")

    pos0 = rig.vertex_positions(lod0_head)
    seeds = []
    for key, val in lm.items():
        if not key.startswith("gizmo_"):
            continue
        patch = key[6:]  # strip gizmo_
        if val.get("mesh") != "head_lod0_mesh":
            continue
        vid = int(val["vID"])
        seeds.append({
            "patch": patch,
            "group": PATCH_TO_GROUP.get(patch, "skull_side"),
            "lod0Vertex": vid,
            "position": pos0[vid].tolist(),
        })
    if not seeds:
        raise RuntimeError("no gizmo_* entries in %s" % landmarks_path)
    return seeds


def assign_voronoi(head_pos: np.ndarray, seeds: list[dict]) -> tuple[list[int], list[str], list[str]]:
    seed_xyz = np.array([s["position"] for s in seeds], dtype=np.float64)
    # (V, S) squared distances
    diff = head_pos[:, None, :] - seed_xyz[None, :, :]
    d2 = np.sum(diff * diff, axis=2)
    nearest = np.argmin(d2, axis=1)
    patch_per_vertex = [seeds[i]["patch"] for i in nearest]
    group_per_vertex = [seeds[i]["group"] for i in nearest]
    patch_id_per_vertex = nearest.tolist()
    return patch_id_per_vertex, patch_per_vertex, group_per_vertex


def build_payload(rig, seeds, head_mi, head_count, lod):
    head_pos = rig.vertex_positions(head_mi)
    patch_id, patch_names, group_keys = assign_voronoi(head_pos, seeds)

    group_order = list(SEMANTIC_GROUPS.keys())
    group_to_id = {k: i for i, k in enumerate(group_order)}
    vertex_group = [group_to_id[g] for g in group_keys]

    patches = []
    for i, s in enumerate(seeds):
        g = s["group"]
        patch_color = PATCH_COLORS.get(s["patch"], SEMANTIC_GROUPS[g]["color"])
        patches.append({
            "id": i,
            "patch": s["patch"],
            "group": g,
            "groupLabel": SEMANTIC_GROUPS[g]["label"],
            "color": patch_color,
            "lod0SeedVertex": s["lod0Vertex"],
            "seedPosition": s["position"],
            "vertexCount": patch_id.count(i),
        })

    regions = []
    for gid, gkey in enumerate(group_order):
        meta = SEMANTIC_GROUPS[gkey]
        regions.append({
            "id": gid,
            "key": gkey,
            "label": meta["label"],
            "color": meta["color"],
            "patches": meta["patches"],
            "vertexCount": group_keys.count(gkey),
        })

    # FaceTool display: one color per gizmo patch (Creator Custom Mesh style)
    display_regions = [{
        "id": p["id"],
        "key": p["patch"],
        "label": p["patch"],
        "color": p["color"],
        "vertexCount": p["vertexCount"],
    } for p in patches]
    vertex_colors = [patches[pid]["color"] for pid in patch_id]

    return {
        "headVertexCount": int(head_count),
        "meshName": rig.mesh_names()[head_mi],
        "method": "MetaHuman Creator gizmo patches (landmarks_config Voronoi, LOD%d)" % lod,
        "source": {
            "landmarks": DEFAULT_LANDMARKS,
            "dna": DEFAULT_DNA,
            "lod": lod,
            "epicNotes": "vertexRegion=patch id; gizmo vIDs are LOD0 indices, Voronoi on head_lod%d_mesh" % lod,
        },
        "patches": patches,
        "semanticRegions": regions,
        "regions": display_regions,
        "vertexPatch": patch_id,
        "vertexPatchName": patch_names,
        "vertexSemanticRegion": vertex_group,
        "vertexRegion": patch_id,
        "vertexColors": vertex_colors,
    }


def main():
    import argparse

    ap = argparse.ArgumentParser(description="Export Creator-style face regions")
    ap.add_argument("--lod", type=int, default=0, choices=[0, 1])
    ap.add_argument("--dna", default=DEFAULT_DNA)
    ap.add_argument("--landmarks", default=DEFAULT_LANDMARKS)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out_path = args.out or default_out(args.lod)

    print("loading DNA (LOD %d)..." % args.lod, flush=True)
    rig = riglogic.Rig(args.dna)
    head_mi = head_mesh_index(rig, args.lod)
    head_count = rig.vertex_position_count(head_mi)
    print("seeds from %s" % args.landmarks, flush=True)
    seeds = load_gizmo_seeds(args.landmarks, rig)
    payload = build_payload(rig, seeds, head_mi, head_count, args.lod)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    if args.lod == 0:
        alias = os.path.join(os.path.dirname(__file__), "face_regions_creator.json")
        if os.path.normpath(out_path) != os.path.normpath(alias):
            with open(alias, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)

    print("wrote %s (%d patches)" % (out_path, len(payload["patches"])))
    for p in payload["patches"]:
        print("  %s: %d verts" % (p["patch"], p["vertexCount"]))


if __name__ == "__main__":
    main()
