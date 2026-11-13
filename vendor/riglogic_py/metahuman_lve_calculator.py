# -*- coding: utf-8 -*-
"""Lip Vertex Error (LVE) calculator for MetaHuman Head LOD0.

Compares ground-truth vs predicted facial animation on the lip vertex mask
(metahuman_head_lod0_lip_mask.json, MH-LVE-LIP-v1).

Metrics (cm, mesh coordinate units):
  LVE_mean      mean per-frame average L2 error over all lip vertices
  LVE_max       mean per-frame MAXIMUM L2 error over lip vertices
                (FaceFormer/CodeTalker-style lip vertex error)
  per subgroup  mean L2 error for upper/lower x inner/outer + corners

Inputs (either form, for GT and prediction independently):
  * vertex NPY: (F, V, 3) float array, V = 24049 (head_lod0_mesh order)
  * control NPY evaluated through FaceModel (RigLogic):
      --gt-format arkit51 : (F, 51) ARKit blendshape weights
                            (LipReading_Dataset 3DETF layout, alphabetical)
      --gt-format raw     : (F, raw_control_count)

Smoke test (writes lve_calculation_test_result.csv next to the mask):
  python metahuman_lve_calculator.py --smoke

General use:
  python metahuman_lve_calculator.py --gt gt.npy --gt-format arkit51 ^
      --pred pred.npy --pred-format arkit51 --out result.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

DEFAULT_DNA = r"E:\Viewer\DNA\0421_V33\head.dna"
DEFAULT_MASK = r"E:\Viewer\DNA\0421_V33\lip_mask_v1\metahuman_head_lod0_lip_mask.json"
SMOKE_CLIP = r"E:\LipReading_Dataset_Synced\train\lip_J_1_F_02_E209_A_001_001.npy"

# 3DETF / LipReading_Dataset annotation layout: ARKit 51 names, alphabetical
ARKIT51 = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft",
    "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen",
    "jawRight", "mouthClose", "mouthDimpleLeft", "mouthDimpleRight",
    "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthLeft",
    "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft",
    "mouthPressRight", "mouthPucker", "mouthRight", "mouthRollLower",
    "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft",
    "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight",
]

# ARKit blendshape -> MetaHuman raw control suffix(es) (best-effort retarget,
# used for GT synthesis / smoke tests; LVE itself is mapping-agnostic)
ARKIT_TO_RAW = {
    "browDownLeft": ["browDownL"], "browDownRight": ["browDownR"],
    "browInnerUp": ["browRaiseInL", "browRaiseInR"],
    "browOuterUpLeft": ["browRaiseOuterL"], "browOuterUpRight": ["browRaiseOuterR"],
    "cheekPuff": ["mouthCheekBlowL", "mouthCheekBlowR"],
    "cheekSquintLeft": ["eyeCheekRaiseL"], "cheekSquintRight": ["eyeCheekRaiseR"],
    "eyeBlinkLeft": ["eyeBlinkL"], "eyeBlinkRight": ["eyeBlinkR"],
    "eyeLookDownLeft": ["eyeLookDownL"], "eyeLookDownRight": ["eyeLookDownR"],
    "eyeLookInLeft": ["eyeLookRightL"], "eyeLookInRight": ["eyeLookLeftR"],
    "eyeLookOutLeft": ["eyeLookLeftL"], "eyeLookOutRight": ["eyeLookRightR"],
    "eyeLookUpLeft": ["eyeLookUpL"], "eyeLookUpRight": ["eyeLookUpR"],
    "eyeSquintLeft": ["eyeSquintInnerL"], "eyeSquintRight": ["eyeSquintInnerR"],
    "eyeWideLeft": ["eyeWidenL"], "eyeWideRight": ["eyeWidenR"],
    "jawForward": ["jawFwd"], "jawLeft": ["jawLeft"], "jawOpen": ["jawOpen"],
    "jawRight": ["jawRight"],
    "mouthClose": ["mouthLipsTogetherUL", "mouthLipsTogetherUR",
                   "mouthLipsTogetherDL", "mouthLipsTogetherDR"],
    "mouthDimpleLeft": ["mouthDimpleL"], "mouthDimpleRight": ["mouthDimpleR"],
    "mouthFrownLeft": ["mouthCornerDepressL"],
    "mouthFrownRight": ["mouthCornerDepressR"],
    "mouthFunnel": ["mouthFunnelUL", "mouthFunnelUR",
                    "mouthFunnelDL", "mouthFunnelDR"],
    "mouthLeft": ["mouthLeft"], "mouthRight": ["mouthRight"],
    "mouthLowerDownLeft": ["mouthLowerLipDepressL"],
    "mouthLowerDownRight": ["mouthLowerLipDepressR"],
    "mouthPressLeft": ["mouthLipsPressL"], "mouthPressRight": ["mouthLipsPressR"],
    "mouthPucker": ["mouthLipsPurseUL", "mouthLipsPurseUR",
                    "mouthLipsPurseDL", "mouthLipsPurseDR"],
    "mouthRollLower": ["mouthLowerLipRollInL", "mouthLowerLipRollInR"],
    "mouthRollUpper": ["mouthUpperLipRollInL", "mouthUpperLipRollInR"],
    "mouthShrugLower": ["mouthLipsPushDL", "mouthLipsPushDR"],
    "mouthShrugUpper": ["mouthLipsPushUL", "mouthLipsPushUR"],
    "mouthSmileLeft": ["mouthCornerPullL"], "mouthSmileRight": ["mouthCornerPullR"],
    "mouthStretchLeft": ["mouthStretchL"], "mouthStretchRight": ["mouthStretchR"],
    "mouthUpperUpLeft": ["mouthUpperLipRaiseL"],
    "mouthUpperUpRight": ["mouthUpperLipRaiseR"],
    "noseSneerLeft": ["noseWrinkleL"], "noseSneerRight": ["noseWrinkleR"],
}

GROUP_ORDER = ("upper_outer_lip", "lower_outer_lip", "upper_inner_lip",
               "lower_inner_lip", "left_mouth_corner", "right_mouth_corner")


def load_mask(path: str):
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    groups = {g: np.asarray(d["lip_vertices"][g], np.int64) for g in GROUP_ORDER}
    all_lip = np.asarray(d["combined"]["all_lip"], np.int64)
    return d, groups, all_lip


def arkit_raw_matrix(fm) -> np.ndarray:
    """(51, raw_control_count) routing matrix for ARKit weights."""
    idx = {n.replace("CTRL_expressions.", ""): i
           for i, n in enumerate(fm.rig.raw_control_names())}
    M = np.zeros((len(ARKIT51), fm.raw_control_count), np.float32)
    missing = []
    for r, name in enumerate(ARKIT51):
        for suffix in ARKIT_TO_RAW.get(name, []):
            if suffix in idx:
                M[r, idx[suffix]] = 1.0
            else:
                missing.append(suffix)
    if missing:
        print("WARNING: unmapped raw controls:", missing, flush=True)
    return M


def controls_to_vertices(arr: np.ndarray, fmt: str, fm) -> np.ndarray:
    if fmt == "vertices":
        if arr.ndim != 3 or arr.shape[2] != 3:
            raise ValueError("vertex NPY must be (F, V, 3), got %s" % (arr.shape,))
        return np.asarray(arr, np.float64)
    if fmt == "arkit51":
        if arr.shape[1] != len(ARKIT51):
            raise ValueError("arkit51 NPY must be (F, 51), got %s" % (arr.shape,))
        raws = np.clip(arr, 0.0, 1.0).astype(np.float32) @ arkit_raw_matrix(fm)
        raws = np.clip(raws, 0.0, 1.0)
        return fm.eval_raw_batch(raws)
    if fmt == "raw":
        return fm.eval_raw_batch(np.asarray(arr, np.float32))
    raise ValueError("unknown format: " + fmt)


def compute_lve(gt: np.ndarray, pred: np.ndarray, groups, all_lip):
    if gt.shape != pred.shape:
        raise ValueError("GT %s and prediction %s shapes differ"
                         % (gt.shape, pred.shape))
    err = np.linalg.norm(gt - pred, axis=2)  # (F, V) per-vertex L2, cm
    rows = []
    for f in range(err.shape[0]):
        e = err[f]
        row = {
            "frame": f,
            "lve_mean": float(e[all_lip].mean()),
            "lve_max": float(e[all_lip].max()),
        }
        for g, ids in groups.items():
            row[g] = float(e[ids].mean()) if len(ids) else 0.0
        rows.append(row)
    summary = {
        "frames": len(rows),
        "lip_vertex_count": int(len(all_lip)),
        "LVE_mean_cm": float(np.mean([r["lve_mean"] for r in rows])),
        "LVE_max_cm": float(np.mean([r["lve_max"] for r in rows])),
        "upper_lip_error_cm": float(np.mean(
            [(r["upper_outer_lip"] + r["upper_inner_lip"]) / 2 for r in rows])),
        "lower_lip_error_cm": float(np.mean(
            [(r["lower_outer_lip"] + r["lower_inner_lip"]) / 2 for r in rows])),
        "corner_error_cm": float(np.mean(
            [(r["left_mouth_corner"] + r["right_mouth_corner"]) / 2 for r in rows])),
    }
    for g in GROUP_ORDER:
        summary["%s_error_cm" % g] = float(np.mean([r[g] for r in rows]))
    return rows, summary


def write_csv(path: Path, rows):
    cols = ["frame", "lve_mean", "lve_max", *GROUP_ORDER]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: ("%.6f" % r[c]) if c != "frame" else r[c] for c in cols})


def main() -> int:
    ap = argparse.ArgumentParser(description="MetaHuman LOD0 Lip Vertex Error")
    ap.add_argument("--gt", help="GT NPY ((F,V,3) vertices or control sequence)")
    ap.add_argument("--pred", help="prediction NPY")
    ap.add_argument("--gt-format", default="vertices",
                    choices=("vertices", "arkit51", "raw"))
    ap.add_argument("--pred-format", default="vertices",
                    choices=("vertices", "arkit51", "raw"))
    ap.add_argument("--mask", default=DEFAULT_MASK)
    ap.add_argument("--dna", default=DEFAULT_DNA)
    ap.add_argument("--out", default="lve_result.csv")
    ap.add_argument("--max-frames", type=int, default=0)
    ap.add_argument("--smoke", action="store_true",
                    help="synthetic smoke test on one dataset clip")
    args = ap.parse_args()

    mask_doc, groups, all_lip = load_mask(args.mask)
    print("lip mask: %d verts (%s)" % (
        len(all_lip), mask_doc["metadata"]["protocol"]), flush=True)

    fm = None

    def get_fm():
        nonlocal fm
        if fm is None:
            from face_model import FaceModel
            print("loading FaceModel (LOD0 head)...", flush=True)
            fm = FaceModel(args.dna, lod=0, meshes="head")
        return fm

    if args.smoke:
        print("SMOKE TEST: clip =", SMOKE_CLIP, flush=True)
        clip = np.load(SMOKE_CLIP)
        if args.max_frames:
            clip = clip[:args.max_frames]
        f = get_fm()
        gt_v = controls_to_vertices(clip, "arkit51", f)
        # synthetic prediction: damped controls + correlated noise
        rng = np.random.default_rng(7)
        pred_c = np.clip(clip * 0.9 + rng.normal(0, 0.02, clip.shape), 0, 1)
        pred_v = controls_to_vertices(pred_c, "arkit51", f)
        out_path = Path(args.mask).parent / "lve_calculation_test_result.csv"
    else:
        if not args.gt or not args.pred:
            ap.error("--gt and --pred are required (or use --smoke)")
        gt_arr = np.load(args.gt)
        pred_arr = np.load(args.pred)
        if args.max_frames:
            gt_arr, pred_arr = gt_arr[:args.max_frames], pred_arr[:args.max_frames]
        need_fm = "vertices" not in (args.gt_format, args.pred_format) or \
            args.gt_format != "vertices" or args.pred_format != "vertices"
        f = get_fm() if need_fm else None
        gt_v = controls_to_vertices(gt_arr, args.gt_format, f)
        pred_v = controls_to_vertices(pred_arr, args.pred_format, f)
        out_path = Path(args.out)

    if gt_v.shape[1] != int(mask_doc["metadata"]["total_head_vertex_count"]):
        raise ValueError("vertex count %d != mask head vertex count %s"
                         % (gt_v.shape[1],
                            mask_doc["metadata"]["total_head_vertex_count"]))

    rows, summary = compute_lve(gt_v, pred_v, groups, all_lip)
    write_csv(out_path, rows)
    print("frame-wise CSV:", out_path, flush=True)
    print(json.dumps(summary, indent=2), flush=True)
    summary_path = out_path.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("summary:", summary_path, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
