# -*- coding: utf-8 -*-
"""Export head mesh vertex IDs for lip + mouth from T_Gray_Head_D.PNG UV map.

Usage:
  python export_uv_mouth_vertices_csv.py --lod 0
  python export_uv_mouth_vertices_csv.py --lod 0 --out E:\\Viewer\\riglogic_py\\uv_mouth_vertices_lod0.csv
"""
from __future__ import annotations

import csv
import os

import riglogic

from gray_head_uv import DNA, REGION_TEXTURE, load_texture, sample_head_uv_regions

DEFAULT_OUT = os.path.join(os.path.dirname(__file__), "uv_mouth_vertices_lod0.csv")


def default_out(lod: int) -> str:
    if lod == 0:
        return DEFAULT_OUT
    base, ext = os.path.splitext(DEFAULT_OUT)
    return "%s_lod%d%s" % (base, lod, ext)


def write_csv(path: str, data: dict) -> None:
    fieldnames = [
        "vertex_id",
        "region",
        "u",
        "v",
        "sample_r",
        "sample_g",
        "sample_b",
        "pos_x",
        "pos_y",
        "pos_z",
        "mesh_name",
        "lod",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in sorted(data["rows"], key=lambda r: (r["vertex_id"], r["region"])):
            w.writerow({
                **row,
                "mesh_name": data["meshName"],
                "lod": data["lod"],
            })


def main():
    import argparse

    ap = argparse.ArgumentParser(description="Export UV lip/mouth vertex IDs to CSV")
    ap.add_argument("--lod", type=int, default=0, choices=[0])
    ap.add_argument("--texture", default=REGION_TEXTURE)
    ap.add_argument("--dna", default=DNA)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    if not os.path.exists(args.texture):
        raise SystemExit("texture not found: %s" % args.texture)

    out_path = args.out or default_out(args.lod)
    print("loading texture: %s" % args.texture, flush=True)
    tex = load_texture(args.texture)
    print("loading DNA (LOD %d)..." % args.lod, flush=True)
    rig = riglogic.Rig(args.dna)
    data = sample_head_uv_regions(rig, tex, args.lod)
    write_csv(out_path, data)

    print("wrote %s" % out_path, flush=True)
    print("  mesh=%s head=%d" % (data["meshName"], data["headVertexCount"]), flush=True)
    print("  lip=%d mouth(outer)=%d union=%d (LOD%d)" % (
        len(data["lip"]), len(data["mouth"]), len(data["all"]), args.lod,
    ), flush=True)


if __name__ == "__main__":
    main()
