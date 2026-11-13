# -*- coding: utf-8 -*-
"""Export MetaHuman Identity semantic face regions (22 patches from geo_and_bindpose.pca).

Epic ground truth: IdentityBlendModel RegionData baked in geo_and_bindpose.pca.
LOD1 transfer: skinningWeightsConfig barycentric_coordinates_for_odd_lods.
Visualization: hard dominant region per vertex (FaceTool: flat face color + wireframe).

Usage:
  python export_identity_face_regions.py
"""
from __future__ import annotations

import json
import os

import riglogic

from geo_pca import (
    FACE_LOD0_VERT_COUNT,
    blend_region_colors,
    build_lod0_weight_matrix,
    dominant_from_weight_matrix,
    interpolate_weights_to_lod1,
    load_geo_pca,
    load_lod1_barycentric,
    resolve_geo_pca_path,
    resolve_skinning_weights_path,
)

DNA = os.environ.get("RIGLOGIC_DNA", r"E:\Viewer\DNA\0421_V33\head.dna")
def default_out(lod: int) -> str:
    return os.path.join(os.path.dirname(__file__), "face_regions_identity_lod%d.json" % lod)


OUT = default_out(0)
WEIGHT_GTE_STATS = (0.5, 0.9)

REGION_LABELS = {
    "skullTop": "두상 상단",
    "skullSide_L": "두상 좌",
    "skullSide_R": "두상 우",
    "skullBack": "두상 후면",
    "forheadTop": "이마 (상)",
    "forhead_L": "이마 (좌)",
    "forhead_R": "이마 (우)",
    "eye_L": "눈 (좌)",
    "eye_R": "눈 (우)",
    "cheekbone_L": "광대 (좌)",
    "cheekbone_R": "광대 (우)",
    "ear_L": "귀 (좌)",
    "ear_R": "귀 (우)",
    "nose": "코",
    "cheek_L": "볼 (좌)",
    "cheek_R": "볼 (우)",
    "mouth": "입",
    "chin": "턱",
    "jaw": "턱선",
    "neck": "목",
    "jaw_L": "턱 (좌)",
    "jaw_R": "턱 (우)",
}

REGION_COLORS = {
    "skullTop": [0.76, 0.66, 0.46],
    "skullSide_L": [0.76, 0.66, 0.46],
    "skullSide_R": [0.76, 0.66, 0.46],
    "skullBack": [0.76, 0.66, 0.46],
    "forheadTop": [0.95, 0.88, 0.22],
    "forhead_L": [0.50, 0.82, 0.95],
    "forhead_R": [0.50, 0.82, 0.95],
    "eye_L": [0.10, 0.22, 0.62],
    "eye_R": [0.10, 0.22, 0.62],
    "cheekbone_L": [0.88, 0.32, 0.72],
    "cheekbone_R": [0.88, 0.32, 0.72],
    "ear_L": [0.10, 0.22, 0.62],
    "ear_R": [0.10, 0.22, 0.62],
    "nose": [0.92, 0.52, 0.18],
    "cheek_L": [0.72, 0.88, 0.22],
    "cheek_R": [0.72, 0.88, 0.22],
    "mouth": [0.42, 0.78, 0.95],
    "chin": [0.72, 0.88, 0.22],
    "jaw": [0.76, 0.66, 0.46],
    "neck": [0.76, 0.66, 0.46],
    "jaw_L": [0.92, 0.52, 0.18],
    "jaw_R": [0.92, 0.52, 0.18],
}

SKIN = [0.78, 0.62, 0.55]


def head_mesh_index(rig, lod):
    for mi in rig.mesh_indices_for_lod(lod):
        if rig.mesh_names()[mi].startswith("head_"):
            return mi
    raise RuntimeError("head mesh not found for LOD %d" % lod)


