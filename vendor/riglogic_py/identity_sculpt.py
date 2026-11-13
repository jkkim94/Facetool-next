# -*- coding: utf-8 -*-
"""Creator-like identity sculpt: soft region blend between two DNA neutrals/evals.

Uses MetaHuman geo_and_bindpose.pca region weights (22 patches) so edits
blend continuously across boundaries (no mesh tearing).
"""
from __future__ import annotations

import numpy as np

from geo_pca import FACE_LOD0_VERT_COUNT, build_lod0_weight_matrix, load_geo_pca

# UI feature groups -> PCA region names
FEATURE_GROUPS = [
    {
        "id": "forehead",
        "label": "이마",
        "regions": ["forheadTop", "forhead_L", "forhead_R"],
    },
    {
        "id": "eyes",
        "label": "눈",
        "regions": ["eye_L", "eye_R"],
    },
    {
        "id": "nose",
        "label": "코",
        "regions": ["nose"],
    },
    {
        "id": "cheekbone",
        "label": "광대",
        "regions": ["cheekbone_L", "cheekbone_R"],
    },
    {
        "id": "cheek",
        "label": "볼",
        "regions": ["cheek_L", "cheek_R"],
    },
    {
        "id": "mouth",
        "label": "입",
        "regions": ["mouth"],
    },
    {
        "id": "chin",
        "label": "턱",
        "regions": ["chin"],
    },
    {
        "id": "jaw",
        "label": "턱선",
        "regions": ["jaw", "jaw_L", "jaw_R"],
    },
    {
        "id": "ears",
        "label": "귀",
        "regions": ["ear_L", "ear_R"],
    },
    {
        "id": "skull",
        "label": "두상",
        "regions": ["skullTop", "skullSide_L", "skullSide_R", "skullBack"],
    },
    {
        "id": "neck",
        "label": "목",
        "regions": ["neck"],
    },
]


class IdentitySculptModel:
    def __init__(self):
        names, regions = load_geo_pca()
        self.region_names = list(names)
        W = build_lod0_weight_matrix(names, regions, FACE_LOD0_VERT_COUNT)
        self.W = W.astype(np.float32)  # (V, R)
        self.row_sum = self.W.sum(axis=1).astype(np.float32)
        self.head_count = int(self.W.shape[0])
        self.region_index = {n: i for i, n in enumerate(self.region_names)}
        self.feature_groups = FEATURE_GROUPS

    def feature_meta(self):
        return {
            "regions": [
                {"id": i, "key": n}
                for i, n in enumerate(self.region_names)
            ],
            "features": self.feature_groups,
            "headVertexCount": self.head_count,
        }

    def amounts_from_features(self, features: dict | None, overall: float = 0.0):
        """Expand UI feature amounts (0=male .. 1=female) to 22 region amounts."""
        amounts = np.full(len(self.region_names), float(overall), dtype=np.float32)
        if not features:
            return amounts
        for group in self.feature_groups:
            if group["id"] not in features:
                continue
            val = float(features[group["id"]])
            for rname in group["regions"]:
                idx = self.region_index.get(rname)
                if idx is not None:
                    amounts[idx] = val
        return amounts

    def per_vertex_scale(self, amounts: np.ndarray) -> np.ndarray:
        """Soft PCA blend: scale[i] = sum_r W[i,r]*a[r] / sum_r W[i,r]."""
        num = self.W @ amounts.astype(np.float32)
        den = self.row_sum
        scale = np.zeros(self.head_count, dtype=np.float32)
        mask = den > 1e-8
        scale[mask] = num[mask] / den[mask]
        return scale

    def blend_meshes(self, va: np.ndarray, vb: np.ndarray, amounts: np.ndarray):
        """va/vb: (V,3) world verts. Head uses soft scale; rest uses mean amount."""
        scale = self.per_vertex_scale(amounts)
        head = self.head_count
        out = va.copy()
        delta = vb - va
        out[:head] = va[:head] + delta[:head] * scale[:, None]
        if va.shape[0] > head:
            g = float(np.clip(amounts.mean(), 0.0, 1.0))
            out[head:] = (1.0 - g) * va[head:] + g * vb[head:]
        return out


_MODEL: IdentitySculptModel | None = None


def get_identity_sculpt_model() -> IdentitySculptModel:
    global _MODEL
    if _MODEL is None:
        _MODEL = IdentitySculptModel()
    return _MODEL
