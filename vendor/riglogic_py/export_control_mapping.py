# -*- coding: utf-8 -*-
"""Export NPY / Raw / GUI control matching to CSV."""
import csv
import os
from collections import defaultdict

import riglogic
from bake import build_control_mapping, column_to_raw

DNA = r"E:\Viewer\DNA\0421_V33\head.dna"
COLUMNS = r"E:\DatasetGen\AA_Learning_Dataset_test\metahuman\AI로_기후정책__0002.columns.txt"
OUT = r"E:\Viewer\riglogic_py\control_mapping.csv"

rig = riglogic.Rig(DNA)
gui_names = list(rig.gui_control_names())
raw_names = list(rig.raw_control_names())

with open(COLUMNS, encoding="utf-8") as f:
    npy_columns = [l.strip() for l in f if l.strip()]

# --- GUI -> Raw (via mapGUIToRawControls) ---
gui_to_raw = {}
for i, gname in enumerate(gui_names):
    g = [0.0] * len(gui_names)
    g[i] = 1.0
    rig.set_gui_controls(g)
    rig.map_gui_to_raw()
    rv = list(rig.raw_control_values())
    driven = [raw_names[j] for j, v in enumerate(rv) if abs(v) > 1e-6]
    gui_to_raw[gname] = driven[0] if len(driven) == 1 else (";".join(driven) if driven else "")

raw_to_gui = defaultdict(list)
for gname, rname in gui_to_raw.items():
    if rname and ";" not in rname:
        raw_to_gui[rname].append(gname)

# --- NPY column -> Raw ---
npy_to_raw = {}
for col in npy_columns:
    npy_to_raw[col] = column_to_raw(col)

raw_to_npy = defaultdict(list)
for col, rname in npy_to_raw.items():
    raw_to_npy[rname].append(col)

raw_set = set(raw_names)
npy_raw_set = set(npy_to_raw.values())
expr_raw = [r for r in raw_names if r.startswith("CTRL_expressions.")]
expr_raw_set = set(expr_raw)

rows = []

# Section A: expression raw controls — tri-layer status
for rname in sorted(expr_raw):
    npy_cols = raw_to_npy.get(rname, [])
    npy_name = npy_cols[0] if len(npy_cols) == 1 else (";".join(npy_cols) if npy_cols else "")
    gui_list = raw_to_gui.get(rname, [])
    gui_name = gui_list[0] if len(gui_list) == 1 else (";".join(gui_list) if gui_list else "")

    has_npy = bool(npy_cols)
    has_gui = bool(gui_list)
    if has_npy and has_gui:
        match_type = "matched_all"
    elif has_npy and not has_gui:
        match_type = "npy_raw_only"
    elif has_gui and not has_npy:
        match_type = "gui_raw_only"
    else:
        match_type = "raw_only"

    rows.append({
        "section": "expression",
        "match_type": match_type,
        "npy_column": npy_name,
        "raw_control": rname,
        "gui_control": gui_name,
        "in_npy": "Y" if has_npy else "N",
        "in_gui": "Y" if has_gui else "N",
        "note": "",
    })

# Section B: NPY columns that do NOT map to any raw control
for col in sorted(npy_columns):
    rname = npy_to_raw[col]
    if rname not in raw_set:
        rows.append({
            "section": "npy_unmapped",
            "match_type": "npy_no_raw",
            "npy_column": col,
            "raw_control": rname,
            "gui_control": "",
            "in_npy": "Y",
            "in_gui": "N",
            "note": "column name has no matching raw control in DNA",
        })

# Section C: non-expression raw (head/neck joints)
for rname in sorted(raw_names):
    if rname.startswith("CTRL_expressions."):
        continue
    npy_cols = raw_to_npy.get(rname, [])
    npy_name = npy_cols[0] if len(npy_cols) == 1 else (";".join(npy_cols) if npy_cols else "")
    rows.append({
        "section": "joint",
        "match_type": "matched_npy_raw" if npy_cols else "raw_only",
        "npy_column": npy_name,
        "raw_control": rname,
        "gui_control": "",
        "in_npy": "Y" if npy_cols else "N",
        "in_gui": "N",
        "note": "head/neck quaternion — not on GUI board",
    })

# Section D: GUI controls with no raw target
for gname in sorted(gui_names):
    rname = gui_to_raw.get(gname, "")
    if not rname:
        rows.append({
            "section": "gui_unmapped",
            "match_type": "gui_no_raw",
            "npy_column": "",
            "raw_control": "",
            "gui_control": gname,
            "in_npy": "N",
            "in_gui": "Y",
            "note": "GUI control does not drive any raw control",
        })

FIELDNAMES = [
    "section", "match_type", "npy_column", "raw_control", "gui_control",
    "in_npy", "in_gui", "note",
]

with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=FIELDNAMES)
    w.writeheader()
    w.writerows(rows)

# summary stats
from collections import Counter
c = Counter(r["match_type"] for r in rows if r["section"] == "expression")
print("WROTE", OUT)
print("total rows:", len(rows))
print("\n=== expression match_type counts ===")
for k, v in sorted(c.items()):
    print(" ", k, v)
print("\n=== other sections ===")
print(" npy_unmapped:", sum(1 for r in rows if r["section"] == "npy_unmapped"))
print(" joint:", sum(1 for r in rows if r["section"] == "joint"))
print(" gui_unmapped:", sum(1 for r in rows if r["section"] == "gui_unmapped"))
