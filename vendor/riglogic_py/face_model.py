# -*- coding: utf-8 -*-
"""Control values -> MetaHuman face vertex coordinates.

A thin, reusable forward model around RigLogic for training / dataset use.
Given a control vector it returns deformed vertex positions (V, 3) by running
RigLogic (controls -> blend-shape weights + joint quaternion deltas) and then
applying blend-shape morphs + linear-blend skinning in NumPy.

This reuses the exact math validated in bake.py (single source of truth).

Example
-------
    from face_model import FaceModel
    import numpy as np

    fm = FaceModel(r"E:\\Viewer\\DNA\\0421_V33\\head.dna", lod=0, meshes="head")

    # (a) drive with the dataset's column layout (one NPY row)
    fm.set_columns_file(r"...\\AI로_기후정책__0002.columns.txt")
    data = np.load(r"...\\AI로_기후정책__0002.npy")     # (F, 260)
    verts = fm.eval_columns(data[0])                    # (V, 3)
    seq   = fm.eval_columns_batch(data)                 # (F, V, 3)

    # (b) drive with raw RigLogic controls directly
    raw = np.zeros(fm.raw_control_count, np.float32)
    verts = fm.eval_raw(raw)                            # neutral mesh
"""

import numpy as np
import riglogic
import struct
import io

from bake import (
    compose_local,
    compose_world,
    neutral_locals,
    combine_delta,
    load_mesh_static,
    build_morph_index,
    skin_vertices,
    build_control_mapping,
)


def _pad_skin_to_k(w, ji, k):
    """Pad per-mesh skin (V, Km) to common K with zero-weight slots."""
    v, km = w.shape
    if km >= k:
        return w.astype(np.float32), ji.astype(np.int32)
    w_out = np.zeros((v, k), dtype=np.float32)
    ji_out = np.zeros((v, k), dtype=np.int32)
    w_out[:, :km] = w.astype(np.float32)
    ji_out[:, :km] = ji.astype(np.int32)
    return w_out, ji_out


def _select_meshes(rig, lod, meshes):
    names = rig.mesh_names()
    lod_meshes = rig.mesh_indices_for_lod(lod)
    if meshes == "all":
        sel = list(lod_meshes)
    elif meshes == "head":
        sel = [m for m in lod_meshes if names[m].startswith("head_")]
    elif meshes == "face":
        want = ("head_", "teeth_", "eyeleft", "eyeright")
        sel = [m for m in lod_meshes if names[m].lower().startswith(want)]
    else:
        subs = [s.strip() for s in meshes.split(",")]
        sel = [m for m in lod_meshes if any(s in names[m] for s in subs)]
    if not sel:
        raise ValueError("No meshes selected for LOD %d (%s)" % (lod, meshes))
    return sel


