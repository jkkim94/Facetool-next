# -*- coding: utf-8 -*-
"""Read MetaHuman MeshColorAsset.uasset (UE IdentityTemplate vertex region colors)."""
import os
import struct

DEFAULT_UASSET = os.environ.get(
    "METAHUMAN_MESH_COLOR_ASSET",
    r"C:\Program Files\Epic Games\UE_5.6\Engine\Plugins\MetaHuman"
    r"\MetaHumanCharacter\Content\Face\IdentityTemplate\MeshColorAsset.uasset",
)


def _find_color_array(data: bytes, mesh_name: str, vertex_count: int):
    needle = mesh_name.encode("ascii")
    pos = data.find(needle)
    if pos < 0:
        raise FileNotFoundError("mesh name %r not found in uasset" % mesh_name)
    for off in range(pos, min(pos + 512, len(data) - 4)):
        if struct.unpack_from("<i", data, off)[0] == vertex_count:
            return off + 4
    raise ValueError("TArray count %d not found near %s" % (vertex_count, mesh_name))


def load_mesh_vertex_colors(mesh_name: str, vertex_count: int, uasset_path: str = DEFAULT_UASSET):
    """Return list of (r,g,b,a) floats per DNA mesh vertex index."""
    with open(uasset_path, "rb") as f:
        data = f.read()
    start = _find_color_array(data, mesh_name, vertex_count)
    out = []
    for i in range(vertex_count):
        r, g, b, a = struct.unpack_from("<4f", data, start + i * 16)
        out.append((float(r), float(g), float(b), float(a)))
    return out


def fine_region_key(r: float, g: float, b: float):
    """Exact MeshColorAsset (G,B) byte pair — 266 unique codes on head_lod1."""
    gi = int(round(g * 255.0))
    bi = int(round(b * 255.0))
    return (gi, bi)


def coarse_region_key(r: float, g: float, b: float):
    """Quantize Epic MeshColorAsset GB encoding to 16 logical buckets (legacy)."""
    gi = int(round(g * 255.0)) // 32
    bi = int(round(b * 255.0)) // 128
    return (gi, bi)
