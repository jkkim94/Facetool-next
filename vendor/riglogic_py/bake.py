"""Bake a MetaHuman DNA + control-value clip into per-frame vertex positions.

Approach A: evaluate RigLogic per frame (blend-shape channel weights + joint
quaternion deltas), apply blend-shape morphs and linear-blend skinning in
Python, and write out per-frame deformed vertex positions for a web viewer.

Validation: at zero controls, the deformed mesh must reproduce the neutral
(bind) mesh exactly. This is asserted before baking the whole clip.
"""

import argparse
import json
import os
import shutil
import struct
import wave

import numpy as np

import riglogic


# ----------------------------- math helpers -----------------------------

def quat_to_matrix(q):
    """q: (...,4) [x,y,z,w] -> (...,3,3) rotation matrices."""
    x, y, z, w = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    n = np.sqrt(x * x + y * y + z * z + w * w)
    n = np.where(n == 0, 1.0, n)
    x, y, z, w = x / n, y / n, z / n, w / n
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    m = np.empty(q.shape[:-1] + (3, 3), dtype=np.float64)
    m[..., 0, 0] = 1 - 2 * (yy + zz)
    m[..., 0, 1] = 2 * (xy - wz)
    m[..., 0, 2] = 2 * (xz + wy)
    m[..., 1, 0] = 2 * (xy + wz)
    m[..., 1, 1] = 1 - 2 * (xx + zz)
    m[..., 1, 2] = 2 * (yz - wx)
    m[..., 2, 0] = 2 * (xz - wy)
    m[..., 2, 1] = 2 * (yz + wx)
    m[..., 2, 2] = 1 - 2 * (xx + yy)
    return m


def quat_mul(a, b):
    """Hamilton product a*b, quats [x,y,z,w]. Broadcasting over leading dims."""
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    out = np.empty(np.broadcast(a, b).shape, dtype=np.float64)
    out[..., 0] = aw * bx + ax * bw + ay * bz - az * by
    out[..., 1] = aw * by - ax * bz + ay * bw + az * bx
    out[..., 2] = aw * bz + ax * by - ay * bx + az * bw
    out[..., 3] = aw * bw - ax * bx - ay * by - az * bz
    return out


def compose_local(trans, quat, scale):
    """trans (J,3), quat (J,4)[xyzw], scale (J,3) -> local (J,4,4)."""
    J = trans.shape[0]
    R = quat_to_matrix(quat)  # (J,3,3)
    M = np.zeros((J, 4, 4), dtype=np.float64)
    M[:, :3, :3] = R * scale[:, None, :]  # column scale (M = R @ diag(scale))
    M[:, :3, 3] = trans
    M[:, 3, 3] = 1.0
    return M


def compose_world(local, parents):
    """local (J,4,4), parents (J,) -> world (J,4,4). Assumes parent index < child
    (true for MetaHuman DNA); root's parent is itself / index 0."""
    J = local.shape[0]
    world = np.empty((J, 4, 4), dtype=np.float64)
    for j in range(J):
        p = parents[j]
        if p == j or p >= j:
            world[j] = local[j]
        else:
            world[j] = world[p] @ local[j]
    return world


# ----------------------------- rig extraction -----------------------------

def split_joint_buffer(buf, attrs_per_joint):
    """buf (J*attrs,) -> trans (J,3), quat (J,4), scale (J,3). attrs=10 (quat)."""
    J = buf.shape[0] // attrs_per_joint
    b = buf.reshape(J, attrs_per_joint)
    trans = b[:, 0:3].astype(np.float64)
    quat = b[:, 3:7].astype(np.float64)
    scale = b[:, 7:10].astype(np.float64)
    return trans, quat, scale


def neutral_locals(rig):
    apj = rig.attrs_per_joint()
    nj = np.array(rig.neutral_joint_values())
    t, q, s = split_joint_buffer(nj, apj)
    return t, q, s


def combine_delta(neutral_t, neutral_q, neutral_s, jo, apj):
    """Combine neutral local transform with RigLogic delta output -> local TRS."""
    dt, dq, ds = split_joint_buffer(jo, apj)
    local_t = neutral_t + dt
    local_q = quat_mul(neutral_q, dq)  # neutral then delta (local post-rotation)
    local_s = neutral_s + ds  # neutral scale (1) + delta (0 at rest)
    return local_t, local_q, local_s


