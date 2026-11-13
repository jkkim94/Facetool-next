# -*- coding: utf-8 -*-
"""Exploratory: mouth-area UV layout + red lip stroke on head_lod0_mesh."""
import sys
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_ROOT))

import riglogic
from bake import load_mesh_static
from gray_head_uv import DNA, REGION_TEXTURE, load_texture, is_lip_color, sample_rgb

rig = riglogic.Rig(DNA)
mm = load_mesh_static(rig, 0)
pos, uv, tris = mm["pos"], mm["uv"], mm["tris"]
tex = load_texture(REGION_TEXTURE)
V = mm["V"]
print("V=", V, "tex=", tex.shape)

stroke = np.array([vi for vi in range(V) if is_lip_color(sample_rgb(tex, uv[vi, 0], uv[vi, 1]))])
print("stroke verts:", len(stroke))
su, sv = uv[stroke, 0], uv[stroke, 1]
print("stroke UV bbox: u[%.4f, %.4f] v[%.4f, %.4f]" % (su.min(), su.max(), sv.min(), sv.max()))
print("stroke pos bbox: x[%.2f, %.2f] y[%.2f, %.2f] z[%.2f, %.2f]" % (
    pos[stroke, 0].min(), pos[stroke, 0].max(),
    pos[stroke, 1].min(), pos[stroke, 1].max(),
    pos[stroke, 2].min(), pos[stroke, 2].max()))

# UV window around the stroke
pad = 0.06
u0, u1 = su.min() - pad, su.max() + pad
v0, v1 = sv.min() - pad, sv.max() + pad
win = np.where((uv[:, 0] >= u0) & (uv[:, 0] <= u1) & (uv[:, 1] >= v0) & (uv[:, 1] <= v1))[0]
print("verts in UV window:", len(win))

h, w = tex.shape[:2]
px0, px1 = int(u0 * (w - 1)), int(u1 * (w - 1))
py0, py1 = int((1 - v1) * (h - 1)), int((1 - v0) * (h - 1))
crop = tex[py0:py1, px0:px1]

fig, axes = plt.subplots(1, 3, figsize=(24, 8))
ax = axes[0]
ax.imshow(crop, extent=[u0, u1, v0, v1], origin="upper")
ax.scatter(uv[win, 0], uv[win, 1], s=1.5, c="cyan", alpha=0.6)
ax.scatter(su, sv, s=3, c="lime")
ax.set_title("UV window: texture + verts (lime=red stroke)")
ax.set_aspect("equal")

# 3D front view of window verts (x vs y), colored by z depth
ax = axes[1]
sc = ax.scatter(pos[win, 0], pos[win, 1], s=2, c=pos[win, 2], cmap="viridis")
ax.scatter(pos[stroke, 0], pos[stroke, 1], s=5, c="red")
plt.colorbar(sc, ax=ax, label="z (front)")
ax.set_title("front view of UV-window verts (red=stroke)")
ax.set_aspect("equal")

# side view (z vs y)
ax = axes[2]
mid = win[np.abs(pos[win, 0]) < 0.4]
sc = ax.scatter(pos[mid, 2], pos[mid, 1], s=4, c=uv[mid, 1], cmap="plasma")
smid = stroke[np.abs(pos[stroke, 0]) < 0.4]
ax.scatter(pos[smid, 2], pos[smid, 1], s=14, c="red")
plt.colorbar(sc, ax=ax, label="uv v")
ax.set_title("midline side view (color=uv.v, red=stroke)")
ax.set_aspect("equal")

out = _ROOT / "_explore_mouth_uv.png"
fig.tight_layout()
fig.savefig(out, dpi=110)
print("saved", out)
