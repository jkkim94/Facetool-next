#!/usr/bin/env python3
"""
UniTalker ONNX 로컬 추론 (FaceTool /api/inference 연동)

입력(JSON stdin):
  audio_base64: str  — WAV/MP3 등 오디오 파일 base64
  model_path: str     — .onnx 경로 (기본: ONNX_MODEL_PATH 환경변수)

출력(JSON stdout):
  success, blendshapes, data, fps, frames
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys

import librosa
import numpy as np
import onnxruntime as ort

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 16000
FPS = 30.0

# ARKit 51 (_neutral 제외, 인덱스 1~51)
BLENDSHAPE_NAMES = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
    "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight",
]


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def emit_error(message: str, status: int = 500) -> None:
    emit({"success": False, "error": message, "status": status})


def decode_audio(audio_base64: str) -> np.ndarray:
    raw = base64.b64decode(audio_base64)
    audio, _ = librosa.load(io.BytesIO(raw), sr=SAMPLE_RATE, mono=True)
    if audio.size == 0:
        raise ValueError("오디오가 비어 있습니다.")
    return audio.astype(np.float32)


def normalize_clip(wave: np.ndarray) -> np.ndarray:
    """Wav2Vec2FeatureExtractor 호환 clip 단위 mean/var 정규화."""
    mean = float(wave.mean())
    var = float(wave.var())
    return ((wave - mean) / np.sqrt(var + 1e-7)).astype(np.float32)


def chunk_controls_to_frames(chunks: list[np.ndarray]) -> list[dict]:
    """chunks: list of (30, 52) arrays."""
    frames: list[dict] = []
    frame_idx = 0
    for chunk in chunks:
        for t in range(chunk.shape[0]):
            row = chunk[t]
            entry = {
                "frame": frame_idx,
                "time_sec": round(frame_idx / FPS, 6),
            }
            for j, name in enumerate(BLENDSHAPE_NAMES):
                entry[name] = float(row[j + 1])  # 0 = _neutral
            frames.append(entry)
            frame_idx += 1
    return frames


def run_session(session: ort.InferenceSession, audio: np.ndarray) -> list[dict]:
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    if audio.size < WINDOW_SAMPLES:
        padded = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
        padded[: audio.size] = audio
        windows = [padded]
    else:
        n_windows = int(np.ceil(audio.size / WINDOW_SAMPLES))
        windows = []
        for i in range(n_windows):
            start = i * WINDOW_SAMPLES
            chunk = audio[start : start + WINDOW_SAMPLES]
            if chunk.size < WINDOW_SAMPLES:
                padded = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
                padded[: chunk.size] = chunk
                chunk = padded
            windows.append(chunk)

    chunks_out: list[np.ndarray] = []
    for wave in windows:
        normed = normalize_clip(wave)
        inp = normed.reshape(1, WINDOW_SAMPLES)
        out = session.run([output_name], {input_name: inp})[0]
        chunks_out.append(np.asarray(out[0], dtype=np.float32))  # (30, 52)

    return chunk_controls_to_frames(chunks_out)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        emit_error(f"stdin JSON 파싱 실패: {e}")
        return 1

    audio_b64 = payload.get("audio_base64") or payload.get("audio")
    if not audio_b64:
        emit_error("audio_base64 (또는 audio)가 필요합니다.", 400)
        return 1

    model_path = (
        payload.get("model_path")
        or os.environ.get("ONNX_MODEL_PATH")
        or ""
    )
    if not os.path.isfile(model_path):
        emit_error(f"ONNX 모델을 찾을 수 없습니다: {model_path}", 404)
        return 1

    try:
        audio = decode_audio(audio_b64)
    except Exception as e:
        emit_error(f"오디오 디코딩 실패: {e}")
        return 1

    try:
        session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )
        frames = run_session(session, audio)
    except Exception as e:
        emit_error(f"ONNX 추론 실패: {e}")
        return 1

    emit({
        "success": True,
        "blendshapes": BLENDSHAPE_NAMES,
        "data": frames,
        "fps": FPS,
        "frames": len(frames),
        "source": "local_onnx",
        "model_path": model_path,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
