# -*- coding: utf-8
"""Compare Epic WM13 lip TGA masks (4 quadrants) vs LVE UV lip mask vertex IDs.

  Epic: SourceAssets/masks/head_wm13_lips_{UL,UR,DL,DR}_msk.tga
        sampled at head_lod0_mesh UV (DNA /uvs — same as FaceTool WM view)

  LVE:  metahuman_head_lod0_lip_mask.json / .csv (T_Gray_Head_D + topology)

Usage:
  python compare_lip_wm_tga_vs_lve.py
  python compare_lip_wm_tga_vs_lve.py --threshold 0.12 --out report.json
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

DEFAULT_DNA = r"E:\Viewer\DNA\0421_V33\head.dna"
DEFAULT_MASKS_DIR = r"E:\Viewer\DNA\0421_V33\SourceAssets\masks"
DEFAULT_LVE_JSON = r"E:\Viewer\DNA\0421_V33\lip_mask_v1\metahuman_head_lod0_lip_mask.json"
DEFAULT_LVE_CSV = r"E:\metahuman_head_lod0_lip_mask.csv"

LIP_TGA = (
    "head_wm13_lips_UL_msk.tga",
    "head_wm13_lips_UR_msk.tga",
    "head_wm13_lips_DL_msk.tga",
    "head_wm13_lips_DR_msk.tga",
)
QUAD_KEYS = ("UL", "UR", "DL", "DR")


def load_tga_grayscale(path: Path) -> np.ndarray:
    arr = np.array(Image.open(path))
    if arr.ndim == 2:
        return arr.astype(np.float32) / 255.0
    return np.max(arr[..., :3], axis=2).astype(np.float32) / 255.0


def sample_weight(tex: np.ndarray, u: float, v: float) -> float:
    h, w = tex.shape
    px = int(np.clip(round(u * (w - 1)), 0, w - 1))
    py = int(np.clip(round((1.0 - v) * (h - 1)), 0, h - 1))
    return float(tex[py, px])


def verts_from_tga(uv: np.ndarray, tex: np.ndarray, threshold: float) -> list[int]:
    out = []
    for vi in range(uv.shape[0]):
        if sample_weight(tex, float(uv[vi, 0]), float(uv[vi, 1])) >= threshold:
            out.append(vi)
    return sorted(out)


def load_lve_ids(json_path: Path, csv_path: Path) -> tuple[set[int], dict]:
    groups = {}
    if json_path.is_file():
        doc = json.loads(json_path.read_text(encoding="utf-8"))
        meta = doc.get("metadata") or {}
        all_lip = set(int(v) for v in doc["combined"]["all_lip"])
        for name, ids in (doc.get("lip_vertices") or {}).items():
            if isinstance(ids, list) and ids:
                groups[name] = set(int(v) for v in ids)
        group_counts = {name: len(ids) for name, ids in groups.items()}
        return all_lip, {
            "source": str(json_path),
            "protocol": meta.get("protocol"),
            "group_counts": group_counts,
            "groups": groups,
        }

    if csv_path.is_file():
        ids = set()
        with csv_path.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                ids.add(int(row["vertex_id"]))
        return ids, {"source": str(csv_path), "groups": {}}

    raise FileNotFoundError("LVE mask JSON/CSV not found")


def split_by_uv_quadrant(
    ids: set[int],
    uv: np.ndarray,
    *,
    u_mid: float = 0.5,
    seam_v: float = 0.4133,
) -> dict[str, set[int]]:
    quads = {k: set() for k in QUAD_KEYS}
    for vi in ids:
        u, v = float(uv[vi, 0]), float(uv[vi, 1])
        left = u < u_mid
        upper = v >= seam_v
        if upper and left:
            quads["UL"].add(vi)
        elif upper and not left:
            quads["UR"].add(vi)
        elif not upper and left:
            quads["DL"].add(vi)
        else:
            quads["DR"].add(vi)
    return quads


def set_stats(a: set[int], b: set[int]) -> dict:
    inter = a & b
    only_a = a - b
    only_b = b - a
    union = a | b
    jacc = len(inter) / len(union) if union else 0.0
    return {
        "count_a": len(a),
        "count_b": len(b),
        "intersection": len(inter),
        "only_a": len(only_a),
        "only_b": len(only_b),
        "jaccard": round(jacc, 4),
        "recall_a_in_b": round(len(inter) / len(a), 4) if a else 0.0,
        "recall_b_in_a": round(len(inter) / len(b), 4) if b else 0.0,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dna", default=DEFAULT_DNA)
    ap.add_argument("--masks-dir", default=DEFAULT_MASKS_DIR)
    ap.add_argument("--lve-json", default=DEFAULT_LVE_JSON)
    ap.add_argument("--lve-csv", default=DEFAULT_LVE_CSV)
    ap.add_argument("--threshold", type=float, default=0.12,
                    help="TGA weight threshold (matches FaceTool dna_wm_masks default)")
    ap.add_argument("--seam-v", type=float, default=0.4133)
    ap.add_argument("--u-mid", type=float, default=0.5)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    from face_model import FaceModel

    fm = FaceModel(args.dna, lod=0, meshes="head")
    uv = fm.uvs.astype(np.float64)
    head_count = fm.vertex_count
    print("head_lod0 verts:", head_count, flush=True)

    masks_dir = Path(args.masks_dir)
    tga_sets = {}
    for fname, key in zip(LIP_TGA, QUAD_KEYS):
        path = masks_dir / fname
        if not path.is_file():
            raise SystemExit("missing TGA: %s" % path)
        tex = load_tga_grayscale(path)
        ids = set(verts_from_tga(uv, tex, args.threshold))
        tga_sets[key] = ids
        print("TGA %s: %d verts (thr=%.2f)" % (key, len(ids), args.threshold), flush=True)

    tga_union = set().union(*tga_sets.values())
    print("TGA union 4-quad: %d verts" % len(tga_union), flush=True)

    lve_all, lve_meta = load_lve_ids(Path(args.lve_json), Path(args.lve_csv))
    print("LVE all_lip: %d verts (%s)" % (len(lve_all), lve_meta.get("source")), flush=True)

    lve_uv_quad = split_by_uv_quadrant(
        lve_all, uv, u_mid=args.u_mid, seam_v=args.seam_v,
    )
    for k in QUAD_KEYS:
        print("LVE UV-split %s: %d verts" % (k, len(lve_uv_quad[k])), flush=True)

    per_quad = {}
    for k in QUAD_KEYS:
        per_quad[k] = {
            "tga_wm13": {
                "file": LIP_TGA[QUAD_KEYS.index(k)],
                "vertex_count": len(tga_sets[k]),
            },
            "lve_uv_quadrant": {"vertex_count": len(lve_uv_quad[k])},
            "tga_vs_lve_uv_quadrant": set_stats(tga_sets[k], lve_uv_quad[k]),
            "tga_vs_lve_all": set_stats(tga_sets[k], lve_all),
        }

    lve_groups = lve_meta.pop("groups", {}) or {}
    subgroup_map = {
        "UL": {"upper_outer_lip", "upper_inner_lip"},
        "UR": {"upper_outer_lip", "upper_inner_lip"},
        "DL": {"lower_outer_lip", "lower_inner_lip"},
        "DR": {"lower_outer_lip", "lower_inner_lip"},
    }
    for k in QUAD_KEYS:
        upper = k.startswith("U")
        names = [n for n in lve_groups if ("upper" in n) == upper]
        if names:
            lve_sub = set().union(*(lve_groups[n] for n in names))
            per_quad[k]["lve_subgroup_upper_or_lower"] = {
                "groups": names,
                "vertex_count": len(lve_sub),
                "tga_vs_subgroup": set_stats(tga_sets[k], lve_sub),
            }

    report = {
        "metadata": {
            "comparison": "Epic WM13 lip TGA (4 quad) vs LVE UV lip mask",
            "head_vertex_count": head_count,
            "tga_threshold": args.threshold,
            "uv_quadrant_split": {"u_mid": args.u_mid, "seam_v": args.seam_v},
            "lve": lve_meta,
        },
        "summary": {
            "tga_union_4": len(tga_union),
            "lve_all_lip": len(lve_all),
            "tga_union_vs_lve_all": set_stats(tga_union, lve_all),
        },
        "per_quadrant": per_quad,
        "vertex_ids": {
            "tga": {k: sorted(tga_sets[k]) for k in QUAD_KEYS},
            "tga_union": sorted(tga_union),
            "lve_all_lip": sorted(lve_all),
            "lve_uv_quadrant": {k: sorted(lve_uv_quad[k]) for k in QUAD_KEYS},
        },
    }

    out_path = Path(args.out) if args.out else Path(args.lve_json).parent / "lip_tga_vs_lve_compare.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\n=== SUMMARY ===", flush=True)
    s = report["summary"]["tga_union_vs_lve_all"]
    print("TGA union vs LVE all: intersect=%d  only_tga=%d  only_lve=%d  jaccard=%.3f" % (
        s["intersection"], s["only_a"], s["only_b"], s["jaccard"]), flush=True)
    print("\n=== PER QUADRANT (TGA vs LVE UV-split) ===", flush=True)
    for k in QUAD_KEYS:
        st = per_quad[k]["tga_vs_lve_uv_quadrant"]
        print("%s: TGA=%d LVE_uv=%d intersect=%d jaccard=%.3f recall_tga_in_lve=%.3f" % (
            k, st["count_a"], st["count_b"], st["intersection"],
            st["jaccard"], st["recall_a_in_b"]), flush=True)
    print("\nreport:", out_path, flush=True)

    csv_path = out_path.with_suffix(".summary.csv")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["quadrant", "tga_count", "lve_uv_quad_count", "intersection",
                    "only_tga", "only_lve_uv", "jaccard", "tga_recall_in_lve_uv"])
        for k in QUAD_KEYS:
            st = per_quad[k]["tga_vs_lve_uv_quadrant"]
            w.writerow([k, st["count_a"], st["count_b"], st["intersection"],
                        st["only_a"], st["only_b"], st["jaccard"], st["recall_a_in_b"]])
        st = report["summary"]["tga_union_vs_lve_all"]
        w.writerow(["UNION4", len(tga_union), len(lve_all), st["intersection"],
                    st["only_a"], st["only_b"], st["jaccard"], st["recall_a_in_b"]])
    print("csv:", csv_path, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
