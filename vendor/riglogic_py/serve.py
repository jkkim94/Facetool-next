# -*- coding: utf-8 -*-
"""Live RigLogic server: control values -> deformed vertices, no disk bake.

Loads FaceModel profile(s) once, then evaluates frames on demand and returns vertex
positions over HTTP. Static geometry (indices, UVs, textures) is served too so a
web viewer can render the deformation result live.

Run:
    python serve.py            # http://localhost:8765
"""
import io
import csv
import json
import os
import struct
import time
import wave

import numpy as np
from flask import Flask, request, send_file, jsonify, Response
from flask_cors import CORS

import riglogic
from face_model import FaceModel
from bake import build_control_mapping

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILES_JSON = os.environ.get(
    "RIGLOGIC_PROFILES_JSON",
    os.path.join(SCRIPT_DIR, "dna_profiles.json"),
)
DATASET = os.environ.get("RIGLOGIC_DATASET",
                         r"E:\DatasetGen\AA_Learning_Dataset_test\metahuman")
LOD = int(os.environ.get("RIGLOGIC_LOD", "0"))
if LOD != 0:
    print("WARN: RIGLOGIC_LOD=%d — forcing LOD 0 (head_lod0_mesh only)" % LOD, flush=True)
    LOD = 0
MESHES = os.environ.get("RIGLOGIC_MESHES", "face")
PORT = int(os.environ.get("RIGLOGIC_PORT", "8765"))

TEX_FILES = {
    "head_basecolor.png": "Head_Basecolor.png",
    "head_normal.png": "Head_Normal.png",
    "teeth_color.png": "Teeth_Color.png",
    "teeth_normal.png": "Teeth_Normal.png",
    "eyes_color.png": "Eyes_Color.png",
    "eyes_normal.png": "Eyes_Normal.png",
}

LIP_VERTICES_PATH = os.path.join(SCRIPT_DIR, "lip_vertices.json")
UV_MOUTH_CSV_LOD0 = os.path.join(SCRIPT_DIR, "uv_mouth_vertices_lod0.csv")
_lip_vertices_cache = None


def gui_region(name):
    n = name
    if n.startswith("CTRL_"):
        n = n[5:]
    parts = n.split("_")
    if parts and parts[0] in ("L", "R", "C"):
        parts = parts[1:]
    region = parts[0].split(".")[0] if parts else "other"
    known = ("brow", "ear", "eye", "eyelashes", "nose", "mouth",
             "jaw", "tongue", "teeth", "neck", "chin", "cheek")
    return region if region in known else "other"


def gui_range(name):
    bidir = name.endswith(".tx") or name in (
        "CTRL_L_eye.ty", "CTRL_R_eye.ty", "CTRL_C_eye_parallelLook.ty")
    return (-1.0, 1.0) if bidir else (0.0, 1.0)


class DnaProfile:
    def __init__(self, cfg):
        self.id = cfg["id"]
        self.label = cfg.get("label", self.id)
        self.dna = cfg["dna"]
        self.dna_dir = os.path.dirname(self.dna)
        self.maps = cfg.get("maps") or os.path.join(self.dna_dir, "Maps")
        region_uv = cfg.get("region_uv_texture")
        if region_uv is None:
            region_uv = os.path.join(self.dna_dir, "T_Gray_Head_D.PNG")
        self.region_uv_texture = region_uv if region_uv and os.path.exists(region_uv) else None
        self.lip_mask_json = cfg.get("lip_mask") or os.environ.get("RIGLOGIC_LIP_MASK")
        self.mouth_region_mask_json = cfg.get("mouth_region_mask") or os.environ.get(
            "RIGLOGIC_MOUTH_REGION_MASK")
        self.lower_face_mask_json = cfg.get("lower_face_mask") or os.environ.get(
            "RIGLOGIC_LOWER_FACE_MASK")
        self.dna_wm_masks_dir = os.path.join(self.dna_dir, "SourceAssets", "masks")
        self.dna_wm_manifest = os.path.join(self.dna_dir, "dna_wm_masks_manifest.json")

        print("loading FaceModel profile %s (%s, lod %d, %s)..." % (
            self.id, self.dna, LOD, MESHES), flush=True)
        self.fm = FaceModel(self.dna, lod=LOD, meshes=MESHES)
        self.raw_names = list(self.fm.rig.raw_control_names())
        self.center = ((self.fm.neutral_vertices.min(axis=0)
                        + self.fm.neutral_vertices.max(axis=0)) * 0.5)
        self.bbox_min = (self.fm.neutral_vertices.min(axis=0) - self.center)
        self.bbox_max = (self.fm.neutral_vertices.max(axis=0) - self.center)
        self.gui_meta = [
            {"index": i, "name": n, "region": gui_region(n),
             "min": gui_range(n)[0], "max": gui_range(n)[1]}
            for i, n in enumerate(self.fm.gui_control_names)
        ]
        print("  ready: %d verts, %d raw controls" % (
            self.fm.vertex_count, self.fm.raw_control_count), flush=True)
        if self.region_uv_texture:
            print("  region UV texture: %s" % self.region_uv_texture, flush=True)
        else:
            print("  WARN: region UV texture missing for %s" % self.id, flush=True)

    def textures_for(self, mesh_name):
        nm = mesh_name.lower()
        if nm.startswith("head_"):
            t = {"map": "head_basecolor.png", "normalMap": "head_normal.png"}
        elif nm.startswith("teeth_"):
            t = {"map": "teeth_color.png", "normalMap": "teeth_normal.png"}
        elif nm.startswith("eyeleft") or nm.startswith("eyeright"):
            t = {"map": "eyes_color.png", "normalMap": "eyes_normal.png"}
        else:
            return {}
        return {k: v for k, v in t.items()
                if os.path.exists(os.path.join(self.maps, TEX_FILES.get(v, "")))}

    def groups_payload(self):
        groups = []
        for g in self.fm.groups:
            gg = dict(g)
            gg["textures"] = self.textures_for(g["name"])
            groups.append(gg)
        return groups

    def summary(self):
        return {
            "id": self.id,
            "label": self.label,
            "dna": self.dna,
            "vertexCount": self.fm.vertex_count,
            "headVertexCount": int(self.fm._meshes[0]["V"]),
            "guiControlCount": self.fm.gui_control_count,
            "hasRegionUvTexture": bool(self.region_uv_texture),
            "hasLipMask": bool(self.lip_mask_json and os.path.exists(self.lip_mask_json)),
        }