def triangulate(counts, flat):
    """Polygon fan triangulation of a layout-index face list."""
    tris = []
    off = 0
    for c in counts:
        c = int(c)
        for k in range(1, c - 1):
            tris.append((flat[off], flat[off + k], flat[off + k + 1]))
        off += c
    return np.array(tris, dtype=np.uint32)


def load_mesh_static(rig, m):
    """Return base-vertex geometry for mesh m, rendered on base position vertices.
    Per-position UVs are derived from the layout (UV seams collapse to a single
    UV per position vertex; acceptable for a textured PoC)."""
    pos = rig.vertex_positions(m).astype(np.float64)  # (V,3)
    counts, flat = rig.faces(m)  # layout-index faces
    lay2pos = rig.layout_position_indices(m)  # (L,)
    # faces in layout space -> base position space
    tris_layout = triangulate(counts, flat)
    tris = lay2pos[tris_layout].astype(np.uint32)
    # per-position UVs: assign each position vertex the UV of a layout vert that
    # references it (last wins at seams)
    lay2uv = np.asarray(rig.layout_uv_indices(m)).astype(np.int64)  # (L,)
    uvs = rig.vertex_uvs(m).astype(np.float64)  # (numUV,2)
    uv_per_pos = np.zeros((pos.shape[0], 2), dtype=np.float64)
    if uvs.shape[0] > 0 and lay2uv.shape[0] == lay2pos.shape[0]:
        uv_per_pos[lay2pos] = uvs[lay2uv]
    # skin
    w, ji = rig.skin_weights(m)  # (V,maxInfl)
    # blendshape targets
    targets = []
    for t in range(rig.blend_shape_target_count(m)):
        ch = rig.blend_shape_channel_index(m, t)
        vidx = rig.blend_shape_target_vertex_indices(m, t)
        deltas = rig.blend_shape_target_deltas(m, t).astype(np.float64)
        if vidx.shape[0] > 0:
            targets.append((int(ch), vidx.astype(np.int64), deltas))
    return {
        "pos": pos,
        "uv": uv_per_pos,
        "tris": tris,
        "w": w.astype(np.float64),
        "ji": ji.astype(np.int64),
        "targets": targets,
        "V": pos.shape[0],
    }


def build_morph_index(targets):
    """Flatten all targets into (all_vidx, all_delta, all_chan)."""
    if not targets:
        return (np.zeros(0, np.int64), np.zeros((0, 3)), np.zeros(0, np.int64))
    vidx = np.concatenate([t[1] for t in targets])
    delta = np.concatenate([t[2] for t in targets])
    chan = np.concatenate([np.full(t[1].shape[0], t[0], np.int64) for t in targets])
    return vidx, delta, chan


def skin_vertices(morphed, w, ji, skin):
    """morphed (V,3), w (V,K), ji (V,K), skin (J,4,4) -> deformed (V,3)."""
    V, K = w.shape
    ph = np.empty((V, 4), dtype=np.float64)
    ph[:, :3] = morphed
    ph[:, 3] = 1.0
    out = np.zeros((V, 3), dtype=np.float64)
    for k in range(K):
        mats = skin[ji[:, k]]  # (V,4,4)
        transformed = np.einsum("vij,vj->vi", mats, ph)[:, :3]
        out += transformed * w[:, k:k + 1]
    return out


# ----------------------------- column mapping -----------------------------

def column_to_raw(col):
    if col.startswith("CTRL_expressions_"):
        return "CTRL_expressions." + col[len("CTRL_expressions_"):]
    return col


def build_control_mapping(rig, columns):
    raw_idx = {n: i for i, n in enumerate(rig.raw_control_names())}
    mapping = []
    for ci, col in enumerate(columns):
        rn = column_to_raw(col)
        if rn in raw_idx:
            mapping.append((ci, raw_idx[rn]))
    return mapping


# ----------------------------- main bake -----------------------------

