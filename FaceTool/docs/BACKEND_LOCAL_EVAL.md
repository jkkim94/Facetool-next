# FaceTool 학습 결과 평가 — 백엔드 역할 축소 안내

FaceTool **학습 결과 평가**는 GT(Ground Truth) vs Prediction 비교를 **로컬 데이터셋**에서 처리합니다.  
아래 항목은 **더 이상 백엔드에 요청·전송·생성하지 않습니다.**

---

## 1. 프론트엔드가 백엔드에 보내지 않는 것

| 항목 | 이전 | 변경 후 |
|------|------|---------|
| GT CSV / GT NPY | `GET /api/gt`, epoch 응답의 `gtCsvContent` | **로컬** `{basePath}/{split}/{clip}.npy` (FaceTool BFF `/api/file`) |
| GT 매칭용 클립 메타 | inference 시 GT 조회를 백엔드에 위임 | **로컬** FileBrowser clip stem ↔ NPY 1:1 |
| epoch 폴더 GT 생성 | `inference_debug/{clip}_gt.csv` 등 | **불필요** (프론트가 GT 폴더 직접 읽음) |
| `source_audio_filename` (GT 목적) | GT NPY 탐색용으로 백엔드/디버그 경로 사용 | **선택** — 추론 디버그용으로만 유지 가능, GT 비교에는 미사용 |

**요청:** 위 목적의 `_gt.csv` 생성·보관·epoch API GT 필드는 **신규 개발·유지보수 대상에서 제외**해 주세요.

---

## 2. 프론트엔드가 백엔드에서 더 이상 기대하지 않는 API

| API | 용도 | 변경 |
|-----|------|------|
| `POST /api/epoch` | 학습 CSV + GT CSV + WAV + LVE/LVD | **GT 비교용 사용 중단** — epoch 샘플 목록만 필요 시 `blendshape_samples/best` 디스크 스캔 또는 최소 메타만 |
| `GET /api/epochs` | epoch 폴더 목록 | **GT 평가 UI에서 비필수** — run 디스크 스캔으로 대체 가능 |
| epoch 응답 `gtCsvContent` | GT 블렌드쉐입 | **사용 안 함** |
| epoch 응답 `lve/lvd/valLve/valLvd` | 메트릭 표시 | **선택** — 없어도 평가 UI 동작, LVE는 추후 로컬 vertex 계산 |

**유지 필요 (축소된 백엔드 역할):**

| API | 용도 |
|-----|------|
| `GET /api/runs` | 학습 run 목록 |
| `GET /api/checkpoints?run=` | 체크포인트 |
| `GET /api/speakers?run=` | 화자 |
| `POST /api/inference` | **오디오 → blendshape/control 예측만** |

---

## 3. `POST /api/inference` 계약 (유지·명확화)

### 요청 (필수만)

```json
{
  "audio_base64": "<WAV base64>",
  "run": "results_D8_control260_pretrained",
  "checkpoint": "best.pt",
  "speaker": 0
}
```

### 선택 필드

| 필드 | 용도 |
|------|------|
| `enable_eye_blink` | 추론 옵션 |
| `source_audio_filename` | **로그/디버그용만** — GT 조회에 사용하지 않음 |
| `compare_vanilla` | A/B 추론 시 |

### 응답 (필수)

```json
{
  "blendshapes": ["CTRL_expressions_jawOpen", "..."],
  "data": [[...], [...]],
  "fps": 30,
  "frames": 120,
  "channels": 260,
  "output_kind": "metahuman_260"
}
```

ARKit run 예: `channels: 51`, `output_kind: "arkit_51"`.

**GT는 응답에 포함하지 않습니다.** 프론트가 로컬 `D8_metahuman_control` 또는 ARKit 데이터셋에서 읽습니다.

---

## 4. 로컬 GT 데이터 경로 (백엔드 무관)

| 출력 | GT basePath | 형식 |
|------|-------------|------|
| MetaHuman 260 | `E:\DatasetGen\D8_metahuman_control` | `{split}/{clip}.npy` + `feature_names.txt` |
| ARKit 51/52 | `E:\DatasetGen\LipReading_Dataset_Video` 등 | `{split}/{clip}.npy` (51/52 ARKit) |

클립 WAV는 동일 폴더 `{clip}.wav` — 추론 입력으로 사용.

---

## 5. `inference_debug` 폴더 (선택)

서비스/디버그용으로 run 아래 `inference_debug/` 에 prediction CSV를 남기는 것은 **허용**합니다.  
단, FaceTool **GT vs Prediction 평가**는 이 폴더의 `_gt.csv`에 **의존하지 않습니다.**

제거·미생성해도 평가 UI에 영향 없음.

---

## 6. 요약 (백엔드 팀 액션)

1. **Inference API만 안정적으로 유지** — run/checkpoint/speaker → channels + frames + blendshapes/data
2. **`output_kind` / `channels` 필드** 응답에 포함 (MetaHuman 260 / ARKit 51 구분)
3. **epoch API의 GT CSV, inference_debug `_gt.csv` 생성** — 평가 UI 필수 아님, 우선순위 낮춤
4. **GT NPY/CSV를 inference 요청·응답에 실어 보내지 않음**

문의: FaceTool 프론트 (`Viewer/FaceTool`)
