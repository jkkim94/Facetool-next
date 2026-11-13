# -*- coding: utf-8
"""Export per-control affected vertex IDs (deformation delta at control=1 vs neutral).

Outputs:
  control_vertex_summary.csv  — one row per control + vertex count + ID list
  control_vertex_detail.csv     — one row per (control, vertex_id) pair
"""
import csv
import os
import riglogic
from bake import column_to_raw

import numpy as np
from face_model import FaceModel

DNA = r"E:\Viewer\DNA\0421_V33\head.dna"
COLUMNS = r"E:\DatasetGen\AA_Learning_Dataset_test\metahuman\AI로_기후정책__0002.columns.txt"
OUT_DIR = r"E:\Viewer\riglogic_py"
THRESH_CM = 0.001

fm = FaceModel(DNA, lod=0, meshes="face")
neutral = fm.neutral_vertices
raw_names = list(fm.rig.raw_control_names())
gui_names = list(fm.rig.gui_control_names())

# GUI -> raw
gui_to_raw = {}
for i, gname in enumerate(gui_names):
    g = [0.0] * len(gui_names)
    g[i] = 1.0
    fm.rig.set_gui_controls(g)
    fm.rig.map_gui_to_raw()
    rv = list(fm.rig.raw_control_values())
    driven = [raw_names[j] for j, v in enumerate(rv) if abs(v) > 1e-6]
    if len(driven) == 1:
        gui_to_raw[driven[0]] = gname

raw_to_npy = {}
if os.path.exists(COLUMNS):
    with open(COLUMNS, encoding="utf-8") as f:
        for col in (l.strip() for l in f if l.strip()):
            raw_to_npy[column_to_raw(col)] = col

# global vertex -> (mesh, local_id)
vert_info = []
for mi, mname in enumerate(fm.mesh_names):
    for local in range(fm._meshes[mi]["V"]):
        vert_info.append((mname, local))

expr_raw = [r for r in raw_names if r.startswith("CTRL_expressions.")]

summary_rows = []
detail_rows = []

print("evaluating %d expression controls..." % len(expr_raw), flush=True)
for k, rname in enumerate(expr_raw):
    rv = np.zeros(fm.raw_control_count, np.float32)
    rv[raw_names.index(rname)] = 1.0
    v = fm.eval_raw(rv)
    delta = np.linalg.norm(v - neutral, axis=1)
    moved = np.where(delta > THRESH_CM)[0]

    ids = moved.tolist()
    npy = raw_to_npy.get(rname, "")
    gui = gui_to_raw.get(rname, "")
    expr_short = rname.replace("CTRL_expressions.", "")

    summary_rows.append({
        "raw_control": rname,
        "npy_column": npy,
        "gui_control": gui,
        "expression_name": expr_short,
        "affected_vertex_count": len(ids),
        "max_displacement_cm": round(float(delta[moved].max()) if len(moved) else 0.0, 6),
        "vertex_ids_global": ";".join(str(i) for i in ids),
    })

    for gid in ids:
        mname, local = vert_info[gid]
        detail_rows.append({
            "raw_control": rname,
            "npy_column": npy,
            "expression_name": expr_short,
            "vertex_id_global": int(gid),
            "mesh_name": mname,
            "vertex_id_local": int(local),
            "displacement_cm": round(float(delta[gid]), 6),
        })

    if k % 25 == 0:
        print("  %d/%d  last=%s verts=%d" % (
            k, len(expr_raw), expr_short, len(ids)), flush=True)

SUMMARY = os.path.join(OUT_DIR, "control_vertex_summary.csv")
DETAIL = os.path.join(OUT_DIR, "control_vertex_detail.csv")

sf = ["raw_control", "npy_column", "gui_control", "expression_name",
      "affected_vertex_count", "max_displacement_cm", "vertex_ids_global"]
with open(SUMMARY, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=sf)
    w.writeheader()
    w.writerows(summary_rows)

df = ["raw_control", "npy_column", "expression_name", "vertex_id_global",
      "mesh_name", "vertex_id_local", "displacement_cm"]
with open(DETAIL, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=df)
    w.writeheader()
    w.writerows(detail_rows)

print("\nWROTE", SUMMARY, "(%d rows)" % len(summary_rows))
print("WROTE", DETAIL, "(%d rows)" % len(detail_rows))
print("total vertices in mesh:", fm.vertex_count)
print("mesh layout:", list(zip(fm.mesh_names, [fm._meshes[i]['V'] for i in range(len(fm._meshes))])))