def profile_config_from_env():
    dna = os.environ.get("RIGLOGIC_DNA", r"E:\Viewer\DNA\0421_V33\head.dna")
    dna_dir = os.path.dirname(dna)
    return {
        "id": os.path.basename(dna_dir) or "default",
        "label": os.path.basename(dna_dir) or "default",
        "dna": dna,
        "maps": os.environ.get("RIGLOGIC_MAPS", os.path.join(dna_dir, "Maps")),
        "region_uv_texture": os.environ.get(
            "RIGLOGIC_REGION_UV_TEXTURE",
            os.path.join(dna_dir, "T_Gray_Head_D.PNG"),
        ),
        "lip_mask": os.environ.get(
            "RIGLOGIC_LIP_MASK",
            r"E:\Viewer\DNA\0421_V33\lip_mask_v1\metahuman_head_lod0_lip_mask.json",
        ),
        "mouth_region_mask": os.environ.get(
            "RIGLOGIC_MOUTH_REGION_MASK",
            r"E:\Viewer\DNA\0421_V33\lip_mask_v1\metahuman_head_lod0_mouth_region_mask.json",
        ),
        "lower_face_mask": os.environ.get(
            "RIGLOGIC_LOWER_FACE_MASK",
            r"E:\Viewer\DNA\0421_V33\lip_mask_v1\metahuman_head_lod0_lower_face_mask.json",
        ),
    }


