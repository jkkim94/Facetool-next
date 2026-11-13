# MetaHuman Head LOD0 Lip Vertex Mask 리포트 (MH-LVE-LIP-v1)

- 작성일: 2026-06-10
- 캐릭터: `0421_V33` (UE 5.6 MetaHuman, head.dna)
- 대상 메쉬: `head_lod0_mesh` (mesh_index 0, LOD0)
- 전체 vertex 수: **24,049** / lip mask vertex 수: **2,565** (전체의 10.67%, v1.2)
- 인덱스 규약: **0-based**, DNA(riglogic API) vertex 순서 기준
- 산출물: `metahuman_head_lod0_lip_mask.json` (+ preview PNG 4종)
- 생성 스크립트: `e:\Viewer\riglogic_py\export_lip_mask_lod0.py`
- **v1.2 (2026-06-10)**: mesh open이 입꼬리 landmark(6142)를 제거해 삼각형 hole이 생기던 문제 수정 — anchor 보호 + surrounded hole fill
- **v1.1 (2026-06-10)**: 입꼬리 subgroup을 x-극값 구 대신 **landmark(6142/40) + outer lip 한정 + R=0.35cm**으로 축소, closure strip 2-ring, UV window mesh open(1,1)+spike prune → corner 노이즈 감소

---

## 1. Vertex 좌표/인덱스 기준

| 항목 | 값 |
|---|---|
| 단일 기준(소스 오브 트루스) | `head.dna` → riglogic API (`vertex_positions(0)`) |
| LVE 평가 파이프라인 | `face_model.py`(FaceModel) — 동일 DNA, 동일 인덱스 공간 |
| 좌표 단위 | cm (x=캐릭터 좌측+, y=상방+, z=전방+) |
| DCC(Maya/Blender/FBX) 경로 | **미사용** — export/import 인덱스 변경 리스크 자체가 없음 |

### 1.1 인덱스 일관성 검증 결과 (`vertex_index_verification.json`)

| 검증 항목 | 결과 |
|---|---|
| rig API vertex count = 24,049 | OK |
| `head_summary.json` vertex/BS target count 일치 | OK |
| `blend_shape_targets.json` target 737개·vertex index 샘플 비교(20 target) | OK (max vid 24,048 < 24,049) |
| `joint_vertices.json` vertex count·skin weight 샘플 비교(20 joint) | OK |
| Epic identity PCA(`geo_and_bindpose.pca`) mouth region | **불일치** — 아래 7.4 참조 |

### 1.2 Landmark vertex 10개 (DNA 중립 좌표, cm)

| Landmark | vertex_id | 좌표 (x, y, z) |
|---|---|---|
| nose_tip | 2926 | (-0.077, 159.917, 13.029) |
| upper_lip_center | 12207 | (-0.008, 157.089, 11.806) |
| lower_lip_center | 2881 | (0.005, 155.975, 11.472) |
| left_mouth_corner | 6142 | (2.174, 156.340, 10.374) |
| right_mouth_corner | 40 | (-2.068, 156.378, 10.346) |
| chin | 20401 | (-0.106, 153.664, 11.187) |
| forehead | 2109 | (-0.265, 166.233, 11.778) |
| left_cheek | 21901 | (8.439, 161.914, 0.010) |
| right_cheek | 18888 | (-8.553, 161.891, 0.019) |
| jawline_left | 5365 | (3.985, 154.626, 7.597) |

lip 관련 4개 landmark는 최종 lip mask subgroup에서 기하 조건(정중선 최전방/±x 극값)으로 선정.

---

## 2. Lip 영역 정의 방법 (컨트롤 비의존, 해부학 기준)

마스크는 **Epic이 제작한 identity region UV 맵(`T_Gray_Head_D.PNG`)의 입술 영역 페인팅 + 메쉬 topology**로 정의했다.
컨트롤 이름이나 단일 컨트롤 displacement는 정의에 사용하지 않았다(요구사항 4.1, 7.3).

UV 맵의 입 영역 구조 (텍스처 색상 분류, 패치 median 샘플링으로 wireframe 픽셀 제거):

