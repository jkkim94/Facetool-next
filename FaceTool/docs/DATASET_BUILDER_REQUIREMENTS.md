# FaceTool Dataset Builder 요구사항정의서

## 1. 목적

`MonoIngest_Chunked` 데이터를 기반으로 긴 클립을 문장 단위 데이터셋으로 만드는 편집 앱을 FaceTool 안에 구축한다. 사용자는 Premiere처럼 타임라인에서 오디오, ARKit CSV, 스크립트 문장을 함께 보며 구간을 만들고, 수정하고, 검수한 뒤 학습 가능한 `wav + csv + text + manifest` 형태로 export한다.

## 2. 현재 데이터 기준

- 입력 루트: `E:\MonoIngest_Chunked`
- 오디오: `audio/{sample_id}.wav`
- CSV: `csv/fps30/{sample_id}_none_fps30.csv`, `csv/fps60/{sample_id}_none_fps60.csv`
- 스크립트: `script_json/{sample_id}.json`
- 기본 편집 기준: `fps30`
- JSON 주요 필드:
  - `spoken_script`: 문장 단위 분할 기준 텍스트
  - `subtitle_lines`: 화면 자막 검수용
  - `performance_sequence`: 대본 없는 preset 계열

## 3. 핵심 원칙

- 원본 파일은 절대 직접 수정하지 않는다.
- 모든 편집은 segment manifest와 파생 파일로 저장한다.
- 자동 정렬 결과는 항상 사람이 고칠 수 있어야 한다.
- CSV와 WAV는 같은 시간축을 공유한다.
- segment는 학습 데이터 단위이므로 텍스트, 오디오, CSV가 반드시 1:1로 매칭되어야 한다.

## 4. 사용자 시나리오

1. 사용자가 Dataset Builder 탭을 연다.
2. 왼쪽 패널에서 `sample_id` 클립을 선택한다.
3. 앱이 WAV, fps30 CSV, script JSON을 동시에 로드한다.
4. `spoken_script`를 문장 단위로 표시한다.
5. 자동 정렬 버튼을 누르면 문장별 예상 시작/끝 시간이 생성된다.
6. 사용자는 타임라인에서 구간 경계를 드래그해 수정한다.
7. 선택한 segment를 재생하며 입 모양/오디오/텍스트를 확인한다.
8. 문제가 있으면 텍스트 또는 CSV 구간을 편집한다.
9. 승인된 segment만 export한다.

## 5. 주요 화면 구성

### 5.1 클립 브라우저

- `sample_id`, 길이, 문장 수, segment 수, 검수 상태 표시
- 필터:
  - 미정렬
  - 자동 정렬 완료
  - 수동 수정됨
  - 검수 완료
  - 오류 있음
- 검색:
  - sample_id
  - news_title
  - 문장 텍스트

### 5.2 타임라인 편집기

- 오디오 waveform 표시
- CSV 기반 jawOpen 그래프 표시
- 문장 segment 막대 표시
- 현재 재생 위치 playhead 표시
- 확대/축소:
  - 전체 보기
  - 문장 단위 확대
  - 프레임 단위 확대
- 구간 조작:
  - 시작점/끝점 드래그
  - split
  - merge
  - trim
  - delete
  - undo/redo

### 5.3 텍스트 패널

- `spoken_script`를 문장 단위로 표시
- 각 문장은 timeline segment와 연결
- 문장 클릭 시 해당 구간 선택
- segment 텍스트 수정 가능
- 문장 합치기/나누기 가능
- `subtitle_lines` 원문도 보조로 표시

### 5.4 CSV 구간 편집

- 선택 segment의 CSV 프레임 범위 표시
- 주요 채널 그래프 표시:
  - jawOpen
  - mouthClose
  - mouthFunnel
  - mouthPucker
  - mouthSmileLeft/Right
- CSV 구간 시작/끝을 오디오 구간과 별도로 미세 조정 가능
- 기본은 오디오 구간과 동일하게 잠금
- 필요 시 CSV offset 보정 지원

### 5.5 미리보기

- 선택 segment만 반복 재생
- 원본 클립 기준 재생
- segment 기준 재생
- 3D face preview
- 오디오와 CSV가 어긋나는지 확인할 수 있는 frame indicator 제공

## 6. 자동 정렬 기능

### 6.1 기본 정렬

- `spoken_script`를 문장 단위로 split한다.
- faster-whisper 또는 WhisperX로 단어 단위 timestamp를 얻는다.
- 단어 timestamp를 문장 순서에 맞춰 묶어 segment 후보를 만든다.

### 6.2 경계 보정

