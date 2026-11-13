# -*- coding: utf-8 -*-
"""Load MetaHuman IdentityBlendModel from geo_and_bindpose.pca (UE 5.6).

See MetaHumanFaceRegionReference/ and IdentityBlendModel.h RegionData.
"""
from __future__ import annotations

import json
import os
import struct
from pathlib import Path

import numpy as np

FACE_LOD0_VERT_COUNT = 24049  # head_lod0_mesh; symmetry.json length

_VIEWER_ROOT = Path(__file__).resolve().parents[1]
_LOCAL_PCA = _VIEWER_ROOT / "MetaHumanFaceRegionReference" / "geo_and_bindpose.pca"
_UE_PCA = Path(
    r"C:\Program Files\Epic Games\UE_5.6\Engine\Plugins\MetaHuman"
    r"\MetaHumanCharacter\Content\Face\IdentityTemplate\rig_calibration_models\geo_and_bindpose.pca"
)
_LOCAL_SKINNING = _VIEWER_ROOT / "MetaHumanFaceRegionReference" / "data" / "skinningWeightsConfig.json"
_UE_SKINNING = Path(
    r"C:\Program Files\Epic Games\UE_5.6\Engine\Plugins\MetaHuman"
    r"\MetaHumanCharacter\Content\Face\IdentityTemplate\skinningWeightsConfig.json"
)


def resolve_geo_pca_path(explicit: str | Path | None = None) -> Path:
    """Local Viewer copy first, then UE plugin install."""
    if explicit is not None:
        return Path(explicit)
    env = os.environ.get("METAHUMAN_GEO_PCA")
    if env:
        return Path(env)
    if _LOCAL_PCA.exists():
        return _LOCAL_PCA
    return _UE_PCA


DEFAULT_PCA = str(resolve_geo_pca_path())


def resolve_skinning_weights_path(explicit: str | Path | None = None) -> Path:
    if explicit is not None:
        return Path(explicit)
    env = os.environ.get("METAHUMAN_SKINNING_WEIGHTS")
    if env:
        return Path(env)
    if _LOCAL_SKINNING.exists():
        return _LOCAL_SKINNING
    return _UE_SKINNING


def build_lod0_weight_matrix(
    names: list[str],
    regions: dict[str, list[tuple[int, float]]],
    vert_count: int = FACE_LOD0_VERT_COUNT,
) -> np.ndarray:
    """Dense (vert_count, num_regions) PCA influence weights on LOD0."""
    w = np.zeros((vert_count, len(names)), dtype=np.float64)
    for rid, name in enumerate(names):
        for vid, wt in regions[name]:
            if 0 <= vid < vert_count:
                w[vid, rid] = float(wt)
    return w


def load_lod1_barycentric(config_path: str | Path | None = None, lod: int = 1) -> list[dict]:
    path = resolve_skinning_weights_path(config_path)
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["barycentric_coordinates_for_odd_lods"][str(lod)]


def interpolate_weights_to_lod1(
    lod0_weights: np.ndarray,
    bary_entries: list[dict],
) -> np.ndarray:
    """Barycentric transfer LOD0 region weights -> LOD1 (Epic skinningWeightsConfig)."""
    n1 = len(bary_entries)
    n_reg = lod0_weights.shape[1]
    out = np.zeros((n1, n_reg), dtype=np.float64)
    for i, entry in enumerate(bary_entries):
        if not entry.get("valid"):
            continue
        bcs = entry["bcs"]
        for vid, w in zip(bcs["indices"], bcs["weights"]):
            if w and 0 <= vid < lod0_weights.shape[0]:
                out[i] += float(w) * lod0_weights[vid]
    return out


