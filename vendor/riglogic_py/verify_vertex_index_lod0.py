# -*- coding: utf-8 -*-
"""Vertex index consistency verification for MetaHuman Head LOD0 (requirement 8.1/8.2).

Cross-checks, all against the DNA via the riglogic API (single source of truth):

1. head_lod0_mesh vertex count: rig API vs head_summary.json vs joint_vertices.json
2. blend_shape_targets.json: target count + per-target vertex indices (sampled)
3. joint_vertices.json: per-joint (vertex_id, weight) pairs vs rig.skin_weights (sampled)
4. 10 geometric landmark vertices: ids + neutral coordinates recorded for the report

DCC paths (Maya/Blender/FBX) are NOT used by the LVE pipeline; vertices are
evaluated directly from the DNA via RigLogic, so no DCC round-trip exists.

Usage:
  python verify_vertex_index_lod0.py [--dna E:\\Viewer\\DNA\\0421_V33\\head.dna]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import riglogic  # noqa: E402

DEFAULT_DNA = r"E:\Viewer\DNA\0421_V33\head.dna"


def head_mesh_index(rig, lod=0):
    for mi in rig.mesh_indices_for_lod(lod):
        if rig.mesh_names()[mi].startswith("head_"):
            return mi
    raise RuntimeError("head mesh not found for LOD %d" % lod)


def pick_landmarks(pos, lip_mask_path=None):
    """Geometric landmark vertex ids on the neutral head (x=left, y=up, z=front, cm).

    If the final lip mask exists, the five lip landmarks are taken from it
    (anatomically exact); otherwise geometric heuristics are used."""
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    lm = {}

    def pick(name, mask, score):
        ids = np.where(mask)[0]
        if ids.size == 0:
            lm[name] = None
            return
        vid = int(ids[np.argmax(score[ids])])
        lm[name] = {"vertex_id": vid, "position_cm": [round(float(c), 4) for c in pos[vid]]}

    z_max = float(z.max())
    y_mid = float(np.median(y))

    # nose tip: frontmost vertex of the whole head
    pick("nose_tip", np.ones(len(pos), bool), z)
    nose = pos[int(np.argmax(z))]

    mouth_band = (np.abs(x) < 3.5) & (y < nose[1] - 1.0) & (y > nose[1] - 6.0) & (z > z_max - 4.0)
    mouth_y = float(np.median(y[mouth_band])) if mouth_band.any() else y_mid

    lip_groups = None
    if lip_mask_path and Path(lip_mask_path).exists():
        lip_groups = json.loads(Path(lip_mask_path).read_text(encoding="utf-8"))[
            "lip_vertices"]
    if lip_groups:
        def pick_from(name, group, score_fn):
            ids = np.asarray(lip_groups[group], np.int64)
            vid = int(ids[np.argmax(score_fn(ids))])
            lm[name] = {"vertex_id": vid,
                        "position_cm": [round(float(c), 4) for c in pos[vid]],
                        "source": "lip mask group '%s'" % group}
        # lip centers: frontmost near the midline on the outer lip surface
        pick_from("upper_lip_center", "upper_outer_lip",
                  lambda ids: z[ids] - 8.0 * np.abs(x[ids]))
        pick_from("lower_lip_center", "lower_outer_lip",
                  lambda ids: z[ids] - 8.0 * np.abs(x[ids]))
        pick_from("left_mouth_corner", "left_mouth_corner", lambda ids: x[ids])
        pick_from("right_mouth_corner", "right_mouth_corner", lambda ids: -x[ids])
        mouth_y = float(np.median(
            y[np.asarray(lip_groups["upper_inner_lip"], np.int64)]))
    else:
        # upper / lower lip center: near x=0, frontmost in band above/below mouth line
        pick("upper_lip_center", mouth_band & (np.abs(x) < 0.25) & (y > mouth_y), z)
        pick("lower_lip_center", mouth_band & (np.abs(x) < 0.25) & (y < mouth_y), z)
        front_mouth = mouth_band & (z > z_max - 3.0)
        pick("left_mouth_corner", front_mouth, x)
        pick("right_mouth_corner", front_mouth, -x)
    # chin: below the mouth, frontmost near midline
    pick("chin", (np.abs(x) < 0.8) & (y < mouth_y - 1.5) & (y > mouth_y - 6.0), z)
    # forehead: above nose level near midline, frontmost
    pick("forehead", (np.abs(x) < 0.8) & (y > nose[1] + 6.0), z)
    # cheeks: lateral at nose height, frontish
    cheek_band = (y > nose[1] - 2.0) & (y < nose[1] + 2.0) & (z > 0)
    pick("left_cheek", cheek_band, x)
    pick("right_cheek", cheek_band, -x)
    # jawline: lateral below mouth
    jaw_band = (y < mouth_y - 2.0) & (y > mouth_y - 8.0) & (z > -2.0)
    pick("jawline_left", jaw_band, x + 0.3 * z)
    return lm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dna", default=DEFAULT_DNA)
    ap.add_argument("--samples", type=int, default=20, help="sampled targets/joints to compare")
    args = ap.parse_args()

    dna = Path(args.dna)
    dna_dir = dna.parent
    out_dir = dna_dir / "lip_mask_v1"
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(42)
    checks = []

    def check(name, ok, detail=""):
        checks.append({"check": name, "ok": bool(ok), "detail": str(detail)})
        print("[%s] %s %s" % ("OK " if ok else "FAIL", name, detail), flush=True)

    print("Loading DNA:", dna, flush=True)
    rig = riglogic.Rig(str(dna))
    mi = head_mesh_index(rig, 0)
    pos = rig.vertex_positions(mi).astype(np.float64)
    n_verts = int(pos.shape[0])
    check("head_lod0_mesh index", mi == 0, "mesh_index=%d" % mi)
    check("rig vertex count", n_verts == 24049, "rig=%d expected=24049" % n_verts)

    # --- head_summary.json ---
    summary = json.loads((dna_dir / "head_summary.json").read_text(encoding="utf-8"))
    s_mesh = next(m for m in summary["meshes"] if m["name"] == "head_lod0_mesh")
    check("head_summary vertex count", s_mesh["vertex_count"] == n_verts,
          "summary=%d rig=%d" % (s_mesh["vertex_count"], n_verts))
    n_targets = int(rig.blend_shape_target_count(mi))
    check("head_summary BS target count", s_mesh["blend_shape_target_count"] == n_targets,
          "summary=%d rig=%d" % (s_mesh["blend_shape_target_count"], n_targets))

    # --- blend_shape_targets.json (sampled per-target vertex index comparison) ---
    print("Loading blend_shape_targets.json ...", flush=True)
    bst = json.loads((dna_dir / "blend_shape_targets.json").read_text(encoding="utf-8"))
    b_mesh = next(m for m in bst["meshes"] if m["mesh_name"] == "head_lod0_mesh")
    check("blend_shape_targets target count", len(b_mesh["targets"]) == n_targets,
          "json=%d rig=%d" % (len(b_mesh["targets"]), n_targets))
    sample_t = rng.choice(n_targets, size=min(args.samples, n_targets), replace=False)
    bad_t = []
    max_vid_bst = -1
    for t in b_mesh["targets"]:
        vi = t["vertex_indices"]
        if vi:
            max_vid_bst = max(max_vid_bst, max(vi))
    for t_idx in sample_t:
        t = b_mesh["targets"][int(t_idx)]
        rig_vi = rig.blend_shape_target_vertex_indices(mi, int(t_idx))
        if not np.array_equal(np.asarray(t["vertex_indices"], np.int64),
                              np.asarray(rig_vi, np.int64)):
            bad_t.append(int(t_idx))
    check("blend_shape_targets sampled vertex indices", not bad_t,
          "%d targets sampled, mismatches=%s" % (len(sample_t), bad_t))
    check("blend_shape_targets max vertex id < count", max_vid_bst < n_verts,
          "max_vid=%d" % max_vid_bst)

    # --- joint_vertices.json (sampled per-joint weight comparison) ---
    print("Loading joint_vertices.json ...", flush=True)
    jv = json.loads((dna_dir / "joint_vertices.json").read_text(encoding="utf-8"))
    j_mesh = next(m for m in jv["meshes"] if m["mesh_name"] == "head_lod0_mesh")
    check("joint_vertices vertex count", j_mesh["vertex_count"] == n_verts,
          "json=%d rig=%d" % (j_mesh["vertex_count"], n_verts))
    w, ji = rig.skin_weights(mi)
    w = np.asarray(w, np.float64)
    ji = np.asarray(ji, np.int64)
    joints_json = j_mesh["joints"]
    sample_j = rng.choice(len(joints_json), size=min(args.samples, len(joints_json)),
                          replace=False)
    bad_j = []
    for j_idx in sample_j:
        jrec = joints_json[int(j_idx)]
        j = int(jrec["joint_index"])
        for v in jrec["vertices"][:50]:
            vid = int(v["vertex_id"])
            slots = np.where(ji[vid] == j)[0]
            wt = float(w[vid, slots[0]]) if slots.size else 0.0
            if abs(wt - float(v["weight"])) > 1e-4:
                bad_j.append((jrec["joint_name"], vid))
                break
    check("joint_vertices sampled weights", not bad_j,
          "%d joints sampled, mismatches=%s" % (len(sample_j), bad_j[:5]))

    # --- landmarks ---
    landmarks = pick_landmarks(
        pos, out_dir / "metahuman_head_lod0_lip_mask.json")
    n_found = sum(1 for v in landmarks.values() if v)
    check("landmark vertices picked", n_found == len(landmarks),
          "%d/%d" % (n_found, len(landmarks)))
    for name, v in landmarks.items():
        if v:
            print("  %-18s vid=%6d pos=%s" % (name, v["vertex_id"], v["position_cm"]),
                  flush=True)

    all_ok = all(c["ok"] for c in checks)
    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dna": str(dna.resolve()),
        "mesh_name": "head_lod0_mesh",
        "mesh_index": mi,
        "lod": 0,
        "vertex_index_base": 0,
        "vertex_count": n_verts,
        "blend_shape_target_count": n_targets,
        "all_ok": all_ok,
        "checks": checks,
        "landmark_vertices": landmarks,
        "notes": [
            "Single source of truth: head.dna via riglogic API (FaceModel pipeline).",
            "joint_vertices.json / blend_shape_targets.json exports verified against rig API.",
            "DCC (Maya/Blender/FBX) paths are not used anywhere in the LVE pipeline; "
            "vertex order is therefore defined solely by the DNA.",
        ],
    }
    out = out_dir / "vertex_index_verification.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\nWrote:", out, flush=True)
    print("ALL OK" if all_ok else "SOME CHECKS FAILED", flush=True)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