def load_profile_configs():
    if os.environ.get("RIGLOGIC_DNA"):
        return [profile_config_from_env()], os.environ.get("RIGLOGIC_DNA_PROFILE", None)
    if not os.path.isfile(PROFILES_JSON):
        return [profile_config_from_env()], None
    with open(PROFILES_JSON, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("profiles") or [], data.get("default")


PROFILE_CONFIGS, DEFAULT_PROFILE_ID = load_profile_configs()
PROFILES = {}
for cfg in PROFILE_CONFIGS:
    pid = cfg["id"]
    PROFILES[pid] = DnaProfile(cfg)

if not PROFILES:
    raise SystemExit("no DNA profiles configured")

ACTIVE_ID = DEFAULT_PROFILE_ID if DEFAULT_PROFILE_ID in PROFILES else next(iter(PROFILES))
print("active DNA profile: %s (%s)" % (ACTIVE_ID, PROFILES[ACTIVE_ID].label), flush=True)


def active():
    return PROFILES[ACTIVE_ID]


import threading
EVAL_LOCK = threading.Lock()
CLIPS = {}
INFERENCE = {}


def clear_clip_caches():
    for info in CLIPS.values():
        info["cache"].clear()


def _ensure_fm_columns(fm, columns):
    cols = [str(c) for c in columns]
    if fm._col_i is None or list(fm.columns) != cols:
        fm.set_columns(cols)
    return cols


def list_clips():
    out = []
    try:
        files = set(os.listdir(DATASET))
    except OSError:
        return out
    for f in sorted(files):
        if f.endswith(".npy") and (f[:-4] + ".columns.txt") in files:
            out.append(f[:-4])
    return out


def wav_fps(clip_id, n_frames):
    wav = os.path.join(DATASET, clip_id + ".wav")
    if os.path.exists(wav):
        with wave.open(wav, "rb") as wf:
            dur = wf.getnframes() / float(wf.getframerate())
        if dur > 0:
            return n_frames / dur
    return 30.0


def get_clip(clip_id):
    if clip_id in CLIPS:
        return CLIPS[clip_id]
    npy = os.path.join(DATASET, clip_id + ".npy")
    cols = os.path.join(DATASET, clip_id + ".columns.txt")
    if not (os.path.exists(npy) and os.path.exists(cols)):
        return None
    data = np.load(npy)
    columns = [l.strip() for l in open(cols, encoding="utf-8") if l.strip()]
    fm = active().fm
    mapping = build_control_mapping(fm.rig, columns)
    col_i = np.array([c for c, _ in mapping], dtype=np.int64)
    raw_i = np.array([r for _, r in mapping], dtype=np.int64)
    info = {
        "data": data,
        "col_i": col_i,
        "raw_i": raw_i,
        "fps": wav_fps(clip_id, data.shape[0]),
        "cache": {},
    }
    CLIPS[clip_id] = info
    return info


def eval_frame(clip_id, i):
    info = get_clip(clip_id)
    if info is None:
        return None
    if i in info["cache"]:
        return info["cache"][i]
    row = info["data"][i]
    p = active()
    raw = np.zeros(p.fm.raw_control_count, np.float32)
    raw[info["raw_i"]] = row[info["col_i"]]
    with EVAL_LOCK:
        v = p.fm.eval_raw(raw)
    v = (v - p.center).astype(np.float32)
    info["cache"][i] = v
    return v


def uv_mouth_csv_path(lod: int) -> str:
    if lod == 0:
        return UV_MOUTH_CSV_LOD0
    base, ext = os.path.splitext(UV_MOUTH_CSV_LOD0)
    return "%s_lod%d%s" % (base, lod, ext)


def uv_mouth_vertices_payload(lod: int = 0):
    path = uv_mouth_csv_path(lod)
    if not os.path.exists(path):
        return None
    lip = []
    mouth = []
    max_vid = -1
    csv_lod = lod
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            vid = int(row["vertex_id"])
            region = row.get("region", "").strip()
            max_vid = max(max_vid, vid)
            if region == "lip":
                lip.append(vid)
            elif region == "mouth":
                mouth.append(vid)
            if row.get("lod"):
                csv_lod = int(row["lod"])
    lip.sort()
    mouth.sort()
    return {
        "lip": lip,
        "mouth": mouth,
        "lipCount": len(lip),
        "mouthCount": len(mouth),
        "headVertexCount": max_vid + 1 if max_vid >= 0 else 0,
        "lod": csv_lod,
        "source": "uv_mouth_csv",
        "csvPath": path,
    }


def lip_vertices_payload():
    global _lip_vertices_cache
    if _lip_vertices_cache is None and os.path.exists(LIP_VERTICES_PATH):
        with open(LIP_VERTICES_PATH, encoding="utf-8") as f:
            _lip_vertices_cache = json.load(f)
    return _lip_vertices_cache or {}


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, methods=["GET", "POST", "OPTIONS"])


@app.get("/dna_profiles")
def dna_profiles():
    return jsonify({
        "active": ACTIVE_ID,
        "profiles": [p.summary() for p in PROFILES.values()],
    })


@app.post("/dna/select")
def dna_select():
    global ACTIVE_ID
    body = request.get_json(force=True, silent=True) or {}
    pid = body.get("id") or body.get("profile")
    if not pid or pid not in PROFILES:
        return jsonify({
            "error": "unknown profile",
            "id": pid,
            "available": list(PROFILES.keys()),
        }), 400
    if pid == ACTIVE_ID:
        return jsonify({"active": ACTIVE_ID, "profile": PROFILES[ACTIVE_ID].summary()})
    ACTIVE_ID = pid
    clear_clip_caches()
    print("switched DNA profile -> %s (%s)" % (ACTIVE_ID, PROFILES[ACTIVE_ID].label), flush=True)
    return jsonify({"active": ACTIVE_ID, "profile": PROFILES[ACTIVE_ID].summary()})


@app.get("/geo")
def geo():
    """Clip-independent static geometry (for interactive GUI mode)."""
    p = active()
    fm = p.fm
    head_v = int(fm._meshes[0]["V"])
    mesh_starts = list(fm.offsets) + [fm.vertex_count]
    return jsonify({
        "numVertices": fm.vertex_count,
        "headVertexCount": head_v,
        "meshVertexStarts": mesh_starts,
        "lod": LOD,
        "meshes": fm.mesh_names,
        "groups": p.groups_payload(),
        "bboxMin": p.bbox_min.tolist(),
        "bboxMax": p.bbox_max.tolist(),
        "center": p.center.tolist(),
        "indicesUrl": "/indices",
        "uvsUrl": "/uvs",
        "deformStaticUrl": "/deform_static",
        "dnaProfileId": p.id,
        "dnaProfileLabel": p.label,
    })


