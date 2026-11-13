# -*- coding: utf-8 -*-
"""Export per-GUI-control affected vertex IDs (eval_gui at control=1 vs neutral)."""
import json
import os

import numpy as np
from face_model import FaceModel

DNA = os.environ.get("RIGLOGIC_DNA", r"E:\Viewer\DNA\0421_V33\head.dna")
OUT = os.path.join(os.path.dirname(__file__), "gui_control_vertices.json")
THRESH_CM = 0.001

print("loading FaceModel...", flush=True)
fm = FaceModel(DNA, lod=0, meshes="face")
neutral = fm.neutral_vertices
gui_names = list(fm.rig.gui_control_names())
head_max = fm._meshes[0]["V"] if fm._meshes else fm.vertex_count
mesh_starts = [0]
for mm in fm._meshes:
    mesh_starts.append(mesh_starts[-1] + mm["V"])

counts = []
indices = []
names = []
meta = []

print("evaluating %d GUI controls..." % len(gui_names), flush=True)
for i, gname in enumerate(gui_names):
    g = np.zeros(fm.gui_control_count, np.float32)
    g[i] = 1.0
    v = fm.eval_gui(g)
    delta = np.linalg.norm(v - neutral, axis=1)
    moved = np.where(delta > THRESH_CM)[0].astype(np.int32)
    head_moved = moved[moved < head_max]

    counts.append(int(len(moved)))
    indices.extend(moved.tolist())
    names.append(gname)
    meta.append({
        "index": i,
        "name": gname,
        "count": int(len(moved)),
        "headCount": int(len(head_moved)),
        "maxCm": round(float(delta[moved].max()) if len(moved) else 0.0, 6),
    })
    if i % 20 == 0:
        print("  %d/%d  %s  verts=%d" % (i, len(gui_names), gname, len(moved)), flush=True)

offsets = [0]
for c in counts:
    offsets.append(offsets[-1] + c)

payload = {
    "headVertexCount": int(head_max),
    "numVertices": int(fm.vertex_count),
    "meshVertexStarts": mesh_starts,
    "guiCount": len(gui_names),
    "names": names,
    "counts": counts,
    "offsets": offsets,
    "indices": indices,
    "controls": meta,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f)

print("wrote %s: %d controls, %d index entries" % (OUT, len(gui_names), len(indices)))