def build_payload(names, regions, rig, pca_path: str, skinning_path: str, lod: int):
    lod0_w = build_lod0_weight_matrix(names, regions, FACE_LOD0_VERT_COUNT)
    mi = head_mesh_index(rig, lod)

    if lod == 0:
        w = lod0_w
        bary_count = 0
    else:
        bary = load_lod1_barycentric(skinning_path, lod=1)
        w = interpolate_weights_to_lod1(lod0_w, bary)
        bary_count = len(bary)

    dom_id, dom_w = dominant_from_weight_matrix(w)
    head_count = int(w.shape[0])
    mouth_idx = names.index("mouth")
    mouth_w = w[:, mouth_idx]
    palette = [REGION_COLORS.get(name, SKIN) for name in names]
    vertex_colors_soft = blend_region_colors(w, palette, SKIN)

    multi_region = int(((w > 1e-6).sum(axis=1) >= 2).sum())
    weight_sum = w.sum(axis=1)

    meta = []
    for rid, name in enumerate(names):
        col = w[:, rid]
        stats = {"nonzero": int((col > 0).sum()), "dominant": int((dom_id == rid).sum())}
        for thr in WEIGHT_GTE_STATS:
            stats["gte_%.1f" % thr] = int((col >= thr).sum())
        meta.append({
            "id": rid,
            "key": name,
            "label": REGION_LABELS.get(name, name),
            "color": REGION_COLORS.get(name, SKIN),
            "regionIndex": rid,
            "vertexCount": stats["dominant"],
            "weightStats": stats,
            "lod0NonzeroCount": sum(
                1 for v, wt in regions[name] if v < FACE_LOD0_VERT_COUNT and wt > 0
            ),
        })

    return {
        "headVertexCount": head_count,
        "meshName": rig.mesh_names()[mi],
        "partition": "soft",
        "method": "MetaHuman Identity PCA LOD%d — PatchBlendModel-style soft weights (partition of unity)" % lod,
        "assignment": {
            "runtime": "weighted sum over regions (PatchBlendModel::UpdateBaseVertices)",
            "landmark": "singleRegionPerLandmark = argmax weight per vertex",
            "analysisCutoff": "weightStats.gte_0.5 etc. are NOT used at Epic runtime",
        },
        "diagnostics": {
            "pcaLod0Vertices": FACE_LOD0_VERT_COUNT,
            "viewerLodVertices": head_count,
            "multiRegionVertices": multi_region,
            "weightSumMin": float(weight_sum.min()),
            "weightSumMax": float(weight_sum.max()),
            "weightSumMean": float(weight_sum.mean()),
            "barycentricEntries": bary_count,
            "serveLodExpected": lod,
            "meshName": rig.mesh_names()[mi],
        },
        "source": {
            "pca": pca_path,
            "skinningWeights": skinning_path if lod != 0 else None,
            "dna": DNA,
            "epicReference": "Viewer/MetaHumanFaceRegionReference",
        },
        "allRegions": names,
        "regions": meta,
        "vertexRegion": dom_id.astype(int).tolist(),
        "vertexDominantWeight": dom_w.tolist(),
        "vertexMouthWeight": mouth_w.astype(float).tolist(),
        "vertexColorsSoft": vertex_colors_soft,
    }


def main():
    import argparse

    ap = argparse.ArgumentParser(description="Export MetaHuman Identity face regions (PCA)")
    ap.add_argument("--lod", type=int, default=0, choices=[0, 1])
    ap.add_argument("--pca", default=None)
    ap.add_argument("--skinning", default=None)
    ap.add_argument("--dna", default=DNA)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out_path = args.out or default_out(args.lod)

    pca_path = str(resolve_geo_pca_path(args.pca))
    skinning_path = str(resolve_skinning_weights_path(args.skinning))
    print("loading PCA: %s" % pca_path, flush=True)
    names, regions = load_geo_pca(pca_path)
    if args.lod != 0:
        print("loading skinning: %s" % skinning_path, flush=True)

    print("loading DNA (LOD %d)..." % args.lod, flush=True)
    rig = riglogic.Rig(args.dna)
    payload = build_payload(names, regions, rig, pca_path, skinning_path, args.lod)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    if args.lod == 0:
        alias = os.path.join(os.path.dirname(__file__), "face_regions_identity.json")
        if os.path.normpath(out_path) != os.path.normpath(alias):
            with open(alias, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)

    print("wrote %s" % out_path, flush=True)
    for r in payload["regions"]:
        if r["vertexCount"] > 0:
            print("  %s: %d verts (LOD%d)" % (r["label"], r["vertexCount"], args.lod), flush=True)


if __name__ == "__main__":
    main()
