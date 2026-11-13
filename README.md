# Facetool-next

FaceTool (Next.js) 프론트엔드와 RigLogic/DNA **필수 번들**입니다.  
학습 데이터셋(`DatasetGen`)·DNA `Maps` 텍스처·bake 캐시는 포함하지 않습니다.

원격: https://github.com/jkkim94/Facetool-next

## 레이아웃

```text
Facetool-next/
  FaceTool/                 # Next.js 앱 (포트 3300)
  vendor/
    DNA/0421_V33/           # head.dna, lip masks (Maps 제외)
    DNA/man/                # head.dna
    riglogic_py/            # Python 소스 + region JSON
  README.md
```

## 빠른 시작

```bash
cd FaceTool
cp .env.example .env.local   # EPOCH_API_URL 등 수정
npm install
npm run dev                  # http://localhost:3300
```

추론 모델 목록/실행은 trainFramework FastAPI (`GET /api/runs`, `POST /api/inference`)에 연결합니다.  
`EPOCH_API_URL`을 서버 주소로 맞추세요.

### RigLogic live server (선택)

```bash
cd vendor/riglogic_py
python serve.py
# FaceTool이 http://127.0.0.1:8765 로 프록시
```

## 환경 변수

| 변수 | 의미 |
|------|------|
| `EPOCH_API_URL` | trainFramework 추론 서버 |
| `FACETOOL_REPO_ROOT` | 저장소 루트 (기본: FaceTool의 상위) |
| `RIGLOGIC_PY_DIR` | `vendor/riglogic_py` 오버라이드 |
| `RIGLOGIC_DNA_DIR` / `RIGLOGIC_DNA` / `RIGLOGIC_MAPS` | DNA 경로 |
| `DATASET_GEN_ROOT` | 로컬 GT/데이터셋 루트 (저장소 밖) |
| `RESULTS_BASE_PATH` | 로컬 `results_*` 스캔 (옵션) |

자세한 예시는 [`FaceTool/.env.example`](FaceTool/.env.example).

## 저장소에 없는 것

- `vendor/DNA/**/Maps` — 텍스처 팩. 로컬에 두고 `RIGLOGIC_MAPS`로 지정
- `DatasetGen`, MonoIngest, 학습 체크포인트 — 환경변수로 경로만 연결
- `bake_out` — `bake.py` 실행 시 생성

## FaceTool 서비스 계약

모델(run) 추가는 서버 `service_manifest.json` + `best.pt`만으로 하며, FaceTool은 `output_kind` / `hasCheckpoint` 등 API 필드를 따릅니다.  
문서: `FaceTool/docs/` (계약 SoT는 trainFramework `docs/FACETOOL_SERVICE_CONTRACT.md`와 연동).
