# Blendshape 영향 분석 리포트 — Head LOD0 Lip 후보 (검증 전용)

- 작성일: 2026-06-10 / 캐릭터: `0421_V33` / 메쉬: `head_lod0_mesh` (24,049 verts)
- 산출물: `candidates/candidate_blendshape_lip_vertices.json`
- 스크립트: `e:\Viewer\riglogic_py\export_lip_candidates_lod0.py`
- 용도: 최종 lip mask(MH-LVE-LIP-v1, 2,738 verts)의 **교차 검증 전용**. 마스크 정의에는 사용하지 않음.

## 1. 기준

- 데이터: DNA `blend_shape_targets` (riglogic API, head_lod0_mesh 737 target)
- 채널 필터: 이름에 `mouth|jaw|lip` 포함(`throat|neck` 제외) → **263 채널**
- vertex 선정: 채널 delta magnitude **> 0.02 cm**
- repeated 셋: **26개 이상** 채널(전체의 10%)에서 동시에 반응하는 vertex

## 2. 결과

| 항목 | 값 |
|---|---|
| union (1개 채널 이상 반응) | **9,934 verts** |
| repeated (≥26 채널) | 214 verts |
| lip mask와 overlap_ratio | 0.977 (2,674 / 2,738) |
| precision_like | 0.269 |

### 채널별 반응 vertex 수 상위

| 채널 | verts |
|---|---|
| mouth_right | 2,652 |
| mouth_left | 2,562 |
| jaw_open | 2,489 |
| jaw_fwd | 2,418 |
| jaw_left | 1,648 |
| McornerPull_Mstretch_MlowerLipDepress_JopenExtreme_L | 1,514 |
| MupperLipRaise_MlowerLipDepress_JopenExtreme_R | 1,474 |
| mouth_cornerPull_left/right | 1,239 |

## 3. 해석

- lip mask의 97.7%가 mouth/lip/jaw blendshape의 영향권에 포함 → 마스크가 발화 articulator 영역임을 지지.
- 미포함 64 verts는 모두 **closure strip(입술 접촉면)**: 이 영역은 corrective blendshape이 아닌 joint 스키닝으로 구동되며, skinning 후보에서는 100% 커버됨 → 죽은 vertex 아님.
- union이 마스크 대비 3.6배 넓은 이유: mouth/jaw blendshape은 볼·인중·턱 피부까지 변형시키기 때문. **blendshape 반응만으로 lip을 정의하면 과포함**(Rejection Criteria 위반)이 되는 근거.

## 4. 시각화

- `candidates/candidate_blendshape_preview_front.png`, `_closeup.png` (빨강 = 후보 union)
- lip mask subgroup preview와 비교: `../metahuman_head_lod0_lip_mask_preview_closeup.png`
