# Joint Skinning 영향 분석 리포트 — Head LOD0 Lip 후보 (검증 전용)

- 작성일: 2026-06-10 / 캐릭터: `0421_V33` / 메쉬: `head_lod0_mesh` (24,049 verts)
- 산출물: `candidates/candidate_skinning_lip_vertices.json`, `candidates/candidate_jaw_region_vertices.json`
- 스크립트: `e:\Viewer\riglogic_py\export_lip_candidates_lod0.py`
- 용도: 최종 lip mask(2,738 verts) 교차 검증 전용.

## 1. 기준

- 데이터: DNA skin weights (riglogic `skin_weights(0)`, `joint_vertices.json`과 샘플 대조 완료)
- lip joint: 이름에 `lip` 포함(대소문자 무관) → **179개**
  (예: `FACIAL_C_LipUpperSkin`, `FACIAL_L_LipUpperOuterSkin`, `FACIAL_C_12IPV_LipUpperSkin1` …)
- jaw/chin joint: `FACIAL_C_Jaw|FACIAL_[LR]_Jaw|jawline|chin` → **85개**
- vertex 선정: joint 그룹 weight 합 > threshold

## 2. 결과

| Threshold | lip joint 후보 verts |
|---|---|
| w > 0.01 | 5,661 |
| **w > 0.05 (대표)** | **5,457** |
| w > 0.1 | 5,295 |

| 항목 | 값 |
|---|---|
| lip mask와 overlap_ratio | **1.000** (2,738 / 2,738) |
| precision_like | 0.502 |
| jaw/chin 후보 (w > 0.05) | 2,313 verts, lip mask와 교집합 **0** |

## 3. 해석

- **lip mask의 100%가 lip joint 스키닝 영향권**: 마스크 내 모든 vertex가 RigLogic joint 출력으로 움직인다(죽은 vertex 없음). blendshape에서 누락됐던 closure strip 64 verts도 여기서 전부 커버.
- lip joint 영향권(5,457)은 마스크의 약 2배: lip joint는 perioral 피부(입 주변 링)까지 0.05 이상 weight로 잡고 있어, **skinning weight만으로 lip을 정의하면 과포함**이 된다는 근거.
- jaw/chin joint와 교집합 0: MetaHuman 리그에서 입술 vertex는 전용 lip joint 체인이 전담하고, jaw 추종은 joint 계층(부모 변환)으로 전달된다. 즉 jaw 직접 스키닝 영역(턱/턱선)과 입술 영역이 깔끔하게 분리되어 있다 — lower_face mask 구성에 jaw 후보를 사용한 근거.

## 4. 시각화

- `candidates/candidate_skinning_preview_front.png`, `_closeup.png` (빨강 = w>0.05 후보)
