# FaceTool 백엔드 연결

FaceTool 브라우저는 **원격 FastAPI에 직접 요청하지 않습니다.**  
모든 학습·추론 API는 Next.js **Route Handler** (`app/api/*`)를 거칩니다.

## 아키텍처

```
Browser  →  http://localhost:3300/api/*  →  Next.js (BFF)
                                              ├─ ENABLE_LOCAL_RESULTS → E:\results_* 스캔
                                              ├─ ENABLE_LOCAL_ONNX    → scripts/onnx_inference.py
                                              └─ 그 외                → EPOCH_API_URL (FastAPI)
```

## 환경 변수 (`.env.local`)

| 변수 | 기본 | 설명 |
|------|------|------|
| `EPOCH_API_URL` | `http://172.30.1.21:8000` | trainFramework FastAPI |
| `ENABLE_LOCAL_RESULTS` | `false` | `true`면 `RESULTS_BASE_PATH`에서 run 목록 스캔 |
| `RESULTS_BASE_PATH` | `E:\` | 로컬 results 루트 |
| `ENABLE_LOCAL_ONNX` | `false` | `true`면 Next 프로세스에서 Python ONNX 실행 |
| `ONNX_MODEL_PATH` | *(없음)* | 로컬 ONNX `.onnx` 절대 경로 (**필수**, 로컬 추론 시) |
| `ONNX_PYTHON` | `python` | ONNX용 Python 실행 파일 |

## 추론 모드

1. **서버 GPU (권장)**  
   `ENABLE_LOCAL_ONNX=false`, 서비스 탭에서 `run` + `checkpoint` + `speaker` 선택 → `POST /api/inference` → FastAPI.

2. **로컬 ONNX**  
   `ENABLE_LOCAL_ONNX=true`, `ONNX_MODEL_PATH`에 유효한 모델, `run` 없이 요청 (또는 `run=local_onnx`).  
   D10 모델은 제거됨 — D11 등 export한 ONNX 경로를 지정하세요.

## 확인

```bash
curl http://localhost:3300/api/inference/config
```

`backendUrl`, `localOnnx`, `onnxModelPath`, `onnxModelExists` 확인.

## 관련 문서

- [FRONT_BACKEND_CONTRACT.md](./FRONT_BACKEND_CONTRACT.md) — 요청/응답 필드
