# -*- coding: utf-8 -*-
"""Overlap analysis (requirement 9) + wider evaluation masks.

1. final lip mask vs each candidate set:
     overlap_ratio  = |A n B| / |A|     (A = final lip mask)
     precision_like = |A n B| / |B|     (B = candidate)
     jaccard        = |A n B| / |A u B|
2. miss / over-inclusion review numbers for the report
3. metahuman_head_lod0_mouth_region_mask.json
     lip mask dilated 1.0 cm (Euclidean, neutral mesh) over main-UV face verts
     -> lips + corners + lower philtrum + perioral skin (no full cheek/chin)
4. metahuman_head_lod0_lower_face_mask.json
     mouth region UNION jaw-control displacement support, trimmed to the
     lower-front face (below nose base, frontal hemisphere)

The Epic identity 'mouth' candidate failed the geometric index-space check
(see candidate metadata) and is excluded from mask construction per
requirement 8.2; it remains in the overlap table for documentation.

Usage:
  python analyze_overlap_lod0.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import riglogic  # noqa: E402

DNA = r"E:\Viewer\DNA\0421_V33\head.dna"
BASE = Path(DNA).parent / "lip_mask_v1"
CAND = BASE / "candidates"

MOUTH_DILATE_CM = 1.0


def load_ids(path: Path, key="ids"):
    d = json.loads(path.read_text(encoding="utf-8"))
    return d, set(int(v) for v in d[key])


def ratios(A: set, B: set):
    inter = len(A & B)
    union = len(A | B)
    return {
        "candidate_count": len(B),
        "intersection": inter,
        "overlap_ratio": round(inter / len(A), 4) if A else 0.0,
        "precision_like": round(inter / len(B), 4) if B else 0.0,
        "jaccard": round(inter / union, 4) if union else 0.0,
    }


def main() -> int:
    rig = riglogic.Rig(DNA)
    pos = rig.vertex_positions(0).astype(np.float64)
    n = int(pos.shape[0])

    mask = json.loads((BASE / "metahuman_head_lod0_lip_mask.json").read_text(encoding="utf-8"))
    A = set(int(v) for v in mask["combined"]["all_lip"])

    bs_d, bs = load_ids(CAND / "candidate_blendshape_lip_vertices.json")
    sk_d, sk = load_ids(CAND / "candidate_skinning_lip_vertices.json")
    dp_d, dp = load_ids(CAND / "candidate_displacement_lip_vertices.json")
    mr_d, mr = load_ids(CAND / "candidate_mouth_region_vertices.json")
    jw_d, jw = load_ids(CAND / "candidate_jaw_region_vertices.json")
    dp_rep = set(int(v) for v in dp_d["repeated_ids"])

    analysis = {
        "blendshape_vs_lip": ratios(A, bs),
        "skinning_vs_lip": ratios(A, sk),
        "displacement_vs_lip": ratios(A, dp),
        "displacement_repeated_vs_lip": ratios(A, dp_rep),
        "epic_mouth_region_vs_lip": {
            **ratios(A, mr),
            "index_space_verified": bool(
                mr_d["metadata"].get("index_space_verified", False)),
            "note": "Epic identity candidate; near-zero overlap is expected "
                    "if index_space_verified is false (different vertex order)",
        },
        "jaw_vs_lip": ratios(A, jw),
    }
    for k, v in analysis.items():
        print("%-32s overlap=%.3f precision=%.3f jaccard=%.3f (|B|=%d)"
              % (k, v["overlap_ratio"], v["precision_like"], v["jaccard"],
                 v["candidate_count"]), flush=True)

    # ---- miss / over-inclusion review ----
    missed_by_disp = sorted(A - dp)  # lip verts no lip-core control moves (suspect)
    lip_y = pos[sorted(A), 1]
    lip_z = pos[sorted(A), 2]
    review = {
        "lip_not_in_displacement_union": len(missed_by_disp),
        "lip_not_in_blendshape_union": len(A - bs),
        "lip_not_in_epic_mouth_region": len(A - mr),
        "note": "lip verts outside the displacement union would indicate dead "
                "(non-articulating) vertices in the mask; 0 or near-0 expected",
    }
    print("review:", review, flush=True)

    out = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "final_lip_mask_count": len(A),
        "total_head_vertex_count": n,
        "analysis": analysis,
        "review": review,
    }
    p = BASE / "overlap_analysis.json"
    p.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("wrote", p, flush=True)

    # ---------------- mouth region mask (lip dilation) ----------------
    # head mesh UVs: oral-cavity strips live at uv.v > 0.9 — exclude them from
    # the dilation domain so the region grows over facial skin only
    from bake import load_mesh_static
    mm = load_mesh_static(rig, 0)
    uv = mm["uv"]

    lip_ids = np.array(sorted(A))
    cx, cy, cz = pos[lip_ids].mean(axis=0)
    half_w = (pos[lip_ids, 0].max() - pos[lip_ids, 0].min()) / 2

    face_domain = (uv[:, 1] <= 0.9)
    dom_ids = np.where(face_domain)[0]
    # Euclidean distance to lip set (chunked to bound memory)
    lp = pos[lip_ids]
    dmin = np.full(n, np.inf)
    for i0 in range(0, len(dom_ids), 4000):
        chunk = dom_ids[i0:i0 + 4000]
        d = np.linalg.norm(pos[chunk][:, None, :] - lp[None, :, :], axis=2).min(axis=1)
        dmin[chunk] = d
    mouth_region = sorted(set(np.where(dmin <= MOUTH_DILATE_CM)[0].tolist()) | A)
    print("mouth_region mask: %d verts" % len(mouth_region), flush=True)

    mr_payload = {
        "metadata": {
            "protocol": "MH-LVE-MOUTHREGION-v1",
            "character_name": Path(DNA).parent.name,
            "mesh_name": "head_lod0_mesh",
            "lod": 0,
            "vertex_index_base": 0,
            "total_head_vertex_count": n,
            "source": "final lip mask dilated %.1f cm (Euclidean, neutral mesh) "
                      "over facial-skin UV domain (oral-cavity strips excluded)"
                      % MOUTH_DILATE_CM,
            "includes": ["lips", "mouth corners", "lower philtrum",
                         "perioral skin", "perioral crease zone"],
            "excludes": ["full cheeks", "full chin", "nose", "oral cavity interior"],
            "epic_mouth_region_note":
                "Epic identity 'mouth' region candidate failed the index-space "
                "geometric check and was NOT used (requirement 8.2)",
            "created_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "version": "v1.0",
        },
        "ids": mouth_region,
        "count": len(mouth_region),
    }
    p = BASE / "metahuman_head_lod0_mouth_region_mask.json"
    p.write_text(json.dumps(mr_payload, indent=2), encoding="utf-8")
    print("wrote", p, flush=True)

    # ---------------- lower face mask ----------------
    jaw_disp = set(int(v) for v in dp_d["jaw_union"])
    lower = jaw_disp | set(mouth_region)
    nose_base_y = cy + 2.4   # just under the nose
    chin_floor_y = cy - 5.2  # bottom of the chin; throat/neck excluded
    keep = []
    for v in sorted(lower):
        if chin_floor_y <= pos[v, 1] <= nose_base_y and pos[v, 2] > cz - 6.0 and \
                abs(pos[v, 0] - cx) < half_w + 4.5 and \
                (uv[v, 1] <= 0.9 or v in A):
            keep.append(v)
    lower_face = sorted(keep)
    print("lower_face mask: %d verts" % len(lower_face), flush=True)

    lf_payload = {
        "metadata": {
            "protocol": "MH-LVE-LOWERFACE-v1",
            "character_name": Path(DNA).parent.name,
            "mesh_name": "head_lod0_mesh",
            "lod": 0,
            "vertex_index_base": 0,
            "total_head_vertex_count": n,
            "source": "mouth region mask UNION jaw-control displacement support "
                      "(jawOpen/Left/Right/Fwd/Back > 0.02 cm), trimmed to the "
                      "lower-front face (below nose base, frontal hemisphere)",
            "includes": ["lips", "perioral area", "chin", "front jaw"],
            "excludes": ["nose", "upper face", "ears", "back of jawline", "neck",
                         "oral cavity interior"],
            "created_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "version": "v1.0",
        },
        "ids": lower_face,
        "count": len(lower_face),
    }
    p = BASE / "metahuman_head_lod0_lower_face_mask.json"
    p.write_text(json.dumps(lf_payload, indent=2), encoding="utf-8")
    print("wrote", p, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