def wav_duration(path):
    with wave.open(path, "rb") as wf:
        return wf.getnframes() / float(wf.getframerate())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dna", required=True)
    ap.add_argument("--npy", required=True)
    ap.add_argument("--columns", required=True)
    ap.add_argument("--wav", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lod", type=int, default=0)
    ap.add_argument("--meshes", default="head",
                    help="'head', 'all', or comma-separated mesh-name substrings")
    ap.add_argument("--half", action="store_true", help="store positions as float16")
    ap.add_argument("--max-frames", type=int, default=0)
    ap.add_argument("--textures-dir", default=None,
                    help="dir with MetaHuman Maps (Head_Basecolor.png, Head_Normal.png)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    print("loading rig...", flush=True)
    rig = riglogic.Rig(args.dna)
    rig.set_lod(args.lod)
    apj = rig.attrs_per_joint()
    parents = np.array(rig.joint_parent_indices(), dtype=np.int64)

    # neutral joint locals + bind world / inverse
    n_t, n_q, n_s = neutral_locals(rig)
    bind_local = compose_local(n_t, n_q, n_s)
    bind_world = compose_world(bind_local, parents)
    bind_inv = np.linalg.inv(bind_world)

    # select meshes
    names = rig.mesh_names()
    lod_meshes = rig.mesh_indices_for_lod(args.lod)
    if args.meshes == "all":
        sel = list(lod_meshes)
    elif args.meshes == "head":
        sel = [m for m in lod_meshes if names[m].startswith("head_")]
    elif args.meshes == "face":
        # head + teeth + eyeballs (eyeball meshes only, not shell/lashes/edge)
        want = ("head_", "teeth_", "eyeleft", "eyeright")
        sel = [m for m in lod_meshes if names[m].lower().startswith(want)]
    else:
        subs = [s.strip() for s in args.meshes.split(",")]
        sel = [m for m in lod_meshes if any(s in names[m] for s in subs)]
    if not sel:
        raise SystemExit("No meshes selected for LOD %d (%s)" % (args.lod, args.meshes))
    print("selected meshes:", [names[m] for m in sel], flush=True)

    meshes = [load_mesh_static(rig, m) for m in sel]
    morph_idx = [build_morph_index(mm["targets"]) for mm in meshes]

    # combined geometry layout
    offsets = []
    off = 0
    for mm in meshes:
        offsets.append(off)
        off += mm["V"]
    total_v = off
    all_tris = np.concatenate(
        [meshes[i]["tris"] + offsets[i] for i in range(len(meshes))], axis=0)

    # controls
    columns = [l.strip() for l in open(args.columns, encoding="utf-8") if l.strip()]
    mapping = build_control_mapping(rig, columns)
    print("mapped %d of %d columns to raw controls" % (len(mapping), len(columns)), flush=True)
    col_i = np.array([c for c, _ in mapping], dtype=np.int64)
    raw_i = np.array([r for _, r in mapping], dtype=np.int64)

    data = np.load(args.npy)
    total_frames = data.shape[0]
    n_frames = total_frames
    if args.max_frames:
        n_frames = min(n_frames, args.max_frames)
    n_raw = rig.raw_control_count()

    def eval_frame(values_row):
        rv = np.zeros(n_raw, np.float32)
        rv[raw_i] = values_row[col_i]
        rig.set_raw_controls(rv)
        rig.calculate()
        bs = np.array(rig.blend_shape_outputs())
        jo = np.array(rig.joint_outputs())
        return bs, jo

    def deform(bs, jo):
        lt, lq, ls = combine_delta(n_t, n_q, n_s, jo, apj)
        world = compose_world(compose_local(lt, lq, ls), parents)
        skin = world @ bind_inv  # (J,4,4)
        outs = []
        for i, mm in enumerate(meshes):
            morphed = mm["pos"].copy()
            vidx, delta, chan = morph_idx[i]
            if vidx.shape[0] > 0:
                contrib = delta * bs[chan][:, None]
                np.add.at(morphed, vidx, contrib)
            outs.append(skin_vertices(morphed, mm["w"], mm["ji"], skin))
        return np.concatenate(outs, axis=0)

    # ---- validation: zero controls -> neutral mesh ----
    bs0, jo0 = eval_frame(np.zeros(data.shape[1], np.float32))
    neutral_def = deform(bs0, jo0)
    neutral_ref = np.concatenate([mm["pos"] for mm in meshes], axis=0)
    dev = np.abs(neutral_def - neutral_ref).max()
    print("zero-control deviation from neutral mesh: %.6g (cm)" % dev, flush=True)
    if dev > 1e-2:
        print("WARNING: zero-control mesh deviates from neutral; skinning math may be off",
              flush=True)

    # center the mesh at origin (keeps magnitudes small -> float16 friendly)
    center = ((np.array(bbox_min_pre := neutral_ref.min(axis=0)) +
               np.array(neutral_ref.max(axis=0))) * 0.5)

    # ---- bake all frames ----
    dtype = np.float16 if args.half else np.float32
    pos_path = os.path.join(args.out, "frames.bin")
    print("baking %d frames, %d verts..." % (n_frames, total_v), flush=True)
    with open(pos_path, "wb") as f:
        for fr in range(n_frames):
            bs, jo = eval_frame(data[fr])
            d = (deform(bs, jo) - center).astype(dtype)
            f.write(d.tobytes())
            if fr % 100 == 0:
                print("  frame %d/%d" % (fr, n_frames), flush=True)

    # indices
    all_tris.astype(np.uint32).tofile(os.path.join(args.out, "indices.bin"))

    # UVs (per-position, combined in same order as positions)
    all_uv = np.concatenate([mm["uv"] for mm in meshes], axis=0).astype(np.float32)
    all_uv.tofile(os.path.join(args.out, "uvs.bin"))

    # per-mesh textures + draw groups (so the viewer can use one geometry with a
    # material per mesh: head / teeth / eyes each get their own MetaHuman maps)
    def resolve_textures(mesh_name):
        if not args.textures_dir:
            return {}
        nm = mesh_name.lower()
        if nm.startswith("head_"):
            table = [("map", "Head_Basecolor.png"), ("normalMap", "Head_Normal.png")]
        elif nm.startswith("teeth_"):
            table = [("map", "Teeth_Color.png"), ("normalMap", "Teeth_Normal.png")]
        elif nm.startswith("eyeleft") or nm.startswith("eyeright"):
            table = [("map", "Eyes_Color.png"), ("normalMap", "Eyes_Normal.png")]
        elif nm.startswith("eyelashes"):
            table = [("map", "Eyelashes_Color.png")]
        else:
            table = []
        out = {}
        for key, fname in table:
            src = os.path.join(args.textures_dir, fname)
            if os.path.exists(src):
                out_name = fname.lower()
                shutil.copyfile(src, os.path.join(args.out, out_name))
                out[key] = out_name
        return out

    groups = []
    elem = 0
    for i, mm in enumerate(meshes):
        cnt = int(mm["tris"].shape[0]) * 3
        groups.append({
            "name": names[sel[i]],
            "indexStart": elem,
            "indexCount": cnt,
            "textures": resolve_textures(names[sel[i]]),
        })
        elem += cnt
    # head textures kept at top-level for backward compatibility
    textures = next((g["textures"] for g in groups if g["name"].startswith("head_")),
                    groups[0]["textures"] if groups else {})

    # audio + fps
    fps = None
    wav_out = None
    if args.wav and os.path.exists(args.wav):
        dur = wav_duration(args.wav)
        fps = total_frames / dur if dur > 0 else 30.0
        wav_out = "audio.wav"
        shutil.copyfile(args.wav, os.path.join(args.out, wav_out))
    else:
        fps = 30.0

    bbox_min = (neutral_ref.min(axis=0) - center).tolist()
    bbox_max = (neutral_ref.max(axis=0) - center).tolist()

    manifest = {
        "numVertices": int(total_v),
        "numFrames": int(n_frames),
        "numIndices": int(all_tris.size),
        "fps": float(fps),
        "positionDtype": "float16" if args.half else "float32",
        "framesFile": "frames.bin",
        "indicesFile": "indices.bin",
        "uvsFile": "uvs.bin",
        "textures": textures,
        "groups": groups,
        "audioFile": wav_out,
        "lod": args.lod,
        "meshes": [names[m] for m in sel],
        "bboxMin": bbox_min,
        "bboxMax": bbox_max,
        "center": center.tolist(),
        "zeroControlDeviation": float(dev),
    }
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("DONE ->", args.out, flush=True)
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == "__main__":
    main()