@app.get("/gui")
def gui():
    p = active()
    return jsonify({"count": p.fm.gui_control_count, "controls": p.gui_meta,
                    "dnaProfileId": p.id})


@app.get("/lip_vertices")
def lip_vertices():
    return jsonify(lip_vertices_payload())


@app.get("/uv_mouth_vertices")
def uv_mouth_vertices():
    req_lod = request.args.get("lod")
    if req_lod is not None and int(req_lod) != 0:
        print("WARN: /uv_mouth_vertices?lod=%s ignored — LOD 0 only" % req_lod, flush=True)
    payload = uv_mouth_vertices_payload(0)
    if payload is None:
        path = uv_mouth_csv_path(0)
        return jsonify({
            "error": "csv not found — run export_uv_mouth_vertices_csv.py --lod 0",
            "path": path,
        }), 404
    return jsonify(payload)


@app.get("/lip_mask")
def lip_mask():
    req_lod = request.args.get("lod")
    if req_lod is not None and int(req_lod) != 0:
        print("WARN: /lip_mask?lod=%s ignored — LOD 0 only" % req_lod, flush=True)
    path = active().lip_mask_json
    if not path or not os.path.exists(path):
        return jsonify({
            "error": "metahuman_head_lod0_lip_mask.json not found — run export_lip_mask_lod0.py",
            "path": path,
        }), 404
    with open(path, encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.get("/mouth_region_mask")
def mouth_region_mask():
    req_lod = request.args.get("lod")
    if req_lod is not None and int(req_lod) != 0:
        print("WARN: /mouth_region_mask?lod=%s ignored — LOD 0 only" % req_lod, flush=True)
    path = active().mouth_region_mask_json
    if not path or not os.path.exists(path):
        return jsonify({
            "error": "metahuman_head_lod0_mouth_region_mask.json not found",
            "path": path,
        }), 404
    with open(path, encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.get("/lower_face_mask")
def lower_face_mask():
    req_lod = request.args.get("lod")
    if req_lod is not None and int(req_lod) != 0:
        print("WARN: /lower_face_mask?lod=%s ignored — LOD 0 only" % req_lod, flush=True)
    path = active().lower_face_mask_json
    if not path or not os.path.exists(path):
        return jsonify({
            "error": "metahuman_head_lod0_lower_face_mask.json not found",
            "path": path,
        }), 404
    with open(path, encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.get("/deform_static")
def deform_static():
    """DNA morph + skin static data for browser-side deform (binary RLDS v1)."""
    p = active()
    data = p.fm.pack_deform_static(p.center)
    return Response(data, mimetype="application/octet-stream")


@app.post("/eval_rig/batch")
def eval_rig_batch():
    """RigLogic only: columns + rows -> packed bs+jo per frame (no vertices)."""
    p = active()
    body = request.get_json(force=True, silent=True) or {}
    columns = body.get("columns")
    rows = body.get("rows")
    if not columns or rows is None:
        return jsonify({"error": "columns and rows required"}), 400
    arr = np.asarray(rows, dtype=np.float32)
    if arr.ndim != 2:
        return jsonify({"error": "rows must be 2D"}), 400
    _ensure_fm_columns(p.fm, columns)
    t0 = time.perf_counter()
    with EVAL_LOCK:
        bs_all, jo_all = p.fm.eval_rig_columns_batch(arr)
    eval_ms = (time.perf_counter() - t0) * 1000.0
    n = int(arr.shape[0])
    bs_count = int(bs_all.shape[1])
    jo_count = int(jo_all.shape[1])
    buf = io.BytesIO()
    buf.write(b"RLRG")
    buf.write(struct.pack("<4I", 1, n, bs_count, jo_count))
    buf.write(bs_all.astype(np.float32).tobytes())
    buf.write(jo_all.astype(np.float32).tobytes())
    return Response(
        buf.getvalue(),
        mimetype="application/octet-stream",
        headers={
            "X-Frame-Count": str(n),
            "X-Bs-Count": str(bs_count),
            "X-Jo-Count": str(jo_count),
            "X-Eval-Total-Ms": "%.2f" % eval_ms,
        },
    )


@app.get("/eval_columns")
def eval_columns_health():
    return jsonify({
        "available": True,
        "endpoints": [
            "GET /deform_static",
            "POST /eval_gui_rig",
            "POST /eval_rig/batch",
            "POST /eval_columns/batch",
            "POST /eval_columns",
        ],
    })


@app.post("/eval_columns/batch")
def eval_columns_batch():
    """Stateless block eval: columns + rows[F][C] -> F * V * 3 float32 (no session upload)."""
    p = active()
    body = request.get_json(force=True, silent=True) or {}
    columns = body.get("columns")
    rows = body.get("rows")
    if not columns or rows is None:
        return jsonify({"error": "columns and rows required"}), 400
    arr = np.asarray(rows, dtype=np.float32)
    if arr.ndim != 2:
        return jsonify({"error": "rows must be 2D [frames][channels]"}), 400
    if arr.shape[1] != len(columns):
        return jsonify({"error": "expected %d channels, got %d" % (
            len(columns), arr.shape[1])}), 400
    _ensure_fm_columns(p.fm, columns)
    t0 = time.perf_counter()
    with EVAL_LOCK:
        verts = p.fm.eval_columns_batch(arr)
    center = p.center.astype(np.float32)
    out = (verts - center).astype(np.float32)
    eval_ms = (time.perf_counter() - t0) * 1000.0
    stride = int(p.fm.vertex_count * 3)
    return Response(
        out.reshape(-1).tobytes(),
        mimetype="application/octet-stream",
        headers={
            "X-Count": str(int(arr.shape[0])),
            "X-Stride": str(stride),
            "X-Eval-Total-Ms": "%.2f" % eval_ms,
            "X-Eval-Avg-Ms": "%.2f" % (eval_ms / max(1, arr.shape[0])),
        },
    )


@app.post("/eval_columns/register")
def eval_columns_register():
    """Register in-memory inference session (columns + all rows) for block streaming."""
    import uuid
    p = active()
    body = request.get_json(force=True, silent=True) or {}
    columns = body.get("columns")
    rows = body.get("rows")
    if not columns or rows is None:
        return jsonify({"error": "columns and rows required"}), 400
    data = np.asarray(rows, dtype=np.float32)
    if data.ndim != 2:
        return jsonify({"error": "rows must be 2D [frames][channels]"}), 400
    if data.shape[1] != len(columns):
        return jsonify({"error": "expected %d channels, got %d" % (
            len(columns), data.shape[1])}), 400
    _ensure_fm_columns(p.fm, columns)
    sid = str(body.get("sessionId") or uuid.uuid4().hex[:16])
    INFERENCE[sid] = {"data": data, "cache": {}}
    fm = p.fm
    return jsonify({
        "sessionId": sid,
        "numFrames": int(data.shape[0]),
        "numVertices": int(fm.vertex_count),
        "channels": int(data.shape[1]),
    })


def eval_inference_frame_timed(sid, i):
    info = INFERENCE.get(sid)
    if info is None:
        return None, 0.0, False
    if i in info["cache"]:
        return info["cache"][i], 0.0, True
    if i < 0 or i >= info["data"].shape[0]:
        return None, 0.0, False
    t0 = time.perf_counter()
    p = active()
    row = info["data"][i]
    with EVAL_LOCK:
        v = p.fm.eval_columns(row)
    v = (v - p.center).astype(np.float32)
    eval_ms = (time.perf_counter() - t0) * 1000.0
    info["cache"][i] = v
    return v, eval_ms, False


@app.get("/eval_columns/frames")
def eval_columns_frames():
    sid = request.args.get("session")
    info = INFERENCE.get(sid)
    if info is None:
        return jsonify({"error": "session not found"}), 404
    n = int(info["data"].shape[0])
    start = max(0, int(request.args.get("start", "0")))
    count = int(request.args.get("count", "30"))
    end = min(n, start + count)
    p = active()
    stride = int(p.fm.vertex_count * 3)
    t0 = time.perf_counter()
    eval_ms_total = 0.0
    eval_count = 0
    cache_hits = 0

    missing = [i for i in range(start, end) if i not in info["cache"]]
    cache_hits = (end - start) - len(missing)
    if missing:
        t_eval = time.perf_counter()
        rows = info["data"][missing]
        with EVAL_LOCK:
            verts = p.fm.eval_columns_batch(rows)
        center = p.center.astype(np.float32)
        for idx, v in zip(missing, verts):
            info["cache"][idx] = (v - center).astype(np.float32)
        eval_ms_total = (time.perf_counter() - t_eval) * 1000.0
        eval_count = len(missing)

    buf = io.BytesIO()
    for i in range(start, end):
        v = info["cache"].get(i)
        if v is None:
            return jsonify({"error": "frame %d eval failed" % i}), 500
        buf.write(v.tobytes())

    total_ms = (time.perf_counter() - t0) * 1000.0
    avg_eval = (eval_ms_total / eval_count) if eval_count else 0.0
    return Response(
        buf.getvalue(),
        mimetype="application/octet-stream",
        headers={
            "X-Session": sid,
            "X-Start": str(start),
            "X-End": str(end),
            "X-Count": str(end - start),
            "X-Stride": str(stride),
            "X-Eval-Total-Ms": "%.2f" % eval_ms_total,
            "X-Eval-Avg-Ms": "%.2f" % avg_eval,
            "X-Request-Total-Ms": "%.2f" % total_ms,
            "X-Eval-Count": str(eval_count),
            "X-Cache-Hits": str(cache_hits),
        },
    )


@app.post("/eval_columns")
def eval_columns():
    """Single frame: dataset column layout -> deformed vertices."""
    p = active()
    body = request.get_json(force=True, silent=True) or {}
    columns = body.get("columns")
    values = body.get("values")
    if not columns or values is None:
        return jsonify({"error": "columns and values required"}), 400
    if len(columns) != len(values):
        return jsonify({"error": "expected %d values, got %d" % (
            len(columns), len(values))}), 400
    fm = p.fm
    _ensure_fm_columns(fm, columns)
    row = np.asarray(values, dtype=np.float32)
    with EVAL_LOCK:
        v = fm.eval_columns(row)
    v = (v - p.center).astype(np.float32)
    return Response(v.tobytes(), mimetype="application/octet-stream")


@app.post("/eval_gui_rig")
def eval_gui_rig():
    """GUI controls -> packed bs+jo (RLRG v1, single frame). No vertices."""
    p = active()
    body = request.get_json(force=True, silent=True) or {}
    vals = body.get("values")
    if vals is None or len(vals) != p.fm.gui_control_count:
        return jsonify({"error": "expected %d values" % p.fm.gui_control_count}), 400
    g = np.asarray(vals, dtype=np.float32)
    t0 = time.perf_counter()
    with EVAL_LOCK:
        bs, jo = p.fm.eval_rig_gui(g)
    eval_ms = (time.perf_counter() - t0) * 1000.0
    bs_count = int(bs.shape[0])
    jo_count = int(jo.shape[0])
    buf = io.BytesIO()
    buf.write(b"RLRG")
    buf.write(struct.pack("<4I", 1, 1, bs_count, jo_count))
    buf.write(bs.astype(np.float32).tobytes())
    buf.write(jo.astype(np.float32).tobytes())
    return Response(
        buf.getvalue(),
        mimetype="application/octet-stream",
        headers={
            "X-Frame-Count": "1",
            "X-Bs-Count": str(bs_count),
            "X-Jo-Count": str(jo_count),
            "X-Eval-Total-Ms": "%.2f" % eval_ms,
        },
    )


@app.get("/identity_pair")
def identity_pair():
    """Male/female DNA pair used for identity blend slider."""
    male_id = request.args.get("male") or "man"
    female_id = request.args.get("female") or "0421_V33"
    if male_id not in PROFILES or female_id not in PROFILES:
        return jsonify({
            "error": "profile not loaded",
            "male": male_id,
            "female": female_id,
            "available": list(PROFILES.keys()),
        }), 400
    pa = PROFILES[male_id]
    pb = PROFILES[female_id]
    ok = int(pa.fm.vertex_count) == int(pb.fm.vertex_count)
    sculpt_meta = None
    try:
        from identity_sculpt import get_identity_sculpt_model
        sculpt_meta = get_identity_sculpt_model().feature_meta()
    except Exception as e:
        sculpt_meta = {"error": str(e)}
    return jsonify({
        "male": pa.summary(),
        "female": pb.summary(),
        "compatible": ok,
        "vertexCount": int(pa.fm.vertex_count),
        "guiControlCount": int(pa.fm.gui_control_count),
        "sculpt": sculpt_meta,
    })


@app.post("/eval_gui_blend")
def eval_gui_blend():
    """Lerp / soft-region sculpt between two DNA faces.

    Body:
      values: GUI controls
      t: global male→female (used when features omitted)
      features: { nose:0..1, chin:0..1, ... } Creator-like region amounts
      overall: default amount for unspecified regions (default 0)
      male / female: profile ids
    """
    body = request.get_json(force=True, silent=True) or {}
    male_id = body.get("male") or "man"
    female_id = body.get("female") or "0421_V33"
    t = float(body.get("t", 0.0))
    t = max(0.0, min(1.5, t))
    features = body.get("features")
    overall = float(body.get("overall", t if features is None else 0.0))
    vals = body.get("values")
    if male_id not in PROFILES or female_id not in PROFILES:
        return jsonify({
            "error": "profile not loaded",
            "available": list(PROFILES.keys()),
        }), 400
    pa = PROFILES[male_id]
    pb = PROFILES[female_id]
    if pa.fm.vertex_count != pb.fm.vertex_count:
        return jsonify({
            "error": "vertex count mismatch",
            "male": pa.fm.vertex_count,
            "female": pb.fm.vertex_count,
        }), 400
    if pa.fm.gui_control_count != pb.fm.gui_control_count:
        return jsonify({
            "error": "gui control count mismatch",
            "male": pa.fm.gui_control_count,
            "female": pb.fm.gui_control_count,
        }), 400
    if vals is None or len(vals) != pa.fm.gui_control_count:
        return jsonify({"error": "expected %d values" % pa.fm.gui_control_count}), 400
    g = np.asarray(vals, dtype=np.float32)
    t0 = time.perf_counter()
    with EVAL_LOCK:
        va = pa.fm.eval_gui(g)
        vb = pb.fm.eval_gui(g)

    use_sculpt = isinstance(features, dict)
    if use_sculpt:
        try:
            from identity_sculpt import get_identity_sculpt_model
            model = get_identity_sculpt_model()
            amounts = model.amounts_from_features(features, overall=overall)
            # allow slight exaggerate
            amounts = np.clip(amounts, -0.25, 1.35)
            v = model.blend_meshes(va, vb, amounts)
            # center: weighted by mean amount
            gmean = float(np.clip(amounts.mean(), 0.0, 1.0))
            center = (1.0 - gmean) * pa.center + gmean * pb.center
            mode = "sculpt"
        except Exception as e:
            return jsonify({"error": "identity sculpt failed: %s" % e}), 500
    else:
        tt = max(0.0, min(1.0, t))
        v = (1.0 - tt) * va + tt * vb
        center = (1.0 - tt) * pa.center + tt * pb.center
        mode = "lerp"

    out = (v - center).astype(np.float32)
    eval_ms = (time.perf_counter() - t0) * 1000.0
    return Response(
        out.tobytes(),
        mimetype="application/octet-stream",
        headers={
            "X-Vertex-Count": str(out.shape[0]),
            "X-Blend-T": "%.4f" % t,
            "X-Blend-Mode": mode,
            "X-Eval-Total-Ms": "%.2f" % eval_ms,
        },
    )


@app.post("/eval_gui")
def eval_gui():
    p = active()
    body = request.get_json(force=True, silent=True) or {}
    vals = body.get("values")
    if vals is None or len(vals) != p.fm.gui_control_count:
        return jsonify({"error": "expected %d values" % p.fm.gui_control_count}), 400
    g = np.asarray(vals, dtype=np.float32)
    with EVAL_LOCK:
        v = p.fm.eval_gui(g)
    v = (v - p.center).astype(np.float32)
    return Response(v.tobytes(), mimetype="application/octet-stream")


@app.post("/control_deltas")
def control_deltas():
    p = active()
    body = request.get_json(force=True, silent=True) or {}
    indices = body.get("indices") or []
    if not indices:
        return jsonify({"error": "indices required"}), 400
    head_max = int(p.fm._meshes[0]["V"])
    neutral = p.fm.neutral_vertices[:head_max]
    max_delta = np.zeros(head_max, dtype=np.float32)
    with EVAL_LOCK:
        for i in indices:
            ii = int(i)
            if ii < 0 or ii >= p.fm.gui_control_count:
                continue
            g = np.zeros(p.fm.gui_control_count, dtype=np.float32)
            g[ii] = 1.0
            v = p.fm.eval_gui(g)[:head_max]
            delta = np.linalg.norm(v - neutral, axis=1)
            np.maximum(max_delta, delta, out=max_delta)
    return jsonify({
        "headVertexCount": head_max,
        "maxCm": round(float(max_delta.max()), 6),
        "deltas": [round(float(x), 6) for x in max_delta],
    })


@app.get("/clips")
def clips():
    return jsonify({"clips": list_clips()})


@app.get("/meta")
def meta():
    p = active()
    fm = p.fm
    clip_id = request.args.get("clip")
    info = get_clip(clip_id)
    if info is None:
        return jsonify({"error": "clip not found"}), 404
    groups = []
    for g in fm.groups:
        gg = dict(g)
        gg["textures"] = p.textures_for(g["name"])
        groups.append(gg)
    return jsonify({
        "clip": clip_id,
        "numVertices": fm.vertex_count,
        "headVertexCount": int(fm._meshes[0]["V"]),
        "meshVertexStarts": list(fm.offsets) + [fm.vertex_count],
        "numFrames": int(info["data"].shape[0]),
        "fps": float(info["fps"]),
        "lod": LOD,
        "meshes": fm.mesh_names,
        "groups": groups,
        "bboxMin": p.bbox_min.tolist(),
        "bboxMax": p.bbox_max.tolist(),
        "center": p.center.tolist(),
        "audioUrl": "/audio?clip=" + clip_id,
        "indicesUrl": "/indices",
        "uvsUrl": "/uvs",
        "dnaProfileId": p.id,
        "dnaProfileLabel": p.label,
    })


@app.get("/indices")
def indices():
    return Response(active().fm.indices.tobytes(), mimetype="application/octet-stream")


@app.get("/uvs")
def uvs():
    return Response(active().fm.uvs.tobytes(), mimetype="application/octet-stream")


def eval_frame_timed(clip_id, i):
    """Return (vertices, eval_ms, from_cache)."""
    info = get_clip(clip_id)
    if info is None:
        return None, 0.0, False
    if i in info["cache"]:
        return info["cache"][i], 0.0, True
    t0 = time.perf_counter()
    row = info["data"][i]
    p = active()
    raw = np.zeros(p.fm.raw_control_count, np.float32)
    raw[info["raw_i"]] = row[info["col_i"]]
    with EVAL_LOCK:
        v = p.fm.eval_raw(raw)
    v = (v - p.center).astype(np.float32)
    eval_ms = (time.perf_counter() - t0) * 1000.0
    info["cache"][i] = v
    return v, eval_ms, False


@app.get("/frame")
def frame():
    clip_id = request.args.get("clip")
    i = int(request.args.get("i", "0"))
    v, eval_ms, cached = eval_frame_timed(clip_id, i)
    if v is None:
        return jsonify({"error": "clip not found"}), 404
    headers = {
        "X-Eval-Ms": "%.2f" % eval_ms,
        "X-Eval-Cached": "1" if cached else "0",
    }
    return Response(v.tobytes(), mimetype="application/octet-stream", headers=headers)


@app.get("/frames")
def frames():
    clip_id = request.args.get("clip")
    info = get_clip(clip_id)
    if info is None:
        return jsonify({"error": "clip not found"}), 404
    n = int(info["data"].shape[0])
    start = max(0, int(request.args.get("start", "0")))
    count = int(request.args.get("count", "30"))
    end = min(n, start + count)
    t0 = time.perf_counter()
    eval_ms_total = 0.0
    eval_count = 0
    cache_hits = 0
    buf = io.BytesIO()
    for i in range(start, end):
        v, eval_ms, cached = eval_frame_timed(clip_id, i)
        if v is None:
            return jsonify({"error": "clip not found"}), 404
        if cached:
            cache_hits += 1
        else:
            eval_ms_total += eval_ms
            eval_count += 1
        buf.write(v.tobytes())
    total_ms = (time.perf_counter() - t0) * 1000.0
    avg_eval = (eval_ms_total / eval_count) if eval_count else 0.0
    return Response(
        buf.getvalue(),
        mimetype="application/octet-stream",
        headers={
            "X-Start": str(start),
            "X-End": str(end),
            "X-Eval-Total-Ms": "%.2f" % eval_ms_total,
            "X-Eval-Avg-Ms": "%.2f" % avg_eval,
            "X-Request-Total-Ms": "%.2f" % total_ms,
            "X-Eval-Count": str(eval_count),
            "X-Cache-Hits": str(cache_hits),
        },
    )


@app.get("/dna_wm_masks")
def dna_wm_masks():
    p = active()
    if os.path.isfile(p.dna_wm_manifest):
        return send_file(p.dna_wm_manifest, mimetype="application/json")
    if not os.path.isdir(p.dna_wm_masks_dir):
        return jsonify({"error": "masks dir missing", "path": p.dna_wm_masks_dir}), 404
    files = sorted(f for f in os.listdir(p.dna_wm_masks_dir) if f.lower().endswith(".tga"))
    return jsonify({
        "metadata": {"masks_dir": p.dna_wm_masks_dir, "mask_count": len(files),
                     "note": "run export_dna_wm_mask_manifest.py for full DNA links"},
        "masks": [{"index": i, "file": f} for i, f in enumerate(files)],
    })


@app.get("/dna_wm_mask")
def dna_wm_mask_tga():
    p = active()
    name = os.path.basename(request.args.get("file", ""))
    if not name.lower().endswith(".tga"):
        return jsonify({"error": "expected .tga file"}), 400
    path = os.path.join(p.dna_wm_masks_dir, name)
    if not os.path.isfile(path):
        return jsonify({"error": "not found", "path": path}), 404
    return send_file(path, mimetype="application/octet-stream")


@app.get("/texture")
def texture():
    p = active()
    name = os.path.basename(request.args.get("name", ""))
    name_lower = name.lower()
    if name_lower in ("gray_head_regions", "t_gray_head_d.png", "identity_regions_uv"):
        if p.region_uv_texture and os.path.exists(p.region_uv_texture):
            return send_file(p.region_uv_texture, mimetype="image/png")
        return jsonify({"error": "not found", "path": p.region_uv_texture}), 404
    src = TEX_FILES.get(name_lower)
    if not src:
        return jsonify({"error": "unknown texture"}), 404
    path = os.path.join(p.maps, src)
    if not os.path.exists(path):
        return jsonify({"error": "not found"}), 404
    return send_file(path, mimetype="image/png")


@app.get("/audio")
def audio():
    clip_id = os.path.basename(request.args.get("clip", ""))
    path = os.path.join(DATASET, clip_id + ".wav")
    if not os.path.exists(path):
        return jsonify({"error": "not found"}), 404
    return send_file(path, mimetype="audio/wav", conditional=True)


if __name__ == "__main__":
    print("  GET /deform_static + POST /eval_gui_rig /eval_rig/batch — browser-side deform", flush=True)
    app.run(host="0.0.0.0", port=PORT, threaded=True)