- 문장 경계 근처에서 아래 신호를 이용해 자동 보정한다.
  - waveform RMS 최소점
  - `jawOpen` 값이 낮은 구간
  - 최소 pause 길이
- 기본 보정 범위: ±150ms
- 보정 결과는 사용자가 되돌릴 수 있어야 한다.

### 6.3 fallback

- 정렬 실패 시 글자 수 비례로 rough segment를 생성한다.
- fallback segment는 반드시 `review_required` 상태로 표시한다.

## 7. Segment 데이터 모델

```json
{
  "segment_id": "s0005_sent003",
  "parent_sample_id": "s0005_as_mp_kling_생활건강2_1_8e0c3398",
  "sentence_index": 3,
  "text": "이 약은 원래 ADHD 증상을 완화하기 위한 치료제로...",
  "audio_start_sec": 18.42,
  "audio_end_sec": 27.91,
  "csv_start_frame": 553,
  "csv_end_frame": 837,
  "fps": 30,
  "status": "approved",
  "source": "auto_align",
  "edited": true
}
```

## 8. 저장 및 Export

### 8.1 작업 저장

- 위치: `E:\MonoIngest_Chunked_Workspace`
- 저장 파일:
  - `projects/{sample_id}.segments.json`
  - `projects/{sample_id}.history.json`

### 8.2 최종 Export

- 출력 루트: `E:\MonoIngest_Chunked_Segments`
- 출력 구조:
  - `audio/{segment_id}.wav`
  - `csv/fps30/{segment_id}.csv`
  - `text/{segment_id}.txt`
  - `manifest/segments.csv`
  - `manifest/rejected.csv`
- CSV export 시 `frame`, `time_sec`는 0부터 재번호한다.
- 원본 sample_id, 원본 frame 범위, 원본 time 범위는 manifest에 보존한다.

## 9. 상태 정의

- `draft`: 자동 생성 또는 편집 중
- `auto_aligned`: 자동 정렬 완료
- `manual_edited`: 사람이 수정함
- `review_required`: confidence 낮음 또는 fallback 사용
- `approved`: export 가능
- `rejected`: 학습 제외

## 10. 검증 규칙

자동 검증:

- segment 길이 1.0초 미만이면 경고
- segment 길이 15초 초과면 경고
- WAV 길이와 CSV 프레임 수 차이가 2프레임 이상이면 오류
- 텍스트가 비어 있으면 오류
- CSV 구간이 원본 범위를 벗어나면 오류
- segment 간 시간 범위가 겹치면 경고

수동 검증:

- 오디오와 입 모양이 맞는지 확인
- 문장 첫/끝 단어가 잘리지 않았는지 확인
- 텍스트가 실제 발화와 크게 다르지 않은지 확인

## 11. MVP 범위

### 반드시 포함

- `MonoIngest_Chunked` 자동 로드
- sample_id 기준 WAV/CSV/JSON 매칭
- 문장 리스트 표시
- segment 생성/수정/삭제
- waveform + jawOpen timeline
- segment loop playback
- fps30 CSV crop export
- manifest export
- 상태 저장

### MVP 이후

- WhisperX 정밀 align
- batch auto-align
- FaceTool 3D preview 연동
- keyboard shortcut
- multi-track CSV graph
- reviewer queue
- diff view

## 12. 권장 기술 설계

- FaceTool 내부 신규 탭: `Dataset Builder`
- 클라이언트:
  - React timeline component
  - Web Audio API waveform
  - Canvas/SVG 기반 segment editor
- Next API:
  - `/api/dataset-builder/clips`
  - `/api/dataset-builder/clip`
  - `/api/dataset-builder/align`
  - `/api/dataset-builder/save`
  - `/api/dataset-builder/export`
- Python worker:
  - whisper align
  - WAV crop
  - CSV crop
  - validation report

## 13. 성공 기준

- 78개 클립을 sample_id 기준으로 모두 로드할 수 있다.
- 한 클립에서 문장 segment를 만들고 저장할 수 있다.
- segment 경계를 드래그로 수정할 수 있다.
- 수정된 segment를 즉시 재생해 검수할 수 있다.
- 승인된 segment를 WAV + CSV + TXT로 export할 수 있다.
- export된 segment는 FaceTool에서 다시 열어 재생 가능하다.
- manifest만으로 원본 clip/time/frame을 추적할 수 있다.

## 14. 우선 구현 순서

1. 클립 로더와 매칭 검증
2. 문장 리스트 생성
3. 수동 segment editor
4. WAV/CSV crop export
5. 저장/불러오기
6. 자동 align
7. jawOpen 기반 경계 보정
8. 3D preview 통합
