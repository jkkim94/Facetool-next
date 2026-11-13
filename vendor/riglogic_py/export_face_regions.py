# -*- coding: utf-8 -*-
"""Export MetaHuman logical face regions for viewer coloring.

Ground truth partition: UE MetaHuman IdentityTemplate MeshColorAsset.uasset
(same data applied on DNA import in MetaHumanInterchangeDnaTranslator.cpp).

Display colors: Epic documentation-style palette mapped to 16 coarse GB buckets.
"""
import json
import os
from collections import Counter, defaultdict

import numpy as np
import riglogic

from mesh_color_asset import DEFAULT_UASSET, coarse_region_key, load_mesh_vertex_colors

DNA = os.environ.get("RIGLOGIC_DNA", r"E:\Viewer\DNA\0421_V33\head.dna")
OUT = os.path.join(os.path.dirname(__file__), "face_regions.json")
MESH_NAME = "head_lod1_mesh"
LOD = 0

# Epic doc / MetaHuman debug palette for 16 MeshColorAsset GB buckets (gi//32, bi//128)
EPIC_LUT = {
    (7, 0): {"key": "face_main", "label": "얼굴 기본", "color": [0.72, 0.52, 0.32]},
    (7, 1): {"key": "forehead", "label": "이마", "color": [0.55, 0.78, 0.95]},
    (0, 0): {"key": "nose_center", "label": "코 (중앙)", "color": [0.42, 0.24, 0.14]},
    (0, 1): {"key": "mouth_ring", "label": "입 주변", "color": [0.18, 0.28, 0.62]},
    (1, 0): {"key": "nose_upper", "label": "코 (상)", "color": [0.42, 0.24, 0.14]},
    (6, 0): {"key": "mouth_fwd", "label": "입 (전면)", "color": [0.92, 0.38, 0.58]},
    (5, 1): {"key": "cheekbone", "label": "광대", "color": [0.85, 0.38, 0.62]},
    (5, 0): {"key": "skull_side", "label": "두상 측면", "color": [0.72, 0.52, 0.32]},
    (3, 0): {"key": "forehead_top", "label": "이마 상단", "color": [0.55, 0.78, 0.95]},
    (1, 1): {"key": "mid_cheek", "label": "중간 볼", "color": [0.34, 0.72, 0.38]},
    (2, 1): {"key": "jaw_side", "label": "턱 측면", "color": [0.85, 0.38, 0.62]},
    (3, 1): {"key": "chin", "label": "턱 (하)", "color": [0.18, 0.28, 0.62]},
    (2, 0): {"key": "temple", "label": "관자", "color": [0.34, 0.72, 0.38]},
    (4, 1): {"key": "lower_cheek", "label": "아래 볼", "color": [0.34, 0.72, 0.38]},
    (4, 0): {"key": "brow_eye", "label": "눈썹/눈", "color": [0.18, 0.28, 0.62]},
    (6, 1): {"key": "ear_jaw", "label": "귀/턱", "color": [0.22, 0.32, 0.55]},
}

FALLBACK = {"key": "other", "label": "기타", "color": [0.78, 0.62, 0.55]}


def head_mesh_index(rig, lod=0):
    names = rig.mesh_names()
    for mi in rig.mesh_indices_for_lod(lod):
        if names[mi].startswith("head_"):
            return mi
    raise RuntimeError("head mesh not found for LOD %d" % lod)


def main():
    print("loading DNA...", flush=True)
    rig = riglogic.Rig(DNA)
    head_mi = head_mesh_index(rig, LOD)
    head_count = rig.vertex_position_count(head_mi)
    assert rig.mesh_names()[head_mi] == MESH_NAME, rig.mesh_names()[head_mi]

    print("reading MeshColorAsset for %s (%d verts)..." % (MESH_NAME, head_count), flush=True)
    raw_colors = load_mesh_vertex_colors(MESH_NAME, head_count, DEFAULT_UASSET)

    bucket_keys = []
    for r, g, b, _a in raw_colors:
        bucket_keys.append(coarse_region_key(r, g, b))

    unique_buckets = sorted(set(bucket_keys))
    bucket_to_id = {k: i for i, k in enumerate(unique_buckets)}

    regions = []
    for i, bk in enumerate(unique_buckets):
        meta = EPIC_LUT.get(bk, FALLBACK)
        regions.append({
            "id": i,
            "bucket": list(bk),
            "key": meta["key"],
            "label": meta["label"],
            "color": meta["color"],
            "vertexCount": bucket_keys.count(bk),
        })

    vertex_region = [bucket_to_id[bk] for bk in bucket_keys]
    vertex_colors = [EPIC_LUT.get(bk, FALLBACK)["color"] for bk in bucket_keys]
    raw_rgb = [[round(c[0], 4), round(c[1], 4), round(c[2], 4)] for c in raw_colors]

    payload = {
        "headVertexCount": int(head_count),
        "meshName": MESH_NAME,
        "method": "MetaHuman MeshColorAsset.uasset (UE 5.6 IdentityTemplate)",
        "source": DEFAULT_UASSET,
        "regions": regions,
        "vertexRegion": vertex_region,
        "vertexColors": vertex_colors,
        "rawMeshColors": raw_rgb,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f)

    print("wrote %s (%d regions)" % (OUT, len(regions)))
    for r in regions:
        print("  %s %s: %d verts" % (r["bucket"], r["label"], r["vertexCount"]))


if __name__ == "__main__":
    main()