class FaceModel:
    def __init__(self, dna_path, lod=0, meshes="head"):
        self.rig = riglogic.Rig(dna_path)
        self.rig.set_lod(lod)
        self.lod = lod
        self.apj = self.rig.attrs_per_joint()
        self.parents = np.array(self.rig.joint_parent_indices(), dtype=np.int64)

        # neutral local transforms + inverse bind matrices
        self.n_t, self.n_q, self.n_s = neutral_locals(self.rig)
        bind_world = compose_world(
            compose_local(self.n_t, self.n_q, self.n_s), self.parents)
        self.bind_inv = np.linalg.inv(bind_world)

        # static per-mesh geometry (positions, skin weights, blend-shape targets)
        names = self.rig.mesh_names()
        self.sel = _select_meshes(self.rig, lod, meshes)
        self.mesh_names = [names[m] for m in self.sel]
        self._meshes = [load_mesh_static(self.rig, m) for m in self.sel]
        self._morph_idx = [build_morph_index(mm["targets"]) for mm in self._meshes]

        # combined vertex layout
        self.offsets = []
        off = 0
        for mm in self._meshes:
            self.offsets.append(off)
            off += mm["V"]
        self.vertex_count = off
        self.indices = np.concatenate(
            [self._meshes[i]["tris"] + self.offsets[i]
             for i in range(len(self._meshes))], axis=0).astype(np.uint32)

        # combined per-vertex UVs + per-mesh draw groups (index ranges)
        self.uvs = np.concatenate(
            [mm["uv"] for mm in self._meshes], axis=0).astype(np.float32)
        self.groups = []
        elem = 0
        for i, mm in enumerate(self._meshes):
            cnt = int(mm["tris"].shape[0]) * 3
            self.groups.append({
                "name": self.mesh_names[i],
                "indexStart": elem,
                "indexCount": cnt,
            })
            elem += cnt

        self.raw_control_count = int(self.rig.raw_control_count())
        self.blend_shape_channel_count = int(self.rig.blend_shape_channel_count())
        self.gui_control_names = list(self.rig.gui_control_names())
        self.gui_control_count = int(self.rig.gui_control_count())

        # neutral (bind-pose) vertices, useful as a reference / origin
        self.neutral_vertices = np.concatenate(
            [mm["pos"] for mm in self._meshes], axis=0).astype(np.float64)

        # optional column mapping (dataset layout -> raw controls)
        self._col_i = None
        self._raw_i = None
        self.columns = None

    # ------------------------------------------------------------------ #
    # control-column mapping (matches the dataset NPY layout)
    # ------------------------------------------------------------------ #
    def set_columns(self, columns):
        """columns: list[str] of control names (one per NPY column)."""
        mapping = build_control_mapping(self.rig, list(columns))
        self._col_i = np.array([c for c, _ in mapping], dtype=np.int64)
        self._raw_i = np.array([r for _, r in mapping], dtype=np.int64)
        self.columns = list(columns)
        return len(mapping)

    def set_columns_file(self, path):
        with open(path, encoding="utf-8") as f:
            cols = [l.strip() for l in f if l.strip()]
        return self.set_columns(cols)

    def raw_from_columns(self, row):
        if self._raw_i is None:
            raise RuntimeError("call set_columns()/set_columns_file() first")
        row = np.asarray(row, dtype=np.float32)
        rv = np.zeros(self.raw_control_count, dtype=np.float32)
        rv[self._raw_i] = row[self._col_i]
        return rv

    # ------------------------------------------------------------------ #
    # RigLogic only (no morph/skin) — for browser-side deform
    # ------------------------------------------------------------------ #
    def eval_rig_raw(self, raw_controls):
        rv = np.asarray(raw_controls, dtype=np.float32)
        if rv.shape[0] != self.raw_control_count:
            raise ValueError("expected %d raw controls, got %d"
                             % (self.raw_control_count, rv.shape[0]))
        self.rig.set_raw_controls(rv)
        self.rig.calculate()
        return (
            np.array(self.rig.blend_shape_outputs(), dtype=np.float32),
            np.array(self.rig.joint_outputs(), dtype=np.float32),
        )

    def eval_rig_columns(self, row):
        return self.eval_rig_raw(self.raw_from_columns(row))

    def eval_rig_columns_batch(self, rows):
        rows = np.asarray(rows, dtype=np.float32)
        bs_out = []
        jo_out = []
        for i in range(rows.shape[0]):
            bs, jo = self.eval_rig_columns(rows[i])
            bs_out.append(bs)
            jo_out.append(jo)
        return np.stack(bs_out, axis=0), np.stack(jo_out, axis=0)

    def eval_rig_gui(self, gui_values):
        """gui_values -> (bs, jo) without morph/skin."""
        gv = np.asarray(gui_values, dtype=np.float32)
        if gv.shape[0] != self.gui_control_count:
            raise ValueError("expected %d gui controls, got %d"
                             % (self.gui_control_count, gv.shape[0]))
        self.rig.set_gui_controls(gv)
        self.rig.map_gui_to_raw()
        self.rig.calculate()
        return (
            np.array(self.rig.blend_shape_outputs(), dtype=np.float32),
            np.array(self.rig.joint_outputs(), dtype=np.float32),
        )

    def pack_deform_static(self, center):
        """Binary blob for browser morph + skinning (magic RLDS v1)."""
        fm = self
        J = int(fm.parents.shape[0])
        apj = int(fm.apj)
        V = int(fm.vertex_count)
        morph_vidx = []
        morph_delta = []
        morph_chan = []
        for mi, (vidx, delta, chan) in enumerate(fm._morph_idx):
            off = fm.offsets[mi]
            if vidx.shape[0] == 0:
                continue
            morph_vidx.append(vidx + off)
            morph_delta.append(delta.astype(np.float32))
            morph_chan.append(chan.astype(np.int32))
        if morph_vidx:
            morph_vidx = np.concatenate(morph_vidx).astype(np.int32)
            morph_delta = np.concatenate(morph_delta)
            morph_chan = np.concatenate(morph_chan).astype(np.int32)
        else:
            morph_vidx = np.zeros(0, np.int32)
            morph_delta = np.zeros((0, 3), np.float32)
            morph_chan = np.zeros(0, np.int32)
        mc = int(morph_vidx.shape[0])
        bs_count = int(fm.blend_shape_channel_count)

        k = max(int(mm["w"].shape[1]) for mm in fm._meshes)
        w_parts = []
        ji_parts = []
        for mm in fm._meshes:
            wp, jip = _pad_skin_to_k(mm["w"], mm["ji"], k)
            w_parts.append(wp)
            ji_parts.append(jip)
        w = np.concatenate(w_parts, axis=0)
        ji = np.concatenate(ji_parts, axis=0)
        neutral = fm.neutral_vertices.astype(np.float32)
        center = np.asarray(center, dtype=np.float32)

        buf = io.BytesIO()
        buf.write(b"RLDS")
        buf.write(struct.pack("<8I", 1, V, J, apj, k, bs_count, mc, 0))
        buf.write(center.tobytes())
        buf.write(fm.parents.astype(np.int32).tobytes())
        buf.write(fm.n_t.astype(np.float32).tobytes())
        buf.write(fm.n_q.astype(np.float32).tobytes())
        buf.write(fm.n_s.astype(np.float32).tobytes())
        buf.write(fm.bind_inv.astype(np.float32).tobytes())
        buf.write(neutral.tobytes())
        buf.write(w.tobytes())
        buf.write(ji.tobytes())
        buf.write(morph_vidx.tobytes())
        buf.write(morph_delta.tobytes())
        buf.write(morph_chan.tobytes())
        return buf.getvalue()

    # ------------------------------------------------------------------ #
    # forward evaluation: controls -> vertices
    # ------------------------------------------------------------------ #
    def _deform(self, bs, jo):
        lt, lq, ls = combine_delta(self.n_t, self.n_q, self.n_s, jo, self.apj)
        world = compose_world(compose_local(lt, lq, ls), self.parents)
        skin = world @ self.bind_inv
        outs = []
        for i, mm in enumerate(self._meshes):
            morphed = mm["pos"].copy()
            vidx, delta, chan = self._morph_idx[i]
            if vidx.shape[0] > 0:
                morphed = morphed.copy()
                contrib = delta * bs[chan][:, None]
                np.add.at(morphed, vidx, contrib)
            outs.append(skin_vertices(morphed, mm["w"], mm["ji"], skin))
        return np.concatenate(outs, axis=0)

    def eval_raw(self, raw_controls):
        """raw_controls: (raw_control_count,) -> vertices (vertex_count, 3)."""
        rv = np.asarray(raw_controls, dtype=np.float32)
        if rv.shape[0] != self.raw_control_count:
            raise ValueError("expected %d raw controls, got %d"
                             % (self.raw_control_count, rv.shape[0]))
        self.rig.set_raw_controls(rv)
        self.rig.calculate()
        bs = np.array(self.rig.blend_shape_outputs())
        jo = np.array(self.rig.joint_outputs())
        return self._deform(bs, jo)

    def eval_gui(self, gui_values):
        """gui_values: (gui_control_count,) MetaHuman board controls -> (V, 3)."""
        gv = np.asarray(gui_values, dtype=np.float32)
        if gv.shape[0] != self.gui_control_count:
            raise ValueError("expected %d gui controls, got %d"
                             % (self.gui_control_count, gv.shape[0]))
        self.rig.set_gui_controls(gv)
        self.rig.map_gui_to_raw()
        self.rig.calculate()
        bs = np.array(self.rig.blend_shape_outputs())
        jo = np.array(self.rig.joint_outputs())
        return self._deform(bs, jo)

    def eval_columns(self, row):
        """row: one NPY row in the dataset column layout -> vertices (V, 3)."""
        return self.eval_raw(self.raw_from_columns(row))

    def eval_columns_batch(self, rows):
        """rows: (F, n_columns) -> (F, vertex_count, 3)."""
        rows = np.asarray(rows)
        out = np.empty((rows.shape[0], self.vertex_count, 3), dtype=np.float64)
        for i in range(rows.shape[0]):
            out[i] = self.eval_columns(rows[i])
        return out

    def eval_raw_batch(self, raws):
        """raws: (F, raw_control_count) -> (F, vertex_count, 3)."""
        raws = np.asarray(raws)
        out = np.empty((raws.shape[0], self.vertex_count, 3), dtype=np.float64)
        for i in range(raws.shape[0]):
            out[i] = self.eval_raw(raws[i])
        return out


