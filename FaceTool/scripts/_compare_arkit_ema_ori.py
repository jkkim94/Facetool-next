"""Compare ARKit EMA vs ORI CSV exports."""
import csv
import statistics as stats
from pathlib import Path

BASE = Path(
    r"d:\sd\unreal\260518_KBS_KOBA\Content\CaptureManager\Imports"
    r"\Mono_Video_Ingest\0510_Use\0510_과학IT_1"
)
EMA = BASE / "AS_MP_0430_과학IT_1_ARKit_ema.csv"
ORI = BASE / "AS_MP_0430_과학IT_1_ARKit_ori.csv"

MOUTH = [
    "JawOpen", "JawForward", "JawLeft", "JawRight", "MouthClose", "MouthFunnel", "MouthPucker",
    "MouthLeft", "MouthRight", "MouthSmileLeft", "MouthSmileRight", "MouthFrownLeft", "MouthFrownRight",
    "MouthDimpleLeft", "MouthDimpleRight", "MouthStretchLeft", "MouthStretchRight",
    "MouthRollLower", "MouthRollUpper", "MouthShrugLower", "MouthShrugUpper",
    "MouthPressLeft", "MouthPressRight", "MouthLowerDownLeft", "MouthLowerDownRight",
    "MouthUpperUpLeft", "MouthUpperUpRight",
]


def load(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def col_vals(rows, name):
    return [float(row[name]) for row in rows]


def main():
    ema = load(EMA)
    ori = load(ORI)
    n = len(ema)
    print(f"frames: ema={n} ori={len(ori)}")
    if n != len(ori):
        print("WARN: frame count mismatch")

    mouth = [c for c in MOUTH if c in ema[0]]

    print("\n=== Mouth curve max / mean (ori vs ema) ===")
    rows_out = []
    for c in mouth:
        o, e = col_vals(ori, c), col_vals(ema, c)
        rows_out.append((c, max(o), max(e), max(e) - max(o), stats.mean(o), stats.mean(e)))
    rows_out.sort(key=lambda x: -abs(x[3]))
    for c, om, em, d, oa, ea in rows_out:
        flag = " <<<" if abs(d) > 0.02 else ""
        print(f"{c:22} max {om:.4f} -> {em:.4f} ({d:+.4f})  mean {oa:.4f} -> {ea:.4f}{flag}")

    # Sum of mouth magnitudes per frame (L1)
    def mouth_l1(rows):
        out = []
        for row in rows:
            s = sum(abs(float(row[c])) for c in mouth)
            out.append(s)
        return out

    ori_l1 = mouth_l1(ori)
    ema_l1 = mouth_l1(ema)
    diffs = [ema_l1[i] - ori_l1[i] for i in range(n)]
    print("\n=== Per-frame sum(|mouth curves|) ===")
    print(f"ori  max={max(ori_l1):.4f} mean={stats.mean(ori_l1):.4f}")
    print(f"ema  max={max(ema_l1):.4f} mean={stats.mean(ema_l1):.4f}")
    print(f"ema-ori: max={max(diffs):+.4f} min={min(diffs):+.4f} mean={stats.mean(diffs):+.4f}")
    print(f"|diff| mean={stats.mean(abs(d) for d in diffs):.4f}")
    ema_higher = sum(1 for d in diffs if d > 0.01)
    ori_higher = sum(1 for d in diffs if d < -0.01)
    print(f"frames ema L1 > ori+0.01: {ema_higher} ({100*ema_higher/n:.1f}%)")
    print(f"frames ori L1 > ema+0.01: {ori_higher} ({100*ori_higher/n:.1f}%)")

  # open proxy
    def open_proxy(rows):
        out = []
        for row in rows:
            jo = float(row["JawOpen"])
            mc = float(row["MouthClose"])
            sm = float(row["MouthSmileLeft"]) + float(row["MouthSmileRight"])
            st = float(row["MouthStretchLeft"]) + float(row["MouthStretchRight"])
            fn = float(row["MouthFunnel"]) + float(row["MouthPucker"])
            out.append(jo * (1.0 - min(mc, 1.0)) + 0.25 * sm + 0.2 * st + 0.25 * fn)
        return out

    op_o, op_e = open_proxy(ori), open_proxy(ema)
    pd = [op_e[i] - op_o[i] for i in range(n)]
    print("\n=== open_proxy (JawOpen*(1-MouthClose) + smile/stretch/funnel) ===")
    print(f"ori max={max(op_o):.4f} mean={stats.mean(op_o):.4f}")
    print(f"ema max={max(op_e):.4f} mean={stats.mean(op_e):.4f}")
    print(f"ema-ori max={max(pd):+.4f} at frame {pd.index(max(pd))}")
    top = sorted(enumerate(pd), key=lambda x: -x[1])[:8]
    print("top frames ema > ori:")
    for i, d in top:
        if d > 0.01:
            print(f"  frame {i:5d} ori={op_o[i]:.4f} ema={op_e[i]:.4f} diff={d:+.4f}")

    # MouthPucker peak region
    for c in ["MouthPucker", "MouthFunnel", "JawOpen", "MouthClose"]:
        o, e = col_vals(ori, c), col_vals(ema, c)
        im = max(range(n), key=lambda i: e[i] - o[i])
        print(f"\n{c} largest ema-ori at frame {im}: ori={o[im]:.4f} ema={e[im]:.4f} diff={e[im]-o[im]:+.4f}")
        print(f"  global max ori={max(o):.4f} ema={max(e):.4f}")

    # values > 1
    for label, rows in [("ori", ori), ("ema", ema)]:
        over = [(c, max(col_vals(rows, c))) for c in mouth if max(col_vals(rows, c)) > 1.001]
        print(f"\n{label} channels > 1.0: {len(over)}")
        for c, v in sorted(over, key=lambda x: -x[1])[:8]:
            print(f"  {c}: {v:.4f}")

    # identical check
    same = 0
    for i in range(n):
        if all(abs(float(ema[i][c]) - float(ori[i][c])) < 1e-9 for c in mouth):
            same += 1
    print(f"\nframes with identical mouth curves: {same}/{n}")


if __name__ == "__main__":
    main()
