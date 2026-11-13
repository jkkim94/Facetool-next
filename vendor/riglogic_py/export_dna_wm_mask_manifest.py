# -*- coding: utf-8
"""Build manifest linking SourceAssets/masks TGA ↔ DNA animated_maps (behavior/definition).

Wrap rule (MetaHuman):
  - TGA masks share head_lod0_mesh UV (same as Head_Basecolor / serve.py /uvs).
  - animated_map_name: {material}.{mask_id} e.g. head_cm1_color.head_wm13_lips_UL
  - TGA file: {mask_id}_msk.tga e.g. head_wm13_lips_UL_msk.tga
  - WM layer (wm1/wm2/wm3/wm13) selects Head_Normal_Animated_WM* blend target.

Usage:
  python export_dna_wm_mask_manifest.py
  python export_dna_wm_mask_manifest.py --dna-dir E:\\Viewer\\DNA\\0421_V33
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DNA_DIR = Path(r"E:\Viewer\DNA\0421_V33")
MASKS_DIR_NAME = Path("SourceAssets") / "masks"
WM_RE = re.compile(r"(wm\d+)", re.I)


def load_animated_map_names(dna_dir: Path) -> list[str]:
    def_path = dna_dir / "definition.json"
    if not def_path.is_file():
        return []
    data = json.loads(def_path.read_text(encoding="utf-8"))
    return [e["name"] for e in data.get("animated_maps", []) if e.get("name")]


def mask_id_from_tga(filename: str) -> str:
    stem = Path(filename).stem
    if stem.endswith("_msk"):
        return stem[:-4]
    return stem


def find_animated_map(mask_id: str, am_names: list[str]) -> str | None:
    suffix = "." + mask_id
    for name in am_names:
        if name.endswith(suffix) or name.split(".")[-1] == mask_id:
            return name
    return None


def wm_layer_from_id(mask_id: str) -> str | None:
    m = WM_RE.search(mask_id)
    return m.group(1).lower() if m else None


def material_from_animated_map(am_name: str | None) -> str | None:
    if not am_name or "." not in am_name:
        return None
    return am_name.split(".")[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dna-dir", default=str(DEFAULT_DNA_DIR))
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    dna_dir = Path(args.dna_dir)
    masks_dir = dna_dir / MASKS_DIR_NAME
    if not masks_dir.is_dir():
        raise SystemExit("masks dir not found: %s" % masks_dir)

    am_names = load_animated_map_names(dna_dir)
    tga_files = sorted(p.name for p in masks_dir.glob("*.tga"))
    entries = []
    for i, fname in enumerate(tga_files):
        mask_id = mask_id_from_tga(fname)
        am_name = find_animated_map(mask_id, am_names)
        wm = wm_layer_from_id(mask_id)
        mat = material_from_animated_map(am_name)
        entries.append({
            "index": i,
            "file": fname,
            "mask_id": mask_id,
            "animated_map_name": am_name,
            "material_slot": mat,
            "wm_layer": wm,
            "mesh_name": "head_lod0_mesh",
            "lod": 0,
        })

    manifest = {
        "metadata": {
            "source": "MetaHuman DNA export (SourceAssets/masks)",
            "dna_dir": str(dna_dir),
            "masks_dir": str(masks_dir),
            "mesh_name": "head_lod0_mesh",
            "lod": 0,
            "uv_wrap": (
                "TGA grayscale weights use the same UV layout as head_lod0_mesh "
                "(DNA texture coordinates served as /uvs). Each mask weights "
                "animated normal/color map blending for its animated_map_name "
                "when RigLogic behavior drives the linked raw controls."
            ),
            "naming": {
                "tga": "{mask_id}_msk.tga",
                "animated_map": "{material_slot}.{mask_id}",
                "example_tga": "head_wm13_lips_UL_msk.tga",
                "example_animated_map": "head_cm1_color.head_wm13_lips_UL",
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "mask_count": len(entries),
            "animated_map_count": len(am_names),
        },
        "masks": entries,
    }

    out_path = Path(args.out) if args.out else dna_dir / "dna_wm_masks_manifest.json"
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Wrote %s (%d masks, %d animated_maps in definition)" % (
        out_path, len(entries), len(am_names)), flush=True)
    linked = sum(1 for e in entries if e["animated_map_name"])
    print("DNA linked: %d / %d" % (linked, len(entries)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