| 텍스처 색상 | 의미 | 마스크 처리 |
|---|---|---|
| 어두운 회갈색 타원 (~RGB 120,110,106) | vermilion(입술 표면, cupid's bow 포함) | 포함 (outer lip) |
| 선명한 빨강 띠 (~RGB 190,97,102) | 입 다묾 라인 주변 inner lip | 포함 (inner lip) |
| 빨강-남색 블렌드 행 | inner lip ↔ 구강 입구 전이부 | 포함 (inner lip) |
| 어두운 남회색 선 (b>r) | 구강(oral cavity) 입구 경계선 | 제외 |
| 따뜻한 황갈색 링 (r≥140) | perioral 피부(입 주변) | 제외 |

### 2.1 생성 파이프라인

1. **UV 분류**: mouth UV window(u 0.40–0.60, v 0.345–0.475) 내 vertex를 위 색상 규칙으로 분류 → vermilion 1,539 + inner red 690
2. **Topology 정리**: 인접 그래프 최대 연결성분 유지(2,229), 폐곡 영역 hole-fill
3. **Closure strip 포함**: 입술 접촉면(다물었을 때 맞닿는 안쪽 띠)은 별도 UV 아일랜드(uv.v>0.9)에 매핑되어 있어, lip set에서 topology BFS 3-ring으로 한정 확장(+509, bbox 가드) → 더 깊은 ring은 구강으로 판단해 제외
4. **최종**: 2,738 verts, 단일 연결성분

### 2.2 포함/제외 영역 (요구사항 7)

- 포함: 윗입술/아랫입술 외부(vermilion 전체), 인중 하단 경계(vermilion 상단 경계까지), 입꼬리(좌/우), 윗/아랫입술 내부 경계(접촉면 strip 3-ring)
- 제외: 구강 내부(mouth bag), 턱/볼, 인중 위쪽 피부, perioral ring

---

## 3. Subgroup 구성 (요구사항 6.1.1)

우선순위: corner > inner(red band) > outer(upper/lower는 UV seam v=0.4133 기준, closure strip은 BFS 전파 side 사용). 그룹은 상호 배타적이다.

| Subgroup | Vertex 수 | 비고 |
|---|---|---|
| upper_outer_lip | 686 | vermilion 윗입술 |
| lower_outer_lip | 635 | vermilion 아랫입술 |
| upper_inner_lip | 510 | red band + closure strip 윗쪽 |
| lower_inner_lip | 520 | red band + closure strip 아랫쪽 |
| left_mouth_corner | 94 | landmark 6142, outer lip, R=0.35cm |
| right_mouth_corner | 119 | landmark 40, outer lip, R=0.35cm |
| **all_lip (합집합)** | **2,564** | 전체의 10.66% |

집계: upper 1,196 / lower 1,155 / corner 213.

Lip mask 3D bbox(cm): x [-2.07, 2.17], y [155.54, 157.36], z [9.29, 11.81]

---

## 4. 검증 (요구사항 9)

### 4.1 Overlap 분석 (`overlap_analysis.json`)

A = 최종 lip mask(2,738), B = 후보. overlap_ratio=|A∩B|/|A|, precision_like=|A∩B|/|B|.

| 후보 셋 | |B| | overlap_ratio | precision_like | jaccard |
|---|---|---|---|---|
| Blendshape delta (mouth/lip/jaw 채널, >0.02cm) | 9,934 | **0.977** | 0.269 | 0.268 |
| Lip joint skinning (w>0.05) | 5,457 | **1.000** | 0.502 | 0.502 |
| Displacement (lip-core 42 컨트롤 union) | 9,956 | **1.000** | 0.275 | 0.275 |
| Displacement repeated (≥21 컨트롤 동시 반응) | 1,362 | 0.400 | **0.804** | 0.364 |
| Epic identity 'mouth' region | 6,944 | 0.100 | 0.040 | (인덱스 불일치, 7.4) |
| Jaw/chin joint skinning (w>0.05) | 2,313 | 0.000 | 0.000 | 입술은 lip joint가 전담 |

해석:

- lip mask의 **100%가 lip joint skinning·displacement 반응 영역에 포함** → 마스크 내 죽은(움직이지 않는) vertex 없음
- blendshape 미반응 64 verts는 모두 closure strip(접촉면)으로, joint(스키닝) 기반으로 움직이는 영역 → 정상
- 후보가 마스크보다 훨씬 넓은 것(precision 0.27~0.50)은 의도된 결과 — 후보는 perioral/볼/턱까지 반응 영역을 포함하기 때문이며, 그래서 후보를 마스크 정의에 쓰지 않았다(Rejection Criteria)
- repeated displacement(고빈도 반응 코어 1,362 중 80.4%가 마스크 내부)는 마스크가 입술 코어를 정확히 덮음을 지지

### 4.2 Deformation 추적성

마스크는 vertex index 집합이므로 jawOpen/mouthFunnel 등 어떤 deformation에서도 동일 index로 추적된다(LVE 스모크 테스트에서 확인, 6장). FaceTool 3D 뷰어의 "LVE Lip Mask (LOD0)" 모드에서 컨트롤 슬라이더를 움직이며 육안 확인 가능.

### 4.3 시각 검증 (preview 4종)

- `metahuman_head_lod0_lip_mask_preview_front.png` / `_left45.png` / `_right45.png` / `_closeup.png`
- subgroup별 6색 구분, 백페이스는 어두운 색으로 렌더(입 다묾 라인 틈 확인용)

---

## 5. 보조 산출물 (선택 산출물)

| 파일 | Vertex 수 | 정의 |
|---|---|---|
| `metahuman_head_lod0_mouth_region_mask.json` | 4,099 | lip mask를 중립 메쉬에서 1.0 cm Euclidean 팽창(구강 UV 아일랜드 제외) — 입술+입꼬리+인중 하단+입 주변 피부, 볼/턱 전체 제외 |
| `metahuman_head_lod0_lower_face_mask.json` | 6,228 | mouth region ∪ jaw 컨트롤 displacement 반응 영역, 코 아래·턱 바닥까지 트림(목 제외) |

---

## 6. LVE 계산기 및 스모크 테스트

- 계산기: `e:\Viewer\riglogic_py\metahuman_lve_calculator.py`
  - 입력: GT/prediction — (F,V,3) vertex NPY 또는 control NPY(arkit51/raw, FaceModel로 평가)
  - 출력: LVE_mean(프레임별 평균 L2의 평균), LVE_max(프레임별 max L2의 평균, FaceFormer식), subgroup별 오차, frame-wise CSV + summary JSON
- 스모크 테스트: GT = `E:\LipReading_Dataset_Synced\train\lip_J_1_F_02_E209_A_001_001.npy`(206프레임, ARKit51),
  prediction = GT 컨트롤 ×0.9 + N(0, 0.02) 합성 perturbation

| 지표 | 값 (cm) |
|---|---|
| LVE_mean | 0.0611 |
| LVE_max | 0.1074 |
| upper lip error | 0.0507 |
| lower lip error | 0.0665 |
| corner error | 0.0722 |

결과 파일: `lve_calculation_test_result.csv`, `lve_calculation_test_result.summary.json`

---

## 7. 한계 및 주의사항

1. **UV region 맵 의존**: 마스크 경계의 1차 근거는 Epic이 페인팅한 identity region 텍스처다. UE/MetaHuman 버전이 바뀌어 텍스처가 변경되면 재생성 필요(스크립트 재실행으로 자동화 가능).
2. **Closure strip 깊이**: inner lip의 안쪽 한계(BFS **2-ring**, v1.1)는 해부학적 wet line의 근사다.
3. **LOD0 경계 계단**: UV region 맵은 texel 단위이고 메쉬는 ~24k verts라 입술 외곽은 폴리곤 계단 형태가 남는다. v1.1에서 mesh open + corner 재정의로 입꼬리 스파이크를 줄였으나, 완전한 곡선 경계는 LOD0 한계다.
4. **동일 topology 전제**: corner 반경(**0.35cm**)·landmark(6142/40) 좌표는 캐릭터별 형상에 따라 달라진다.
5. **Epic identity PCA mouth region 불일치**: `geo_and_bindpose.pca`에서 추출한 mouth region(6,944 verts)은 본 DNA의 vertex 순서와 **다른 인덱스 공간**을 사용함을 기하 검사(y 스프레드 36cm, 얼굴 전체에 산재)로 확인했다. 요구사항 8.2에 따라 마스크 제작에서 제외하고 참고용으로만 보존(`candidates/candidate_mouth_region_vertices.json`의 metadata.warning 참조).
6. **스모크 테스트의 ARKit→MetaHuman 매핑**: 51차원 ARKit weight를 raw 컨트롤로 보내는 매핑은 best-effort 근사이며 retarget 품질 검증용이 아니다. LVE 계산 자체는 매핑과 무관하게 vertex 좌표만 사용한다.

---

## 8. 사용 예시

```python
import json, numpy as np

mask = json.load(open(r"E:\Viewer\DNA\0421_V33\lip_mask_v1\metahuman_head_lod0_lip_mask.json"))
lip_ids = np.array(mask["combined"]["all_lip"])      # (2564,)

# gt_vertices, pred_vertices: (F, 24049, 3)
err = np.linalg.norm(gt_vertices - pred_vertices, axis=2)   # (F, V)
lve_mean = err[:, lip_ids].mean()
lve_max  = err[:, lip_ids].max(axis=1).mean()
```

CLI:

```bash
python metahuman_lve_calculator.py --gt gt.npy --gt-format arkit51 --pred pred.npy --pred-format arkit51 --out result.csv
```