def dominant_from_weight_matrix(weights: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Argmax region id per vertex; -1 where all weights are zero."""
    dom_w = weights.max(axis=1)
    dom_id = weights.argmax(axis=1).astype(np.int32)
    dom_id[dom_w <= 0] = -1
    return dom_id, dom_w


def smooth_dominant_regions(
    dominant_id: np.ndarray,
    triangles: np.ndarray,
    iterations: int = 5,
) -> np.ndarray:
    """Majority-vote smoothing on mesh graph (cleaner patch boundaries for debug view)."""
    n = int(dominant_id.shape[0])
    dom = dominant_id.astype(np.int32, copy=True)
    adj: list[set[int]] = [set() for _ in range(n)]
    for a, b, c in triangles:
        for x, y in ((int(a), int(b)), (int(b), int(c)), (int(a), int(c))):
            if 0 <= x < n and 0 <= y < n:
                adj[x].add(y)
                adj[y].add(x)
    for _ in range(iterations):
        nxt = dom.copy()
        for i in range(n):
            if dom[i] < 0:
                continue
            counts: dict[int, int] = {int(dom[i]): 2}
            for nb in adj[i]:
                r = int(dom[nb])
                if r >= 0:
                    counts[r] = counts.get(r, 0) + 1
            nxt[i] = max(counts, key=counts.get)
        dom = nxt
    return dom


def blend_region_colors(
    weights: np.ndarray,
    palette: list[list[float]],
    skin: list[float] | None = None,
) -> list[list[float]]:
    """Soft PCA visualization: weighted RGB mix (matches overlapping region weights)."""
    skin = skin or [0.78, 0.62, 0.55]
    pal = np.asarray(palette, dtype=np.float64)
    colors = []
    for row in weights:
        s = float(row.sum())
        if s <= 1e-12:
            colors.append(list(skin))
            continue
        rgb = (row @ pal) / s
        colors.append([float(rgb[0]), float(rgb[1]), float(rgb[2])])
    return colors


def _read_u32(f):
    return struct.unpack("<I", f.read(4))[0]


def _read_i32(f):
    return struct.unpack("<i", f.read(4))[0]


def _read_u64(f):
    return struct.unpack("<Q", f.read(8))[0]


def _read_string(f):
    size = _read_u32(f)
    return f.read(size).decode("utf-8")


def _read_matrix_f(f):
    r, c = _read_i32(f), _read_i32(f)
    if r * c == 0:
        return []
    return struct.unpack("<" + "f" * (r * c), f.read(4 * r * c))


def _read_vector_i(f):
    r, c = _read_i32(f), _read_i32(f)
    if r * c == 0:
        return []
    return struct.unpack("<" + "i" * (r * c), f.read(4 * r * c))


def _read_vector_f(f):
    return _read_matrix_f(f)


def _read_string_vec(f):
    n = _read_u64(f)
    return [_read_string(f) for _ in range(n)]


def load_geo_pca(path: str | Path | None = None):
    """Return (region_names, region_pairs).

    region_pairs[name] -> list of (vertex_id, weight) for that semantic patch.
    """
    pca_path = resolve_geo_pca_path(path)
    if not pca_path.exists():
        raise FileNotFoundError(
            "geo_and_bindpose.pca not found: %s (copy to MetaHumanFaceRegionReference/ or set METAHUMAN_GEO_PCA)"
            % pca_path
        )

    regions = {}
    with open(pca_path, "rb") as f:
        _read_u32(f)
        _read_i32(f)
        num_regions = _read_i32(f)
        _read_matrix_f(f)
        names = []
        for _ in range(num_regions):
            name = _read_string(f)
            names.append(name)
            _read_matrix_f(f)
            vids = _read_vector_i(f)
            weights = _read_vector_f(f)
            _read_string_vec(f)
            regions[name] = list(zip(vids, weights))
    return names, regions


def dominant_region_per_vertex(
    names: list[str],
    regions: dict[str, list[tuple[int, float]]],
    vert_count: int = FACE_LOD0_VERT_COUNT,
):
    """DMT singleRegionPerLandmark style: per vertex, region with max weight."""
    dominant_id = [-1] * vert_count
    dominant_weight = [0.0] * vert_count
    for rid, name in enumerate(names):
        for vid, w in regions[name]:
            if vid < 0 or vid >= vert_count:
                continue
            if w > dominant_weight[vid]:
                dominant_weight[vid] = float(w)
                dominant_id[vid] = rid
    return dominant_id, dominant_weight
