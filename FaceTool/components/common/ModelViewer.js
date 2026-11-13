'use client';

import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// 투명 배경 설정 컴포넌트
export function TransparentBackground() {
  const { gl } = useThree();
  useEffect(() => {
    gl.setClearColor(0x000000, 0); // 완전 투명 배경
  }, [gl]);
  return null;
}

// 로드리게스 회전 벡터를 오일러 각도로 변환하는 함수
function rodriguesToEuler(rodriguesVec) {
  // 로드리게스 벡터: [x, y, z]
  const [rx, ry, rz] = rodriguesVec;
  const theta = Math.sqrt(rx * rx + ry * ry + rz * rz);
  
  if (theta < 1e-6) {
    // 회전이 거의 없으면 0 반환
    return new THREE.Euler(0, 0, 0);
  }
  
  // 회전축 정규화
  const axis = new THREE.Vector3(rx / theta, ry / theta, rz / theta);
  
  // 쿼터니언으로 변환
  const quaternion = new THREE.Quaternion();
  quaternion.setFromAxisAngle(axis, theta);
  
  // 오일러 각도로 변환
  const euler = new THREE.Euler();
  euler.setFromQuaternion(quaternion);
  
  return euler;
}

export function Model({ glbPath, blendshapeData, blendshapeNames, viewerId, isFlameModel = false, showWireframe = false, position = [0, 0, 0], scale = 1, rotation = [0, 0, 0] }) {
  // GLB는 경로 기준 1회 로드 후 viewerId별로 clone(true)로 독립 인스턴스 사용
  // (?viewer= 쿼리 URL은 2번째 Canvas에서 로드 실패하는 경우가 있어 사용하지 않음)
  const { scene: originalScene } = useGLTF(glbPath);
  const groupRef = useRef(null);
  const meshRef = useRef(null);
  const currentBlendshapeDataRef = useRef(null);
  const clonedSceneRef = useRef(null);
  const errorRef = useRef(null);
  // 각 뷰어마다 독립적인 bone 참조를 위해 viewerId를 키로 사용
  const boneRefs = useRef({}); // Bone 참조 저장: { [viewerId]: { jaw, left_eye, right_eye } }
  const skeletonRef = useRef(null);
  const jawBoneRef = useRef(null);
  const leftEyeBoneRef = useRef(null);
  const rightEyeBoneRef = useRef(null);
  const initialBoneRotations = useRef({}); // 초기 bone rotation 저장: { [viewerId]: { jaw, left_eye, right_eye } }
  
  // 뷰어별 bone 참조 키
  const boneRefsKey = `viewer-${viewerId}`;

  // 씬을 클론하여 완전히 독립적인 인스턴스 생성
  useEffect(() => {
    if (!originalScene) {
      // 씬이 로드되지 않았으면 에러 체크
      if (glbPath) {
        console.warn(`[뷰어 ${viewerId}] GLB 씬이 아직 로드되지 않았습니다. 경로:`, glbPath);
      }
      return;
    }
    
    // 에러 리셋
    errorRef.current = null;

    // 기존 클론이 있으면 제거
    if (clonedSceneRef.current) {
      clonedSceneRef.current.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(mat => mat.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    }

    // 씬을 깊은 복사하여 완전히 독립적인 인스턴스 생성
    clonedSceneRef.current = originalScene.clone(true);
    
    // 클론된 씬에서 메시 찾기
    clonedSceneRef.current.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
        if (object.morphTargetInfluences) {
          meshRef.current = object;
          console.log(`[뷰어 ${viewerId}] 메시 찾음:`, object.name || 'unnamed');
          console.log(`[뷰어 ${viewerId}] morphTargetInfluences 개수:`, object.morphTargetInfluences.length);
          console.log(`[뷰어 ${viewerId}] morphTargetDictionary:`, object.morphTargetDictionary);
          if (object.morphTargetDictionary) {
            const dictKeys = Object.keys(object.morphTargetDictionary);
            console.log(`[뷰어 ${viewerId}] 사용 가능한 블렌드쉐입 개수:`, dictKeys.length);
            console.log(`[뷰어 ${viewerId}] 처음 10개 블렌드쉐입:`, dictKeys.slice(0, 10));
            if (isFlameModel) {
              // FLAME 모델인 경우 Exp로 시작하는 것들만 표시
              const expKeys = dictKeys.filter(k => k.startsWith('Exp') || k.startsWith('exp'));
              console.log(`[뷰어 ${viewerId}] Expression morph targets (Exp*):`, expKeys.slice(0, 10));
            }
          }
          
          // Bone 정보 출력 및 참조 저장 (뷰어 2, 4인 경우, FLAME 모델)
          if ((viewerId === 'model-2' || viewerId === 'model-4') && isFlameModel && object instanceof THREE.SkinnedMesh) {
            if (object.skeleton) {
              skeletonRef.current = object.skeleton;
              const bones = object.skeleton.bones;
              console.log(`[뷰어 ${viewerId}] ========== BONE LIST ==========`);
              console.log(`[뷰어 ${viewerId}] 총 Bone 개수:`, bones.length);
              
              // Bone 트리 구조 출력
              const printBoneTree = (bone, depth = 0) => {
                const indent = '  '.repeat(depth);
                console.log(`${indent}${bone.name || 'unnamed'} (index: ${bone.userData.index || 'N/A'})`);
                bone.children.forEach(child => {
                  if (child instanceof THREE.Bone) {
                    printBoneTree(child, depth + 1);
                  }
                });
              };
              
              // Root bone 찾기
              const rootBones = bones.filter(bone => !bone.parent || !(bone.parent instanceof THREE.Bone));
              if (rootBones.length > 0) {
                console.log(`[뷰어 ${viewerId}] Bone 트리 구조:`);
                rootBones.forEach(rootBone => printBoneTree(rootBone));
              } else {
                // Root bone이 없으면 모든 bone 나열
                console.log(`[뷰어 ${viewerId}] 모든 Bone 목록:`);
                bones.forEach((bone, index) => {
                  console.log(`  [${index}] ${bone.name || 'unnamed'}`, {
                    parent: bone.parent?.name || 'none',
                    position: bone.position,
                    rotation: bone.rotation,
                    scale: bone.scale
                  });
                });
              }
              
              // Bone 이름만 리스트로 출력
              const boneNames = bones.map(bone => bone.name || 'unnamed');
              console.log(`[뷰어 ${viewerId}] Bone 이름 리스트:`, boneNames);
              
              // jaw, left_eye, right_eye bone 찾기
              const jawBone = bones.find(bone => 
                bone.name && (bone.name.toLowerCase() === 'jaw' || bone.name.toLowerCase().includes('jaw'))
              );
              const leftEyeBone = bones.find(bone => 
                bone.name && (bone.name.toLowerCase() === 'left_eye' || 
                              bone.name.toLowerCase().includes('left_eye') ||
                              bone.name.toLowerCase() === 'lefteye' ||
                              bone.name.toLowerCase().includes('lefteye'))
              );
              const rightEyeBone = bones.find(bone => 
                bone.name && (bone.name.toLowerCase() === 'right_eye' || 
                              bone.name.toLowerCase().includes('right_eye') ||
                              bone.name.toLowerCase() === 'righteye' ||
                              bone.name.toLowerCase().includes('righteye'))
              );
              
              // 뷰어별로 독립적인 bone 참조 저장
              if (!boneRefs.current[boneRefsKey]) {
                boneRefs.current[boneRefsKey] = {};
              }
              boneRefs.current[boneRefsKey].jaw = jawBone;
              boneRefs.current[boneRefsKey].left_eye = leftEyeBone;
              boneRefs.current[boneRefsKey].right_eye = rightEyeBone;
              
              // 초기 rotation 저장 (뷰어별로)
              if (!initialBoneRotations.current[boneRefsKey]) {
                initialBoneRotations.current[boneRefsKey] = {};
              }
              if (jawBone) {
                initialBoneRotations.current[boneRefsKey].jaw = {
                  x: jawBone.rotation.x,
                  y: jawBone.rotation.y,
                  z: jawBone.rotation.z
                };
              }
              if (leftEyeBone) {
                initialBoneRotations.current[boneRefsKey].left_eye = {
                  x: leftEyeBone.rotation.x,
                  y: leftEyeBone.rotation.y,
                  z: leftEyeBone.rotation.z
                };
              }
              if (rightEyeBone) {
                initialBoneRotations.current[boneRefsKey].right_eye = {
                  x: rightEyeBone.rotation.x,
                  y: rightEyeBone.rotation.y,
                  z: rightEyeBone.rotation.z
                };
              }
              
              console.log(`[뷰어 ${viewerId}] Bone 참조:`, {
                jaw: boneRefs.current[boneRefsKey]?.jaw?.name || 'not found',
                leftEye: boneRefs.current[boneRefsKey]?.left_eye?.name || 'not found',
                rightEye: boneRefs.current[boneRefsKey]?.right_eye?.name || 'not found'
              });
              
              if (boneRefs.current[boneRefsKey]?.jaw) {
                console.log(`[뷰어 ${viewerId}] Jaw bone 상세 정보:`, {
                  name: boneRefs.current[boneRefsKey].jaw.name,
                  position: boneRefs.current[boneRefsKey].jaw.position.toArray(),
                  rotation: boneRefs.current[boneRefsKey].jaw.rotation.toArray(),
                  rotationOrder: boneRefs.current[boneRefsKey].jaw.rotation.order,
                  quaternion: boneRefs.current[boneRefsKey].jaw.quaternion.toArray(),
                  parent: boneRefs.current[boneRefsKey].jaw.parent?.name || 'none',
                  initialRotation: initialBoneRotations.current[boneRefsKey].jaw
                });
              }
              console.log(`[뷰어 ${viewerId}] ===============================`);
            } else {
              console.log(`[뷰어 ${viewerId}] Skeleton이 없습니다.`);
            }
          }
        }
      }
    });

    // 클린업 함수
    return () => {
      if (clonedSceneRef.current) {
        clonedSceneRef.current.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(mat => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        });
        clonedSceneRef.current = null;
      }
    };
  }, [originalScene, viewerId]);

  // 블렌드쉐입 데이터 업데이트
  useEffect(() => {
    currentBlendshapeDataRef.current = blendshapeData;
  }, [blendshapeData]);

  // Wireframe 모드 업데이트
  useEffect(() => {
    if (!clonedSceneRef.current) return;
    
    clonedSceneRef.current.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(mat => {
              if (mat) mat.wireframe = showWireframe;
            });
          } else {
            object.material.wireframe = showWireframe;
          }
        }
      }
    });
  }, [showWireframe]);

  // 매 프레임마다 블렌드쉐입 적용 (부드러운 애니메이션)
  useFrame(() => {
    const blendshapeData = currentBlendshapeDataRef.current;
    if (!blendshapeData || !meshRef.current) {
      return;
    }
    
    // 디버깅 로그 제거됨 - 이벤트 로그만 사용
    // FLAME 파라미터 데이터 로그 제거됨

    const mesh = meshRef.current;
    if (!mesh.morphTargetInfluences) return;

    // FLAME 모델인 경우 특별 처리
    if (isFlameModel) {
      // FLAME expression 파라미터만 morph targets로 적용 (exp_000 ~ exp_099)
      // CSV 형식: exp_000, exp_001, ... exp_099
      // GLB 형식: Exp1, Exp2, ... Exp100
      const expressionNames = blendshapeNames.filter(name => name.startsWith('exp_'));
      
      if (mesh.morphTargetDictionary) {
        let matchedCount = 0;
        let appliedCount = 0;
        
        expressionNames.forEach((name) => {
          // CSV의 exp_000 형식을 GLB의 Exp1 형식으로 변환
          // exp_000 -> Exp1, exp_001 -> Exp2, ..., exp_099 -> Exp100
          let glbName = null;
          if (name.startsWith('exp_')) {
            const expNum = parseInt(name.replace('exp_', ''), 10);
            if (!isNaN(expNum) && expNum >= 0 && expNum <= 99) {
              // exp_000 (0) -> Exp1, exp_001 (1) -> Exp2, ...
              glbName = `Exp${expNum + 1}`;
            }
          }
          
          if (!glbName) return;
          
          // GLB morph target 이름으로 매칭
          let index = mesh.morphTargetDictionary[glbName];
          
          // 정확한 이름이 없으면 부분 매칭 시도
          if (index === undefined) {
            const lowerGlbName = glbName.toLowerCase();
            for (const [key, idx] of Object.entries(mesh.morphTargetDictionary)) {
              const lowerKey = key.toLowerCase();
              if (lowerKey === lowerGlbName || 
                  lowerKey.includes(lowerGlbName) ||
                  lowerGlbName.includes(lowerKey)) {
                index = idx;
                break;
              }
            }
          }
          
          if (index !== undefined && index < mesh.morphTargetInfluences.length) {
            const value = blendshapeData[name] || 0;
            
            // FLAME 파라미터는 원래 값 그대로 사용 (정규화하지 않음, 제한 없음)
            // morphTargetInfluences는 일반적으로 0~1 범위이지만, FLAME 모델은 음수 값과 1 이상의 값도 처리 가능
            // 제한 없이 원래 값을 그대로 사용
            mesh.morphTargetInfluences[index] = value;
            matchedCount++;
            
            // 값이 0이 아닌 경우만 카운트
            if (Math.abs(value) > 0.01) {
              appliedCount++;
            }
          }
        });
        
        // Pose 파라미터 처리 (jaw, eye) - 라디안 단위의 오일러 각도를 bone rotation에 적용
        // CSV: jaw_x, jaw_y, jaw_z, eye_left_x, eye_left_y, eye_left_z, eye_right_x, eye_right_y, eye_right_z
        // 이 값들은 라디안 단위의 회전 각도 (yaw, pitch, roll)이므로 직접 bone rotation에 적용
        // 일반적인 범위: -0.5 ~ +0.5 라디안 (약 -30도 ~ +30도)
        
        // 뷰어별 bone 참조 가져오기
        const viewerBoneRefs = boneRefs.current[boneRefsKey] || {};
        const viewerInitialRotations = initialBoneRotations.current[boneRefsKey] || {};
        
        // Jaw bone rotation 적용 (yaw, pitch, roll)
        if (viewerBoneRefs.jaw && blendshapeNames.includes('jaw_x') && blendshapeNames.includes('jaw_y') && blendshapeNames.includes('jaw_z')) {
          const jawX = blendshapeData['jaw_x'] || 0; // yaw
          const jawY = blendshapeData['jaw_y'] || 0; // pitch
          const jawZ = blendshapeData['jaw_z'] || 0; // roll
          
          // 디버깅 로그 제거됨 - 이벤트 로그만 사용
          
          const jawBone = viewerBoneRefs.jaw;
          
          // Quaternion 사용 (더 안정적일 수 있음)
          // CSV 값으로 직접 euler 생성 후 quaternion으로 변환
          const newEuler = new THREE.Euler(jawX, jawY, jawZ, 'XYZ');
          const newQuat = new THREE.Quaternion().setFromEuler(newEuler);
          
          // Quaternion을 bone에 직접 적용 (초기값 무시)
          jawBone.quaternion.copy(newQuat);
          
          // 또는 초기 rotation에 상대적으로 적용하려면:
          // const initialRot = initialBoneRotations.current.jaw || { x: 0, y: 0, z: 0 };
          // const initialEuler = new THREE.Euler(initialRot.x, initialRot.y, initialRot.z, 'XYZ');
          // const initialQuat = new THREE.Quaternion().setFromEuler(initialEuler);
          // const finalQuat = initialQuat.clone().multiply(newQuat);
          // jawBone.quaternion.copy(finalQuat);
          
          // Skeleton 업데이트 (스키닝이 제대로 작동하려면 필요)
          if (mesh.skeleton) {
            // 모든 bone의 matrix를 업데이트
            mesh.skeleton.update();
            
            // 추가로 bone의 matrix를 직접 업데이트
            jawBone.updateMatrixWorld(true);
          }
        } else if (!viewerBoneRefs.jaw && (viewerId === 'model-2' || viewerId === 'model-4')) {
          // Bone을 찾지 못한 경우 경고 (한 번만)
          if (!meshRef.current._jawBoneNotFound) {
            console.warn(`[뷰어 ${viewerId}] Jaw bone을 찾을 수 없습니다.`);
            console.warn(`[뷰어 ${viewerId}] 사용 가능한 bone 이름:`, 
              mesh.skeleton?.bones?.map(b => b.name).filter(Boolean) || []
            );
            meshRef.current._jawBoneNotFound = true;
          }
        }
        
        // Left eye bone rotation 적용 (Quaternion 사용)
        if (viewerBoneRefs.left_eye && blendshapeNames.includes('eye_left_x') && blendshapeNames.includes('eye_left_y') && blendshapeNames.includes('eye_left_z')) {
          const eyeX = blendshapeData['eye_left_x'] || 0;
          const eyeY = blendshapeData['eye_left_y'] || 0;
          const eyeZ = blendshapeData['eye_left_z'] || 0;
          
          const eyeBone = viewerBoneRefs.left_eye;
          const initialRot = viewerInitialRotations.left_eye || { x: 0, y: 0, z: 0 };
          const initialEuler = new THREE.Euler(initialRot.x, initialRot.y, initialRot.z, 'XYZ');
          const initialQuat = new THREE.Quaternion().setFromEuler(initialEuler);
          
          const newEuler = new THREE.Euler(eyeX, eyeY, eyeZ, 'XYZ');
          const newQuat = new THREE.Quaternion().setFromEuler(newEuler);
          const finalQuat = initialQuat.clone().multiply(newQuat);
          
          eyeBone.quaternion.copy(finalQuat);
          
          // Skeleton 업데이트
          if (mesh.skeleton) {
            mesh.skeleton.update();
            eyeBone.updateMatrixWorld(true);
          }
        }
        
        // Right eye bone rotation 적용 (Quaternion 사용)
        if (viewerBoneRefs.right_eye && blendshapeNames.includes('eye_right_x') && blendshapeNames.includes('eye_right_y') && blendshapeNames.includes('eye_right_z')) {
          const eyeX = blendshapeData['eye_right_x'] || 0;
          const eyeY = blendshapeData['eye_right_y'] || 0;
          const eyeZ = blendshapeData['eye_right_z'] || 0;
          
          const eyeBone = viewerBoneRefs.right_eye;
          const initialRot = viewerInitialRotations.right_eye || { x: 0, y: 0, z: 0 };
          const initialEuler = new THREE.Euler(initialRot.x, initialRot.y, initialRot.z, 'XYZ');
          const initialQuat = new THREE.Quaternion().setFromEuler(initialEuler);
          
          const newEuler = new THREE.Euler(eyeX, eyeY, eyeZ, 'XYZ');
          const newQuat = new THREE.Quaternion().setFromEuler(newEuler);
          const finalQuat = initialQuat.clone().multiply(newQuat);
          
          eyeBone.quaternion.copy(finalQuat);
          
          // Skeleton 업데이트
          if (mesh.skeleton) {
            mesh.skeleton.update();
            eyeBone.updateMatrixWorld(true);
          }
        }
        
        // 디버깅: 첫 프레임에서만 로그 출력
        if (matchedCount > 0) {
          // 첫 번째 프레임에서만 상세 로그
          if (!meshRef.current._flameDebugLogged) {
            const sampleValues = expressionNames.slice(0, 5).map(name => {
              const expNum = parseInt(name.replace('exp_', ''), 10);
              const value = blendshapeData[name] || 0;
              return `${name} -> Exp${expNum + 1} = ${value.toFixed(3)}`;
            });
            
            // 디버깅 로그 제거됨 - 이벤트 로그만 사용
            //             // 디버깅 로그 제거됨 - 이벤트 로그만 사용
            // console.log(`[뷰어 ${viewerId}] FLAME expression 매칭 완료:`, { ... });
            meshRef.current._flameDebugLogged = true;
          }
        } else {
          // 매칭이 안 되는 경우
          if (!meshRef.current._flameNoMatchLogged) {
            console.warn(`[뷰어 ${viewerId}] FLAME expression 매칭 실패:`, {
              expressionNames: expressionNames.slice(0, 10),
              availableExpTargets: Object.keys(mesh.morphTargetDictionary).filter(k => k.startsWith('Exp')).slice(0, 10),
              availablePoseTargets: Object.keys(mesh.morphTargetDictionary).filter(k => k.startsWith('Pose')).slice(0, 10),
              allTargets: Object.keys(mesh.morphTargetDictionary).slice(0, 20)
            });
            meshRef.current._flameNoMatchLogged = true;
          }
        }
      } else {
        // morphTargetDictionary가 없으면 인덱스로 직접 매핑
        // exp_000 -> index 0 (Exp1), exp_001 -> index 1 (Exp2), ...
        expressionNames.forEach((name) => {
          if (name.startsWith('exp_')) {
            const expNum = parseInt(name.replace('exp_', ''), 10);
            if (!isNaN(expNum) && expNum >= 0 && expNum < mesh.morphTargetInfluences.length) {
              const value = blendshapeData[name] || 0;
              // FLAME 파라미터는 원래 값 그대로 사용 (정규화하지 않음)
              mesh.morphTargetInfluences[expNum] = value;
            }
          }
        });
      }
    } else {
      // 일반 blendshape 적용
      if (mesh.morphTargetDictionary) {
        blendshapeNames.forEach((name) => {
          // 이름 매칭 시도
          let index = mesh.morphTargetDictionary[name];
          
          // 정확한 이름이 없으면 부분 매칭 시도
          if (index === undefined) {
            const lowerName = name.toLowerCase();
            for (const [key, idx] of Object.entries(mesh.morphTargetDictionary)) {
              if (key.toLowerCase() === lowerName || 
                  key.toLowerCase().includes(lowerName) ||
                  lowerName.includes(key.toLowerCase())) {
                index = idx;
                break;
              }
            }
          }
          
          if (index !== undefined && index < mesh.morphTargetInfluences.length) {
            const value = blendshapeData[name] || 0;
            mesh.morphTargetInfluences[index] = value;
          }
        });
      } else {
        // morphTargetDictionary가 없으면 인덱스로 직접 매핑
        blendshapeNames.forEach((name, idx) => {
          if (idx < mesh.morphTargetInfluences.length) {
            const value = blendshapeData[name] || 0;
            mesh.morphTargetInfluences[idx] = value;
          }
        });
      }
    }
  });

  // 클론된 씬이 준비될 때까지 대기
  if (!clonedSceneRef.current) {
    // 에러가 있으면 에러 표시
    if (errorRef.current) {
      return (
        <group>
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="red" />
          </mesh>
        </group>
      );
    }
    return null;
  }

  return (
    <primitive 
      ref={groupRef}
      object={clonedSceneRef.current} 
      scale={scale} 
      position={position}
      rotation={rotation}
    />
  );
}

