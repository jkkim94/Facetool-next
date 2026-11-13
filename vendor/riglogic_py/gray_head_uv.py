# -*- coding: utf-8 -*-
"""T_Gray_Head_D.PNG UV sampling helpers (Epic Identity region id map)."""
from __future__ import annotations

import os

import numpy as np
from PIL import Image

import riglogic
from bake import load_mesh_static

DNA = os.environ.get("RIGLOGIC_DNA", r"E:\Viewer\DNA\0421_V33\head.dna")
REGION_TEXTURE = os.environ.get(
    "RIGLOGIC_REGION_UV_TEXTURE",
    os.path.join(os.path.dirname(DNA), "T_Gray_Head_D.PNG"),
)
QUANT = 8

# Warm tan/orange-brown lip ring only — NOT Epic gray mouth patch (152–158 neutral gray).
MOUTH_RING_SEED_COLORS = [
    (168, 152, 136),
    (168, 136, 120),
    (152, 136, 120),
    (160, 136, 112),
    (152, 128, 112),
    (144, 128, 104),
]
MOUTH_COLOR_TOL = 28
GRAY_CHROMA_MIN = 18
# T_Gray_Head_D mouth island: white/tan fill + vivid red lip stroke (see UV close-up).
LIP_STROKE_REFS = [
    (242, 38, 51),
    (212, 103, 103),
    (216, 104, 103),
    (217, 104, 103),
    (211, 102, 103),
    (210, 102, 103),
    (209, 102, 103),
    (208, 102, 103),
    (189, 97, 102),
    (192, 97, 102),
    (187, 96, 102),
]
LIP_STROKE_TOL = 28
LIP_STROKE_MIN_R = 175
LIP_STROKE_MAX_G = 115
LIP_STROKE_MAX_B = 115
LIP_STROKE_MIN_RG_DELTA = 35
LIP_STROKE_MIN_RB_DELTA = 35


def head_mesh_index(rig, lod: int) -> int:
    for mi in rig.mesh_indices_for_lod(lod):
        if rig.mesh_names()[mi].startswith("head_"):
            return mi
    raise RuntimeError("head mesh not found for LOD %d" % lod)


def load_texture(path: str) -> np.ndarray:
    return np.array(Image.open(path).convert("RGB"))


def sample_rgb(tex: np.ndarray, u: float, v: float) -> tuple[int, int, int]:
    h, w = tex.shape[:2]
    py = int(np.clip((1.0 - v) * (h - 1), 0, h - 1))
    px = int(np.clip(u * (w - 1), 0, w - 1))
    c = tex[py, px]
    return int(c[0]), int(c[1]), int(c[2])


def color_dist(a, b) -> float:
    return float(np.linalg.norm(np.array(a, dtype=np.float32) - np.array(b, dtype=np.float32)))


def is_lip_color(rgb: tuple[int, int, int]) -> bool:
    """Red lip stroke on T_Gray_Head_D (excludes tan/white mouth fill)."""
    r, g, b = rgb
    if r < LIP_STROKE_MIN_R or g > LIP_STROKE_MAX_G or b > LIP_STROKE_MAX_B:
        return False
    if (r - g) < LIP_STROKE_MIN_RG_DELTA or (r - b) < LIP_STROKE_MIN_RB_DELTA:
        return False
    for ref in LIP_STROKE_REFS:
        if color_dist(rgb, ref) <= LIP_STROKE_TOL:
            return True
    return False


def is_outer_mouth_color(rgb: tuple[int, int, int]) -> bool:
    """Perioral lip ring — warm tan/orange-brown; excludes neutral gray (jaw/cheek/Epic patch)."""
    if is_lip_color(rgb):
        return False
    r, g, b = rgb
    if max(r, g, b) - min(r, g, b) < GRAY_CHROMA_MIN:
        return False
    if r < 115 or g < 95 or b < 85:
        return False
    if r <= g or (r - b) < 18:
        return False
    for ref in MOUTH_RING_SEED_COLORS:
        if color_dist(rgb, ref) <= MOUTH_COLOR_TOL:
            return True
    if 115 <= r <= 180 and 100 <= g <= 155 and 85 <= b <= 130:
        if r > g + 8 and r > b + 18:
            return True
    return False


def classify_mouth_uv_rgb(rgb: tuple[int, int, int]) -> str | None:
    if is_lip_color(rgb):
        return "lip"
    if is_outer_mouth_color(rgb):
        return "mouth"
    return None


def is_mouth_color(rgb: tuple[int, int, int]) -> bool:
    return classify_mouth_uv_rgb(rgb) is not None


def sample_head_uv_regions(rig, tex: np.ndarray, lod: int):
    """Lip vertex IDs from T_Gray_Head_D red UV stroke only (no mesh ring, no tan fill)."""
    mi = head_mesh_index(rig, lod)
    mm = load_mesh_static(rig, mi)
    mesh_name = rig.mesh_names()[mi]
    head_count = int(mm["V"])
    uv_per_pos = mm["uv"]
    pos = mm["pos"]
    tris = mm["tris"]

    lip_ids = []
    for vi in range(head_count):
        u, v = float(uv_per_pos[vi, 0]), float(uv_per_pos[vi, 1])
        if is_lip_color(sample_rgb(tex, u, v)):
            lip_ids.append(vi)

    mouth_ids = []
    lip_ids.sort()
    keep = set(lip_ids)

    rows = []
    for vi in sorted(keep):
        u, v = float(uv_per_pos[vi, 0]), float(uv_per_pos[vi, 1])
        rgb = sample_rgb(tex, u, v)
        region = "lip" if vi in lip_ids else "mouth"
        px, py, pz = float(pos[vi, 0]), float(pos[vi, 1]), float(pos[vi, 2])
        rows.append({
            "vertex_id": vi,
            "region": region,
            "u": u,
            "v": v,
            "sample_r": rgb[0],
            "sample_g": rgb[1],
            "sample_b": rgb[2],
            "pos_x": px,
            "pos_y": py,
            "pos_z": pz,
        })

    all_ids = sorted(keep)

    return {
        "meshName": mesh_name,
        "lod": lod,
        "headVertexCount": head_count,
        "texture": tex,
        "rows": rows,
        "lip": lip_ids,
        "mouth": mouth_ids,
        "all": all_ids,
    }
