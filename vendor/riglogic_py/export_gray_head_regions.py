# -*- coding: utf-8 -*-
"""Sample MetaHuman T_Gray_Head_D.PNG at head mesh UVs -> per-vertex region + mouth mask.

Epic Identity region id map (UV hard partition). mouth = inner red + outer tan/orange
from the same texture used in FaceTool Identity UV mode.

Usage:
  python export_gray_head_regions.py --lod 0
"""
from __future__ import annotations

import json
import os

import numpy as np

import riglogic

from gray_head_uv import (
    DNA,
    REGION_TEXTURE,
    QUANT,
    classify_mouth_uv_rgb,
    head_mesh_index,
    is_mouth_color,
    load_texture,
    sample_head_uv_regions,
    sample_rgb,
)
from bake import load_mesh_static

OUT = os.path.join(os.path.dirname(__file__), "gray_head_regions.json")


def quantize(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple((np.array(rgb) // QUANT) * QUANT)


def build_payload(rig, tex: np.ndarray, lod: int):
    sampled = sample_head_uv_regions(rig, tex, lod)
    mi = head_mesh_index(rig, lod)
    mm = load_mesh_static(rig, mi)
    head_count = int(mm["V"])
    uv_per_pos = mm["uv"]

    vertex_colors = []
    vertex_region = []
    region_map = {}
    region_id = 0

    for vi in range(head_count):
        u, v = float(uv_per_pos[vi, 0]), float(uv_per_pos[vi, 1])
        rgb = sample_rgb(tex, u, v)
        q = quantize(rgb)
        vertex_colors.append([c / 255.0 for c in rgb])
        if q not in region_map:
            region_map[q] = region_id
            region_id += 1
        vertex_region.append(region_map[q])

    lip = sampled["lip"]
    mouth_outer = sampled["mouth"]
    mouth_all = sampled["all"]

    regions = []
    counts = np.zeros(len(region_map), dtype=np.int64)
    for rid in vertex_region:
        counts[rid] += 1
    inv = {v: k for k, v in region_map.items()}
    for rid in range(len(region_map)):
        q = inv[rid]
        label = "mouth" if is_mouth_color(q) else "region_%d" % rid
        regions.append({
            "id": rid,
            "key": label if label == "mouth" else "c_%d_%d_%d" % q,
            "label": "입 (mouth)" if label == "mouth" else "RGB %s" % (q,),
            "color": [q[0] / 255.0, q[1] / 255.0, q[2] / 255.0],
            "quantRgb": [int(q[0]), int(q[1]), int(q[2])],
            "vertexCount": int(counts[rid]),
        })

    return {
        "headVertexCount": head_count,
        "meshName": rig.mesh_names()[mi],
        "lod": lod,
        "partition": "uv_hard",
        "method": "T_Gray_Head_D.PNG UV sample (Epic Identity region id map)",
        "source": {"texture": REGION_TEXTURE, "dna": DNA},
        "mouthDefinition": {
            "innerLip": "lip — T_Gray_Head_D red stroke pixels only",
            "outerMouth": "none — tan/white mouth fill and mesh ring excluded",
            "lipStrokeRefs": [(242, 38, 51), (212, 103, 103), (216, 104, 103)],
            "lipStrokeTolerance": 28,
            "csvExport": "python export_uv_mouth_vertices_csv.py --lod %d" % lod,
        },
        "regions": sorted(regions, key=lambda r: -r["vertexCount"]),
        "vertexRegion": vertex_region,
        "vertexColors": vertex_colors,
        "lip": lip,
        "lipCount": len(lip),
        "mouth": mouth_outer,
        "mouthCount": len(mouth_outer),
        "mouthAll": mouth_all,
        "mouthAllCount": len(mouth_all),
    }


def main():
    import argparse

    ap = argparse.ArgumentParser(description="Export T_Gray_Head_D UV regions + mouth mask")
    ap.add_argument("--lod", type=int, default=0, choices=[0])
    ap.add_argument("--texture", default=REGION_TEXTURE)
    ap.add_argument("--dna", default=DNA)
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    if not os.path.exists(args.texture):
        raise SystemExit("texture not found: %s" % args.texture)

    print("loading texture: %s" % args.texture, flush=True)
    tex = load_texture(args.texture)
    print("loading DNA (LOD %d)..." % args.lod, flush=True)
    rig = riglogic.Rig(args.dna)
    payload = build_payload(rig, tex, args.lod)
    out = args.out
    if args.lod != 0:
        base, ext = os.path.splitext(out)
        out = "%s_lod%d%s" % (base, args.lod, ext)

    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print("wrote %s" % out, flush=True)
    print("  regions=%d lip=%d mouth=%d all=%d (LOD%d head=%d)" % (
        len(payload["regions"]),
        payload["lipCount"],
        payload["mouthCount"],
        payload["mouthAllCount"],
        args.lod,
        payload["headVertexCount"],
    ), flush=True)


if __name__ == "__main__":
    main()