export default function ModelViewer({
  glbPath,
  blendshapeData,
  blendshapeNames,
  viewerId,
  cameraType = 'perspective', // 'perspective' 또는 'orthogonal'
  isFlameModel = false, // FLAME 모델 여부
  showWireframe = false, // Wireframe 모드
  currentFrame,
  totalFrames,
  position = [0, 0, 0], // TRANSLATION: 그룹 위치 (비교 뷰어에서 좌우 배치용)
  scale = 1, // SCALE: 모델 크기
  rotation = [0, 0, 0], // ROTATION: 모델 회전 (라디안)
}) {
  // 각 뷰어마다 고유한 ID를 사용하여 완전히 독립적인 Canvas 생성
  const canvasKey = `model-viewer-${viewerId || 'default'}-${glbPath}`;
  const containerRef = useRef(null);
  
  // 카메라 설정
  const cameraProps = cameraType === 'orthogonal' 
    ? { 
        position: [0, 0, 5],
        zoom: 100,
        left: -2,
        right: 2,
        top: 2,
        bottom: -2,
        near: 0.1,
        far: 1000
      }
    : { 
        position: [0, 0, 5], 
        fov: 50 
      };
  
  // wheel 이벤트에 passive 옵션 추가
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    
    // wheel 이벤트에 passive 옵션 추가하여 성능 경고 해결
    const wheelHandler = (e) => {
      // 이벤트는 OrbitControls가 처리하도록 전달
    };
    
    canvas.addEventListener('wheel', wheelHandler, { passive: true });
    
    return () => {
      canvas.removeEventListener('wheel', wheelHandler);
    };
  }, [canvasKey]);
  
  return (
    <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden relative">
      <Canvas 
        key={canvasKey}
        camera={cameraProps}
        gl={{ 
          preserveDrawingBuffer: true,
          alpha: true, // 투명 배경
          clearColor: 'transparent' // 투명 배경 색상
        }}
        orthographic={cameraType === 'orthogonal'}
      >
        <Suspense fallback={null}>
          <TransparentBackground />
          <ambientLight intensity={0.7} />
          <hemisphereLight args={['#ffffff', '#444444', 0.6]} />
          <directionalLight position={[0, 8, 10]} intensity={0.8} />
          <directionalLight position={[-5, 4, 5]} intensity={0.4} />
          <directionalLight position={[5, 4, 5]} intensity={0.4} />
          <Model 
            glbPath={glbPath} 
            viewerId={viewerId}
            blendshapeData={blendshapeData}
            blendshapeNames={blendshapeNames}
            isFlameModel={isFlameModel}
            showWireframe={showWireframe}
            position={position}
            scale={scale}
            rotation={rotation}
          />
          <OrbitControls 
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
          />
        </Suspense>
      </Canvas>
      {/* 프레임 번호 표시 - 좌상단 */}
      {currentFrame !== undefined && totalFrames !== undefined && (
        <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs font-mono z-10">
          Frame: {currentFrame} / {totalFrames}
        </div>
      )}
    </div>
  );
}
