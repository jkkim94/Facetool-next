# -*- coding: utf-8 -*-
"""Auxiliary lip-vertex candidate sets for Head LOD0 (verification ONLY).

Per the requirement update, RigLogic-output-stage information is used as
supporting evidence for the anatomical lip mask, never as its definition:

  B. blendshape delta support   -> candidate_blendshape_lip_vertices.json
  D. joint skinning influence   -> candidate_skinning_lip_vertices.json
  E. final mesh displacement    -> candidate_displacement_lip_vertices.json
  Epic identity 'mouth' region  -> candidate_mouth_region_vertices.json
  jaw joint skinning influence  -> candidate_jaw_region_vertices.json

Usage:
  python export_lip_candidates_lod0.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import riglogic  # noqa: E402
from face_model import FaceModel  # noqa: E402

DNA = r"E:\Viewer\DNA\0421_V33\head.dna"
EPIC_MOUTH_JSON = r"E:\Viewer\MetaHumanFaceRegionReference\data\mouth_region_head_lod0.json"
OUT_DIR = Path(DNA).parent / "lip_mask_v1" / "candidates"

BS_DELTA_EPS_CM = 0.02
DISP_EPS_CM = 0.02
SKIN_THRESHOLDS = (0.01, 0.05, 0.1)

# blendshape channels considered mouth/lip-related (channel naming: mouth_*, jaw_*)
BS_NAME_RE = re.compile(r"(?i)(mouth|jaw|lip)")
BS_NAME_EXCLUDE_RE = re.compile(r"(?i)(throat|neck)")

# facial joints
LIP_JOINT_RE = re.compile(r"(?i)lip")
JAW_JOINT_RE = re.compile(r"(?i)(FACIAL_C_Jaw|FACIAL_[LR]_Jaw|jawline|chin)")

# requirement 5.2 control groups mapped to UE 5.6 / MH.6 raw control naming
# (ARKit-style names in the spec -> closest MetaHuman raw controls):
#   mouthClose -> mouthLipsTogether*, mouthPucker -> mouthLipsPurse*,
#   mouthRollUpper/Lower -> mouth{Upper,Lower}LipRoll{In,Out}*,
#   mouthShrug* -> mouthLipsPush*/mouthLipsPull*,
#   mouthUpperUpL/R -> mouthUpperLipRaiseL/R,
#   mouthLowerDownL/R -> mouthLowerLipDepressL/R,
#   mouthSmile -> mouthCornerPull/mouthCornerUp, mouthFrown -> mouthCornerDepress/Down
LIP_CORE_PREFIXES = (
    "mouthLipsTogether", "mouthFunnel", "mouthLipsPurse",
    "mouthUpperLipRollIn", "mouthUpperLipRollOut",
    "mouthLowerLipRollIn", "mouthLowerLipRollOut",
    "mouthLipsPush", "mouthLipsPull", "mouthPress", "mouthLipsPress",
    "mouthUpperLipRaise", "mouthLowerLipDepress", "mouthLipsTowards",
)
MOUTH_REGION_PREFIXES = (
    "mouthCornerPull", "mouthSharpCornerPull", "mouthCornerDepress",
    "mouthDimple", "mouthStretch", "mouthCornerUp", "mouthCornerDown",
    "mouthCornerWide", "mouthCornerNarrow",
)
MOUTH_REGION_EXACT = ("mouthLeft", "mouthRight", "mouthUp", "mouthDown")
JAW_PREFIXES = ("jawOpen", "jawLeft", "jawRight", "jawFwd", "jawForward", "jawBack")


def _suffix(raw_name: str) -> str:
    return raw_name.replace("CTRL_expressions.", "").replace("CTRL_expressions_", "")


def controls_for(fm: FaceModel, prefixes, exact=()) -> list[tuple[int, str]]:
    out = []
    for i, name in enumerate(fm.rig.raw_control_names()):
        s = _suffix(name)
        if s in exact or any(s.startswith(p) for p in prefixes):
            out.append((i, name))
    return out


def displacement_sets(fm: FaceModel, controls, eps_cm: float):
    base = fm.eval_raw(np.zeros(fm.raw_control_count, np.float32))
    per_ctrl = {}
    for idx, name in controls:
        raw = np.zeros(fm.raw_control_count, np.float32)
        raw[idx] = 1.0
        moved = fm.eval_raw(raw)
        delta = np.linalg.norm(moved - base, axis=1)
        per_ctrl[name] = np.where(delta > eps_cm)[0]
    return per_ctrl


def meta(extra=None):
    d = {
        "dna": str(Path(DNA).resolve()),
        "mesh_name": "head_lod0_mesh",
        "lod": 0,
        "vertex_index_base": 0,
        "created_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "purpose": "auxiliary candidate set for lip mask verification "
                   "(NOT a lip mask definition source)",
    }
    if extra:
        d.update(extra)
    return d


def write(path: Path, payload: dict):
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("wrote", path, flush=True)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rig = riglogic.Rig(DNA)
    n = int(rig.vertex_positions(0).shape[0])

    # ---------------- B. blendshape candidates ----------------
    ch_names = list(rig.blend_shape_channel_names())
    per_channel = {}
    for t in range(rig.blend_shape_target_count(0)):
        ch = int(rig.blend_shape_channel_index(0, t))
        name = ch_names[ch] if ch < len(ch_names) else "ch_%d" % ch
        if not BS_NAME_RE.search(name) or BS_NAME_EXCLUDE_RE.search(name):
            continue
        vidx = np.asarray(rig.blend_shape_target_vertex_indices(0, t), np.int64)
        deltas = np.asarray(rig.blend_shape_target_deltas(0, t), np.float64)
        if vidx.size == 0:
            continue
        mag = np.linalg.norm(deltas, axis=1)
        sel = vidx[mag > BS_DELTA_EPS_CM]
        if sel.size:
            per_channel.setdefault(name, set()).update(int(v) for v in sel)
    bs_union = sorted(set().union(*per_channel.values())) if per_channel else []
    # vertices supported by many mouth/lip channels (repeated response)
    counts = np.zeros(n, np.int32)
    for ids in per_channel.values():
        counts[list(ids)] += 1
    k = max(2, len(per_channel) // 10)
    bs_repeated = sorted(int(v) for v in np.where(counts >= k)[0])
    write(OUT_DIR / "candidate_blendshape_lip_vertices.json", {
        "metadata": meta({
            "method": "DNA blendshape target deltas, |delta| > %.3f cm" % BS_DELTA_EPS_CM,
            "channel_name_filter": BS_NAME_RE.pattern,
            "channel_count": len(per_channel),
            "repeated_min_channels": k,
        }),
        "ids": bs_union,
        "count": len(bs_union),
        "repeated_ids": bs_repeated,
        "repeated_count": len(bs_repeated),
        "per_channel_counts": {kk: len(vv) for kk, vv in sorted(per_channel.items())},
    })

    # ---------------- D. lip joint skinning candidates ----------------
    w, ji = rig.skin_weights(0)
    w = np.asarray(w, np.float64)
    ji = np.asarray(ji, np.int64)
    joint_names = list(rig.joint_names())
    lip_joints = [j for j, nm in enumerate(joint_names) if LIP_JOINT_RE.search(nm)]
    jaw_joints = [j for j, nm in enumerate(joint_names) if JAW_JOINT_RE.search(nm)]
    print("lip joints: %d, jaw/chin joints: %d" % (len(lip_joints), len(jaw_joints)),
          flush=True)

    def joint_influence(joints):
        mask = np.isin(ji, np.asarray(joints, np.int64))
        return (w * mask).sum(axis=1)  # summed weight from the joint group

    lip_w = joint_influence(lip_joints)
    by_thr = {("weight_gt_%g" % t): sorted(int(v) for v in np.where(lip_w > t)[0])
              for t in SKIN_THRESHOLDS}
    write(OUT_DIR / "candidate_skinning_lip_vertices.json", {
        "metadata": meta({
            "method": "summed skin weight of lip-named facial joints",
            "joint_name_filter": LIP_JOINT_RE.pattern,
            "joint_count": len(lip_joints),
            "joint_names": [joint_names[j] for j in lip_joints],
            "thresholds": list(SKIN_THRESHOLDS),
            "primary_threshold": 0.05,
        }),
        "ids": by_thr["weight_gt_0.05"],
        "count": len(by_thr["weight_gt_0.05"]),
        "by_threshold": {kk: {"ids": vv, "count": len(vv)} for kk, vv in by_thr.items()},
    })

    jaw_w = joint_influence(jaw_joints)
    jaw_ids = sorted(int(v) for v in np.where(jaw_w > 0.05)[0])
    write(OUT_DIR / "candidate_jaw_region_vertices.json", {
        "metadata": meta({
            "method": "summed skin weight of jaw/chin facial joints > 0.05",
            "joint_name_filter": JAW_JOINT_RE.pattern,
            "joint_count": len(jaw_joints),
            "joint_names": [joint_names[j] for j in jaw_joints],
        }),
        "ids": jaw_ids,
        "count": len(jaw_ids),
    })

    # ---------------- Epic identity mouth region ----------------
    epic = json.loads(Path(EPIC_MOUTH_JSON).read_text(encoding="utf-8"))
    weights = {int(vid): float(ww) for vid, ww in epic["mouth_vertex_weights"]}
    # geometric sanity check: a genuine mouth region must cluster around the lips
    epic_ids = np.array(sorted(weights))
    p = rig.vertex_positions(0).astype(np.float64)[epic_ids]
    spread_y = float(p[:, 1].max() - p[:, 1].min())
    index_space_ok = spread_y < 8.0  # mouth region should span only a few cm
    if not index_space_ok:
        print("WARNING: Epic mouth-region candidate FAILS geometric check "
              "(y spread %.1f cm) — index space mismatch vs DNA mesh order; "
              "excluded from mask construction (requirement 8.2)" % spread_y,
              flush=True)
    write(OUT_DIR / "candidate_mouth_region_vertices.json", {
        "metadata": meta({
            "method": "Epic identity PCA region 'mouth' (geo_and_bindpose.pca), weight > 0",
            "source": EPIC_MOUTH_JSON,
            "region_index": epic.get("region_index"),
            "index_space_verified": index_space_ok,
            "geometric_check_y_spread_cm": round(spread_y, 2),
            "warning": None if index_space_ok else
                "vertex ids do NOT map to DNA head_lod0_mesh order "
                "(region scatters across the whole face); informational only, "
                "MUST NOT be used for mask construction",
        }),
        "ids": sorted(weights),
        "count": len(weights),
        "by_threshold": {
            "weight_gt_0.5": {"ids": sorted(v for v, ww in weights.items() if ww > 0.5)},
            "argmax_not_exported": "see Epic reference README",
        },
    })

    # ---------------- E. final mesh displacement ----------------
    print("Evaluating displacement sensitivity (FaceModel LOD0)...", flush=True)
    fm = FaceModel(DNA, lod=0, meshes="head")
    groups = {
        "lip_core": controls_for(fm, LIP_CORE_PREFIXES),
        "mouth_region": controls_for(fm, MOUTH_REGION_PREFIXES, MOUTH_REGION_EXACT),
        "jaw": controls_for(fm, JAW_PREFIXES),
    }
    for gname, ctrls in groups.items():
        print("  %s: %d controls" % (gname, len(ctrls)), flush=True)

    disp = {g: displacement_sets(fm, ctrls, DISP_EPS_CM) for g, ctrls in groups.items()}

    def union(d):
        s = set()
        for ids in d.values():
            s.update(int(v) for v in ids)
        return sorted(s)

    lip_core_union = union(disp["lip_core"])
    counts = np.zeros(n, np.int32)
    for ids in disp["lip_core"].values():
        counts[ids] += 1
    rep_k = max(2, len(disp["lip_core"]) // 2)
    repeated = sorted(int(v) for v in np.where(counts >= rep_k)[0])

    write(OUT_DIR / "candidate_displacement_lip_vertices.json", {
        "metadata": meta({
            "method": "single-control 1.0 perturbation, |displacement| > %.3f cm"
                      % DISP_EPS_CM,
            "control_groups": {g: [nm for _, nm in ctrls]
                               for g, ctrls in groups.items()},
            "repeated_min_controls": rep_k,
        }),
        "ids": lip_core_union,
        "count": len(lip_core_union),
        "repeated_ids": repeated,
        "repeated_count": len(repeated),
        "mouth_region_union": union(disp["mouth_region"]),
        "jaw_union": union(disp["jaw"]),
        "per_control_counts": {g: {nm: int(len(ids)) for nm, ids in d.items()}
                               for g, d in disp.items()},
    })
    print("done", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
