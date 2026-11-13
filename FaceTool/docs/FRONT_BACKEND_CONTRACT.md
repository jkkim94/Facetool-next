# FaceTool ↔ FastAPI API 계약

TypeScript 정의: [`types/api.ts`](../types/api.ts)

## Runs / Checkpoints / Speakers

### `GET /api/runs`

**응답 (성공)**

```json
{
  "success": true,
  "runs": ["results_D11_ARKit52_e30"],
  "baseDir": "E:\\",
  "error": null
}
```

### `GET /api/checkpoints?run={run}`

```json
{ "success": true, "checkpoints": ["best.pt"] }
```

### `GET /api/speakers?run={run}`

```json
{ "success": true, "speakers": [0, 1] }
```

## Inference

### `POST /api/inference`

**요청**

| 필드 | 필수 | 설명 |
|------|------|------|
| `audio_base64` 또는 `audio` | O | WAV 등 base64 |
| `run` | 서버 추론 시 O | 예: `results_D11_ARKit52_e30` |
| `checkpoint` | | 기본 `best.pt`, pretrained는 `UniTalker-B-D0-D7.pt` |
| `speaker` | | 기본 `0` |
| `enable_eye_blink` | | boolean |
| `source_audio_filename` | | 디버그/매칭용 파일명 |

**성공 응답 (BFF 정규화 후)**

```json
{
  "success": true,
  "blendshapes": ["jawOpen", "..."],
  "data": [{ "frame": 0, "time_sec": 0, "jawOpen": 0.1 }],
  "fps": 30,
  "frames": 120,
  "csvContent": null,
  "audioBase64": null,
  "source": "backend"
}
```

**실패**

```json
{ "success": false, "error": "메시지" }
```

### `GET /api/inference/config`

```json
{
  "localOnnx": false,
  "onnxModelPath": null,
  "onnxModelExists": false,
  "backendUrl": "http://172.30.1.21:8000",
  "proxyToBackendWhenRunSet": true
}
```

## FastAPI 프록시 규칙

학습 결과 **GT vs Prediction 평가**는 로컬 데이터셋을 사용합니다. 자세한 백엔드 역할 축소는 [`BACKEND_LOCAL_EVAL.md`](./BACKEND_LOCAL_EVAL.md) 참고.

- `run`이 있으면 BFF가 `EPOCH_API_URL`(기본 `http://172.30.1.21:8000`)로 프록시

- BFF → `{EPOCH_API_URL}/api/inference` 등 동일 경로로 전달.
- `ENABLE_LOCAL_ONNX=true` 이고 `run`이 없으면 로컬 Python만 사용.
- `run`이 있으면 **항상** FastAPI (로컬 ONNX 무시).

## 클라이언트 헬퍼

브라우저 코드에서는 [`lib/api/client.ts`](../lib/api/client.ts) 사용 권장.
