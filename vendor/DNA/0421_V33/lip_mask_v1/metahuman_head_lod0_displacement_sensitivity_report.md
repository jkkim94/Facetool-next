# Displacement 민감도 분석 리포트 — Head LOD0 Lip 후보 (검증 전용)

- 작성일: 2026-06-10 / 캐릭터: `0421_V33` / 메쉬: `head_lod0_mesh` (24,049 verts)
- 산출물: `candidates/candidate_displacement_lip_vertices.json`
- 스크립트: `e:\Viewer\riglogic_py\export_lip_candidates_lod0.py` (FaceModel = RigLogic 전체 파이프라인: controls → blendshape + joint → LBS)
- 용도: 최종 lip mask(2,738 verts) 교차 검증 전용. **단일 컨트롤 displacement는 마스크 정의에 사용하지 않음**(Rejection Criteria).

## 1. 기준

- 방법: 중립 대비 raw 컨트롤 1개를 1.0으로 설정 → 최종 vertex displacement **> 0.02 cm**
- 컨트롤 그룹 (UE 5.6 raw control 네이밍으로 매핑, 요구사항 5.2의 ARKit식 이름 대응):

| 그룹 | 컨트롤 수 | 예 |
|---|---|---|
| lip_core | 42 | mouthLipsTogether*, mouthFunnel*, mouthLipsPurse*, mouth{Upper,Lower}LipRoll{In,Out}*, mouthLipsPush/Pull*, mouthPress*, mouthUpperLipRaise*, mouthLowerLipDepress*, mouthLipsTowards* |
| mouth_region | 24 | mouthCornerPull*, mouthCornerDepress*, mouthDimple*, mouthStretch*, mouthCorner{Up,Down,Wide,Narrow}*, mouthLeft/Right/Up/Down |
| jaw | 6 | jawOpen, jawLeft, jawRight, jawFwd, jawBack, jawOpenExtreme |

- repeated 셋: lip_core 42개 중 **21개 이상**(50%)에서 동시 반응

## 2. 결과

| 항목 | 값 |
|---|---|
| lip_core union | **9,956 verts** |
| lip_core repeated (≥21 컨트롤) | 1,362 verts |
| mouth_region union | 11,672 verts |
| jaw union | 16,707 verts |
| lip mask와 overlap_ratio (union) | **1.000** |
| lip mask와 overlap_ratio (repeated) | 0.400 |
| precision_like (repeated) | **0.804** |

## 3. 해석

- **마스크 100%가 lip-core 컨트롤 반응 영역**: 발화 시 입술을 움직이는 모든 핵심 컨트롤이 마스크 vertex를 실제로 변형시킨다 → LVE 측정 대상으로 유효.
- repeated 코어(1,362)의 80.4%가 마스크 내부: 다수 컨트롤이 공통으로 움직이는 "입술 코어"가 마스크 중심부와 일치. repeated가 마스크의 40%만 덮는 것은 정상 — corner/외곽 vermilion은 일부 컨트롤에만 반응하기 때문이며, 이것이 displacement 빈도 기반 정의(과거 MH-LVR-v1)의 한계(코어 편향)다.
- union(9,956)은 마스크의 3.6배: lip-core 컨트롤은 perioral·볼·턱 피부까지 움직이므로 **displacement 반응만으로 lip을 정의하면 과포함**. 기존 `lip_vertices_mhlvr_v1.json`(LOD1, 8,285 verts)이 기각된 이유와 동일.
- jaw union(16,707)은 얼굴 하반 전체에 걸침 → lower_face mask(6,228)의 소스로 사용(코 아래/턱 바닥 트림 적용).

## 4. 시각화

- `candidates/candidate_displacement_preview_front.png`, `_closeup.png` (빨강 = lip_core union)

## 5. 비고

- perturbation 평가는 `face_model.py`의 FaceModel로 수행 — bake.py와 동일한 수식(RigLogic calculate → blendshape 적용 → LBS)이므로 UE 런타임과 동일한 변형 경로다.
- threshold 0.02 cm 민감도: 0.01로 낮추면 union이 노이즈성 미세 변형까지 포함해 약 1.5~2배 커지고, 0.05면 corner 응답이 일부 빠진다. 검증 목적에는 0.02가 적절.
