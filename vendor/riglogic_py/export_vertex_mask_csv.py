# -*- coding: utf-8 -*-
"""Export vertex ID list masks (mouth region, lower face, lip) to CSV.

Usage:
  python export_vertex_mask_csv.py
  python export_vertex_mask_csv.py --mask path/to/mask.json --out path/to/out.csv
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

DEFAULT_DIR = Path(r"E:\Viewer\DNA\0421_V33\lip_mask_v1")

MASKS = (
    ("metahuman_head_lod0_lip_mask.json", "metahuman_head_lod0_lip_mask.csv", "lip"),
    ("metahuman_head_lod0_mouth_region_mask.json", "metahuman_head_lod0_mouth_region_mask.csv", "mouth_region"),
    ("metahuman_head_lod0_lower_face_mask.json", "metahuman_head_lod0_lower_face_mask.csv", "lower_face"),
)


def extract_ids(data: dict) -> list[int]:
    if isinstance(data.get("combined", {}).get("all_lip"), list):
        return [int(v) for v in data["combined"]["all_lip"]]
    if isinstance(data.get("ids"), list):
        return [int(v) for v in data["ids"]]
    raise ValueError("no vertex id list in JSON")


def export_one(json_path: Path, csv_path: Path, region: str) -> int:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    meta = data.get("metadata") or {}
    ids = sorted(extract_ids(data))
    protocol = meta.get("protocol", "")
    mesh = meta.get("mesh_name", "head_lod0_mesh")
    lod = meta.get("lod", 0)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["vertex_id", "region", "protocol", "mesh_name", "lod"])
        for vid in ids:
            w.writerow([vid, region, protocol, mesh, lod])
    print("Wrote %s (%d verts)" % (csv_path, len(ids)))
    return len(ids)


def main() -> int:
    ap = argparse.ArgumentParser(description="Export vertex mask JSON to CSV")
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    ap.add_argument("--mask", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--region", default="")
    args = ap.parse_args()

    if args.mask:
        json_path = Path(args.mask)
        csv_path = Path(args.out) if args.out else json_path.with_suffix(".csv")
        region = args.region or json_path.stem
        export_one(json_path, csv_path, region)
        return 0

    base = Path(args.dir)
    for jname, cname, region in MASKS:
        export_one(base / jname, base / cname, region)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
