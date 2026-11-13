# -*- coding: utf-8 -*-
"""Export detailed DNA inspection artifacts (descriptor, behavior, joint-vertices, etc.).

Usage:
  set PYTHONPATH=e:\\Viewer\\riglogic_py
  python export_dna_detail.py --dna E:\\Viewer\\DNA\\0421_V33\\head.dna
  python export_dna_detail.py --dna ... --out-dir ... --meshes head_lod0_mesh,head_lod1_mesh
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import riglogic  # noqa: E402

ARCHETYPES = ["asian", "black", "caucasian", "hispanic", "alien", "other"]
GENDERS = ["male", "female", "other"]
TRANSLATION_UNITS = ["cm", "m"]
ROTATION_UNITS = ["degrees", "radians"]
ACTIVATIONS = ["linear", "relu", "leakyrelu", "tanh", "sigmoid"]


def _tolist(arr) -> list:
    if arr is None:
        return []
    return np.asarray(arr).tolist()


def _named_indices(names: list[str], indices: list[int]) -> list[dict]:
    return [{"index": i, "name": names[i]} for i in indices]


def export_descriptor(r: riglogic.Rig) -> dict:
    return {
        "character_name": r.character_name(),
        "file_format_generation": int(r.file_format_generation()),
        "file_format_version": int(r.file_format_version()),
        "archetype": ARCHETYPES[r.archetype()] if 0 <= r.archetype() < len(ARCHETYPES) else r.archetype(),
        "gender": GENDERS[r.gender()] if 0 <= r.gender() < len(GENDERS) else r.gender(),
        "age": int(r.age()),
        "db_name": r.db_name(),
        "db_complexity": r.db_complexity(),
        "db_max_lod": int(r.db_max_lod()),
        "translation_unit": TRANSLATION_UNITS[r.translation_unit()]
        if 0 <= r.translation_unit() < len(TRANSLATION_UNITS)
        else r.translation_unit(),
        "rotation_unit": ROTATION_UNITS[r.rotation_unit()]
        if 0 <= r.rotation_unit() < len(ROTATION_UNITS)
        else r.rotation_unit(),
        "coordinate_system": dict(r.coordinate_system()),
        "metadata": dict(r.metadata()),
        "lod_count": int(r.lod_count()),
    }


def export_definition(r: riglogic.Rig) -> dict:
    joint_names = list(r.joint_names())
    raw_names = list(r.raw_control_names())
    gui_names = list(r.gui_control_names())
    bs_names = list(r.blend_shape_channel_names())
    am_names = list(r.animated_map_names())
    mesh_names = list(r.mesh_names())
    parents = r.joint_parent_indices().tolist()
    trans = r.neutral_joint_translations().tolist()
    rots = r.neutral_joint_rotations().tolist()

    joints = []
    for i, name in enumerate(joint_names):
        joints.append({
            "index": i,
            "name": name,
            "parent_index": int(parents[i]),
            "parent_name": joint_names[parents[i]] if parents[i] < len(joint_names) else None,
            "neutral_translation": trans[i],
            "neutral_rotation": rots[i],
        })

    lods = []
    for lod in range(r.lod_count()):
        lods.append({
            "lod": lod,
            "joint_indices": r.joint_indices_for_lod(lod),
            "joints": _named_indices(joint_names, r.joint_indices_for_lod(lod)),
            "blend_shape_channel_indices": r.blend_shape_channel_indices_for_lod(lod),
            "blend_shape_channels": _named_indices(bs_names, r.blend_shape_channel_indices_for_lod(lod)),
            "animated_map_indices": r.animated_map_indices_for_lod(lod),
            "animated_maps": _named_indices(am_names, r.animated_map_indices_for_lod(lod)),
            "mesh_indices": r.mesh_indices_for_lod(lod),
            "meshes": _named_indices(mesh_names, r.mesh_indices_for_lod(lod)),
            "mesh_blend_shape_channel_mapping_indices": r.mesh_blend_shape_channel_mapping_indices_for_lod(lod),
            "neural_network_indices": r.neural_network_indices_for_lod(lod),
            "rbf_solver_indices": r.rbf_solver_indices_for_lod(lod),
            "joint_variable_attribute_indices": _tolist(r.joint_variable_attribute_indices(lod)),
        })

    mappings = []
    for i in range(r.mesh_blend_shape_channel_mapping_count()):
        m = dict(r.mesh_blend_shape_channel_mapping(i))
        m["mesh_name"] = mesh_names[m["mesh_index"]]
        m["blend_shape_channel_name"] = bs_names[m["blend_shape_channel_index"]]
        mappings.append(m)

    return {
        "gui_controls": [{"index": i, "name": n} for i, n in enumerate(gui_names)],
        "raw_controls": [{"index": i, "name": n} for i, n in enumerate(raw_names)],
        "joints": joints,
        "blend_shape_channels": [{"index": i, "name": n} for i, n in enumerate(bs_names)],
        "animated_maps": [{"index": i, "name": n} for i, n in enumerate(am_names)],
        "meshes": [{"index": i, "name": n} for i, n in enumerate(mesh_names)],
        "mesh_blend_shape_channel_mappings": mappings,
        "lods": lods,
    }


def export_behavior(r: riglogic.Rig) -> dict:
    raw_names = list(r.raw_control_names())
    gui_names = list(r.gui_control_names())
    bs_names = list(r.blend_shape_channel_names())
    am_names = list(r.animated_map_names())
    joint_names = list(r.joint_names())

    gui_to_raw_entries = []
    g_in = _tolist(r.gui_to_raw_input_indices())
    g_out = _tolist(r.gui_to_raw_output_indices())
    g_from = _tolist(r.gui_to_raw_from_values())
    g_to = _tolist(r.gui_to_raw_to_values())
    g_slope = _tolist(r.gui_to_raw_slope_values())
    g_cut = _tolist(r.gui_to_raw_cut_values())
    for i in range(len(g_in)):
        gui_to_raw_entries.append({
            "entry_index": i,
            "gui_control_index": g_in[i],
            "gui_control_name": gui_names[g_in[i]] if g_in[i] < len(gui_names) else None,
            "raw_control_index": g_out[i],
            "raw_control_name": raw_names[g_out[i]] if g_out[i] < len(raw_names) else None,
            "from_value": g_from[i] if i < len(g_from) else None,
            "to_value": g_to[i] if i < len(g_to) else None,
            "slope": g_slope[i] if i < len(g_slope) else None,
            "cut": g_cut[i] if i < len(g_cut) else None,
        })

    psd_entries = []
    psd_rows = _tolist(r.psd_row_indices())
    psd_cols = _tolist(r.psd_column_indices())
    psd_vals = _tolist(r.psd_values())
    for i in range(len(psd_rows)):
        col = psd_cols[i] if i < len(psd_cols) else None
        psd_entries.append({
            "entry_index": i,
            "psd_index": psd_rows[i],
            "raw_control_index": col,
            "raw_control_name": raw_names[col] if col is not None and col < len(raw_names) else None,
            "weight": psd_vals[i] if i < len(psd_vals) else None,
        })

    joint_groups = []
    for jg in range(r.joint_group_count()):
        joint_ids = _tolist(r.joint_group_joint_indices(jg))
        joint_groups.append({
            "joint_group_index": jg,
            "joint_indices": joint_ids,
            "joint_names": [joint_names[i] for i in joint_ids if i < len(joint_names)],
            "input_indices": _tolist(r.joint_group_input_indices(jg)),
            "output_indices": _tolist(r.joint_group_output_indices(jg)),
            "lods": _tolist(r.joint_group_lods(jg)),
            "values": _tolist(r.joint_group_values(jg)),
        })

    bs_in = _tolist(r.blend_shape_channel_input_indices())
    bs_out = _tolist(r.blend_shape_channel_output_indices())
    bs_behavior = []
    for i in range(len(bs_in)):
        out_idx = bs_out[i] if i < len(bs_out) else None
        bs_behavior.append({
            "entry_index": i,
            "input_index": bs_in[i],
            "output_index": out_idx,
            "blend_shape_channel_name": bs_names[out_idx] if out_idx is not None and out_idx < len(bs_names) else None,
        })

    am_in = _tolist(r.animated_map_input_indices())
    am_out = _tolist(r.animated_map_output_indices())
    am_from = _tolist(r.animated_map_from_values())
    am_to = _tolist(r.animated_map_to_values())
    am_slope = _tolist(r.animated_map_slope_values())
    am_cut = _tolist(r.animated_map_cut_values())
    animated_maps = []
    for i in range(len(am_in)):
        out_idx = am_out[i] if i < len(am_out) else None
        animated_maps.append({
            "entry_index": i,
            "input_index": am_in[i],
            "output_index": out_idx,
            "animated_map_name": am_names[out_idx] if out_idx is not None and out_idx < len(am_names) else None,
            "from_value": am_from[i] if i < len(am_from) else None,
            "to_value": am_to[i] if i < len(am_to) else None,
            "slope": am_slope[i] if i < len(am_slope) else None,
            "cut": am_cut[i] if i < len(am_cut) else None,
        })

    return {
        "joint_matrix": {
            "row_count": int(r.joint_row_count()),
            "column_count": int(r.joint_column_count()),
        },
        "gui_to_raw": {
            "entry_count": len(gui_to_raw_entries),
            "entries": gui_to_raw_entries,
        },
        "psd": {
            "psd_count": int(r.psd_count()),
            "entries": psd_entries,
        },
        "joint_groups": joint_groups,
        "blend_shape_channels": {
            "lod_bounds": _tolist(r.blend_shape_channel_lods()),
            "entries": bs_behavior,
        },
        "animated_maps": {
            "lod_bounds": _tolist(r.animated_map_lods()),
            "entries": animated_maps,
        },
    }


def export_machine_learned(r: riglogic.Rig) -> dict:
    raw_names = list(r.raw_control_names())
    ml_names = list(r.ml_control_names())
    networks = []
    for net in range(r.neural_network_count()):
        in_idx = _tolist(r.neural_network_input_indices(net))
        out_idx = _tolist(r.neural_network_output_indices(net))
        layers = []
        for layer in range(r.neural_network_layer_count(net)):
            act = r.neural_network_layer_activation_function(net, layer)
            layers.append({
                "layer_index": layer,
                "activation_function": ACTIVATIONS[act] if 0 <= act < len(ACTIVATIONS) else act,
                "activation_parameters": _tolist(
                    r.neural_network_layer_activation_function_parameters(net, layer)
                ),
                "biases": _tolist(r.neural_network_layer_biases(net, layer)),
                "weights": _tolist(r.neural_network_layer_weights(net, layer)),
            })
        networks.append({
            "network_index": net,
            "input_control_indices": in_idx,
            "input_control_names": [raw_names[i] for i in in_idx if i < len(raw_names)],
            "output_control_indices": out_idx,
            "output_control_names": [raw_names[i] for i in out_idx if i < len(raw_names)],
            "layers": layers,
        })
    return {
        "ml_controls": [{"index": i, "name": n} for i, n in enumerate(ml_names)],
        "neural_networks": networks,
    }


def export_rbf(r: riglogic.Rig) -> dict:
    raw_names = list(r.raw_control_names())
    bs_names = list(r.blend_shape_channel_names())
    am_names = list(r.animated_map_names())
    pose_ctrl_names = [r.rbf_pose_control_name(i) for i in range(r.rbf_pose_control_count())]

    poses = []
    for pi in range(r.rbf_pose_count()):
        bs_out = _tolist(r.rbf_pose_blend_shape_channel_output_indices(pi))
        am_out = _tolist(r.rbf_pose_animated_map_output_indices(pi))
        poses.append({
            "pose_index": pi,
            "name": r.rbf_pose_name(pi),
            "scale": float(r.rbf_pose_scale(pi)),
            "joint_output_indices": _tolist(r.rbf_pose_joint_output_indices(pi)),
            "joint_output_values": _tolist(r.rbf_pose_joint_output_values(pi)),
            "blend_shape_channel_output_indices": bs_out,
            "blend_shape_channel_output_names": [bs_names[i] for i in bs_out if i < len(bs_names)],
            "animated_map_output_indices": am_out,
            "animated_map_output_names": [am_names[i] for i in am_out if i < len(am_names)],
            "input_control_indices": _tolist(r.rbf_pose_input_control_indices(pi)),
            "output_control_indices": _tolist(r.rbf_pose_output_control_indices(pi)),
            "output_control_weights": _tolist(r.rbf_pose_output_control_weights(pi)),
        })

    solvers = []
    for si in range(r.rbf_solver_count()):
        raw_idx = _tolist(r.rbf_solver_raw_control_indices(si))
        solvers.append({
            "solver_index": si,
            "name": r.rbf_solver_name(si),
            "radius": float(r.rbf_solver_radius(si)),
            "raw_control_indices": raw_idx,
            "raw_control_names": [raw_names[i] for i in raw_idx if i < len(raw_names)],
            "raw_control_values": _tolist(r.rbf_solver_raw_control_values(si)),
            "pose_indices": _tolist(r.rbf_solver_pose_indices(si)),
        })

    return {
        "pose_controls": [{"index": i, "name": n} for i, n in enumerate(pose_ctrl_names)],
        "poses": poses,
        "solvers": solvers,
    }


def export_joint_vertices(r: riglogic.Rig, mesh_names: list[str], min_weight: float) -> dict:
    all_mesh_names = list(r.mesh_names())
    selected = []
    for name in mesh_names:
        if name not in all_mesh_names:
            raise ValueError(f"Unknown mesh: {name}")
        selected.append(all_mesh_names.index(name))

    meshes = []
    for mi in selected:
        influences = list(r.joint_vertex_influences(mi, min_weight))
        # pybind dict -> plain dict
        joints = []
        for item in influences:
            d = dict(item)
            d["vertices"] = [dict(v) for v in d["vertices"]]
            joints.append(d)
        meshes.append({
            "mesh_index": mi,
            "mesh_name": all_mesh_names[mi],
            "vertex_count": int(r.vertex_position_count(mi)),
            "joints": joints,
        })
    return {"min_weight": min_weight, "meshes": meshes}


def export_blend_shape_targets(r: riglogic.Rig, mesh_names: list[str]) -> dict:
    all_mesh_names = list(r.mesh_names())
    bs_names = list(r.blend_shape_channel_names())
    meshes = []
    for name in mesh_names:
        if name not in all_mesh_names:
            raise ValueError(f"Unknown mesh: {name}")
        mi = all_mesh_names.index(name)
        targets = []
        for ti in range(r.blend_shape_target_count(mi)):
            ch = int(r.blend_shape_channel_index(mi, ti))
            targets.append({
                "target_index": ti,
                "blend_shape_channel_index": ch,
                "blend_shape_channel_name": bs_names[ch] if ch < len(bs_names) else None,
                "vertex_indices": _tolist(r.blend_shape_target_vertex_indices(mi, ti)),
            })
        meshes.append({
            "mesh_index": mi,
            "mesh_name": name,
            "targets": targets,
        })
    return {"meshes": meshes}


def write_json(path: Path, data: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser(description="Export detailed DNA inspection JSON files")
    ap.add_argument("--dna", required=True, help="Path to .dna file")
    ap.add_argument("--out-dir", default=None, help="Output directory (default: same as DNA)")
    ap.add_argument(
        "--meshes",
        default="head_lod0_mesh,head_lod1_mesh",
        help="Comma-separated mesh names for joint-vertex / blendshape export",
    )
    ap.add_argument("--min-weight", type=float, default=0.0, help="Min skin weight for joint vertices")
    args = ap.parse_args()

    dna_path = Path(args.dna).resolve()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else dna_path.parent
    mesh_names = [m.strip() for m in args.meshes.split(",") if m.strip()]

    print(f"Loading {dna_path} ...", flush=True)
    r = riglogic.Rig(str(dna_path))

    manifest = {
        "source_dna": str(dna_path),
        "source_size_bytes": dna_path.stat().st_size,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "meshes_exported": mesh_names,
        "files": {},
    }

    sections = {
        "descriptor.json": export_descriptor(r),
        "definition.json": export_definition(r),
        "behavior.json": export_behavior(r),
        "machine_learned.json": export_machine_learned(r),
        "rbf.json": export_rbf(r),
        "joint_vertices.json": export_joint_vertices(r, mesh_names, args.min_weight),
        "blend_shape_targets.json": export_blend_shape_targets(r, mesh_names),
    }

    for fname, payload in sections.items():
        size = write_json(out_dir / fname, payload)
        manifest["files"][fname] = size
        print(f"  wrote {fname} ({size:,} bytes)", flush=True)

    write_json(out_dir / "head_detail_manifest.json", manifest)
    print(f"Done. Output: {out_dir}", flush=True)


if __name__ == "__main__":
    main()