if __name__ == "__main__":
    import argparse, time

    ap = argparse.ArgumentParser(description="controls -> vertices smoke test")
    ap.add_argument("--dna", required=True)
    ap.add_argument("--npy", required=True)
    ap.add_argument("--columns", required=True)
    ap.add_argument("--lod", type=int, default=0)
    ap.add_argument("--meshes", default="head")
    ap.add_argument("--frame", type=int, default=0)
    args = ap.parse_args()

    fm = FaceModel(args.dna, lod=args.lod, meshes=args.meshes)
    n = fm.set_columns_file(args.columns)
    print("meshes:", fm.mesh_names)
    print("vertices:", fm.vertex_count, "raw controls:", fm.raw_control_count)
    print("mapped columns -> raw:", n)

    data = np.load(args.npy)
    print("npy:", data.shape)

    # neutral check: zero controls should reproduce the bind mesh
    zero = fm.eval_raw(np.zeros(fm.raw_control_count, np.float32))
    dev = np.abs(zero - fm.neutral_vertices).max()
    print("zero-control deviation from neutral: %.6g cm" % dev)

    v = fm.eval_columns(data[args.frame])
    print("frame %d vertices:" % args.frame, v.shape,
          "bbox:", v.min(axis=0).round(3), v.max(axis=0).round(3))

    t0 = time.time()
    k = min(100, data.shape[0])
    fm.eval_columns_batch(data[:k])
    dt = time.time() - t0
    print("throughput: %.1f frames/s (%d frames)" % (k / dt, k))
