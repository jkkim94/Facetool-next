/**
 * ============================================================================
 * HeatmapFaceViewer: GT와 학습결과 간의 Signed Distance를 히트맵으로 표시
 * ============================================================================
 * 
 * CloudCompare C2C (Cloud-to-Cloud) Signed Distance Algorithm
 * 
 * 수식 (Formula):
 *   d_signed = dot(P_pred - P_gt, N_gt)
 *            = (P_pred - P_gt) · N_gt
 * 
 * 여기서:
 *   P_pred : 예측된 vertex 위치 (Training 결과)
 *   P_gt   : Ground Truth vertex 위치
 *   N_gt   : GT vertex의 normal 벡터 (얼굴 중심에서 바깥 방향)
 *   ·      : 벡터 내적 (dot product)
 * 
 * 부호 해석:
 *   d > 0  : P_pred가 N_gt 방향으로 P_gt보다 앞에 있음 (바깥쪽)
 *   d < 0  : P_pred가 N_gt 반대 방향으로 P_gt보다 뒤에 있음 (안쪽)
 *   d = 0  : 완전 일치
 * 
 * 색상 스케일 (CloudCompare 스타일):
 *   파랑(-Max) -> 청록(-) -> 녹색(0) -> 노랑(+) -> 빨강(+Max)
 * 
 * 참고:
 *   CloudCompare > Tools > Distances > Compute C2C Distance
 *   옵션: "signed distances" 체크
 * 
 * ============================================================================
 */

'use client'

import { useRef, useState, Suspense, useEffect, useMemo, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { applyBlendshapeFrameToScene } from '@/lib/eval/glbMorphApply'

/**
 * CameraController: 카메라 거리/줌을 동적으로 조절
 */
function CameraController({ distance, zoom, use2D }) {
  const { camera } = useThree()
  
  useEffect(() => {
    if (use2D) {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
    } else {
      camera.position.z = distance
      camera.updateProjectionMatrix()
    }
  }, [camera, distance, zoom, use2D])
  
  return null
}

/**
 * HeatmapMesh: 히트맵을 표시하는 메쉬 컴포넌트
 */
function HeatmapMesh({ 
  gtData,
  trainingData,
  audioRef, 
  isPlaying,
  playbackRate = 1.0,
  glbUrl = '/models/face.glb',
  scaleMin = -0.01,  // 클리핑 최소값 (음수)
  scaleMax = 0.01,   // 클리핑 최대값 (양수)
  viewerId,
  onMatchUpdate,
  onHistogramUpdate,
  onGlobalRangeUpdate,  // 전체 프레임 스캔 결과 콜백
  currentFrame = 0  // 프레임 기반 재생
}) {
  const meshRef = useRef()
  const gtSceneRef = useRef(null)
  const trainingSceneRef = useRef(null)
  const heatmapSceneRef = useRef(null)
  const lastFrameRef = useRef(-1)
  
  // 전체 프레임 스캔용 별도 scene (한 번만 사용)
  const scanGtSceneRef = useRef(null)
  const scanTrainingSceneRef = useRef(null)
  const globalRangeRef = useRef({ globalMin: 0, globalMax: 0, scanned: false })
  
  // 전체 프레임 누적 통계용 ref
  const accumulatedStatsRef = useRef({
    frameCount: 0,
    sumSignedDist: 0,      // signed distance 합계
    sumAbsDist: 0,         // 절대값 거리 합계
    maxPositive: 0,        // 최대 양수 거리 (바깥쪽)
    maxNegative: 0,        // 최대 음수 거리 (안쪽)
    vertexSumDist: null,   // vertex별 누적 거리 (평균 계산용)
  })
  
  // 거리 스케일 설정 (CloudCompare 스타일 - 대칭 스케일)
  const distanceScale = useRef(0.02)  // ±0.02 범위를 색상으로 매핑
  
  const gtCacheKey = useMemo(() => `${viewerId}-gt-heatmap-${Date.now()}`, [viewerId])
  const trainingCacheKey = useMemo(() => `${viewerId}-training-heatmap-${Date.now()}`, [viewerId])
  const heatmapCacheKey = useMemo(() => `${viewerId}-heatmap-display-${Date.now()}`, [viewerId])
  
  const { scene: gtOriginalScene } = useGLTF(glbUrl, gtCacheKey)
  const { scene: trainingOriginalScene } = useGLTF(glbUrl, trainingCacheKey)
  const { scene: heatmapOriginalScene } = useGLTF(glbUrl, heatmapCacheKey)
  
  // Scene 초기화
  useEffect(() => {
    const initScene = (originalScene, sceneRef, isHeatmap = false) => {
      if (originalScene && !sceneRef.current) {
        sceneRef.current = originalScene.clone(true)
        
        sceneRef.current.traverse((child) => {
          if (child.isMesh) {
            if (child.geometry) {
              child.geometry = child.geometry.clone()
              
              if (child.geometry.morphAttributes) {
                const newMorphAttributes = {}
                Object.keys(child.geometry.morphAttributes).forEach(key => {
                  newMorphAttributes[key] = child.geometry.morphAttributes[key].map(attr => {
                    const newArray = new Float32Array(attr.array)
                    const newAttr = new THREE.BufferAttribute(newArray, attr.itemSize, attr.normalized)
                    newAttr.name = attr.name
                    newAttr.usage = attr.usage
                    return newAttr
                  })
                })
                child.geometry.morphAttributes = newMorphAttributes
              }
              
              // 히트맵 메쉬의 경우 vertex colors 활성화
              if (isHeatmap) {
                const positionAttribute = child.geometry.getAttribute('position')
                if (positionAttribute) {
                  const colors = new Float32Array(positionAttribute.count * 3)
                  // 초기 색상: 파란색
                  for (let i = 0; i < positionAttribute.count; i++) {
                    colors[i * 3] = 0     // R
                    colors[i * 3 + 1] = 0 // G
                    colors[i * 3 + 2] = 1 // B
                  }
                  child.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
                }
                
                child.material = new THREE.MeshBasicMaterial({
                  vertexColors: true,
                  side: THREE.DoubleSide
                })
              }
            }
            
            if (child.morphTargetInfluences) {
              const newInfluences = new Float32Array(child.morphTargetInfluences.length)
              for (let i = 0; i < child.morphTargetInfluences.length; i++) {
                newInfluences[i] = child.morphTargetInfluences[i]
              }
              child.morphTargetInfluences = newInfluences
            }
            
            if (child.morphTargetDictionary) {
              const newDictionary = {}
              Object.keys(child.morphTargetDictionary).forEach(key => {
                newDictionary[key] = child.morphTargetDictionary[key]
              })
              child.morphTargetDictionary = newDictionary
            }
            
            child.uuid = THREE.MathUtils.generateUUID()
            if (child.geometry) child.geometry.uuid = THREE.MathUtils.generateUUID()
          }
        })
        
        sceneRef.current.uuid = THREE.MathUtils.generateUUID()
      }
    }
    
    initScene(gtOriginalScene, gtSceneRef, false)
    initScene(trainingOriginalScene, trainingSceneRef, false)
    initScene(heatmapOriginalScene, heatmapSceneRef, true)
  }, [gtOriginalScene, trainingOriginalScene, heatmapOriginalScene, viewerId])
  
  const gtDataRef = useRef(gtData)
  const trainingDataRef = useRef(trainingData)
  
  useEffect(() => {
    gtDataRef.current = gtData
    // 데이터 변경 시 global range 리셋
    if (gtData) {
      globalRangeRef.current.scanned = false
    }
  }, [gtData])
  
  useEffect(() => {
    trainingDataRef.current = trainingData
    // 데이터 변경 시 global range 리셋
    if (trainingData) {
      globalRangeRef.current.scanned = false
    }
  }, [trainingData])

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = -1
      // 재생 중지 시 누적 통계 초기화
      accumulatedStatsRef.current = {
        frameCount: 0,
        sumSignedDist: 0,
        sumAbsDist: 0,
        maxPositive: 0,
        maxNegative: 0,
        vertexSumDist: null,
      }
    }
  }, [isPlaying])
  
  // Blendshape 적용 함수
  const applyBlendshapes = useCallback((scene, data, frame) => {
    applyBlendshapeFrameToScene(scene, data, frame, { reset: true, clamp: true })
  }, [])
  
  // Vertex 위치 계산 함수 (morph targets 적용 후)
  const getVertexPositions = useCallback((scene) => {
    const positions = []
    
    scene.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const positionAttribute = child.geometry.getAttribute('position')
        const morphAttributes = child.geometry.morphAttributes.position
        const morphTargetInfluences = child.morphTargetInfluences
        
        if (positionAttribute) {
          for (let i = 0; i < positionAttribute.count; i++) {
            let x = positionAttribute.getX(i)
            let y = positionAttribute.getY(i)
            let z = positionAttribute.getZ(i)
            
            // Morph targets 적용
            if (morphAttributes && morphTargetInfluences) {
              for (let j = 0; j < morphAttributes.length; j++) {
                const influence = morphTargetInfluences[j] || 0
                if (influence > 0) {
                  x += morphAttributes[j].getX(i) * influence
                  y += morphAttributes[j].getY(i) * influence
                  z += morphAttributes[j].getZ(i) * influence
                }
              }
            }
            
            positions.push(new THREE.Vector3(x, y, z))
          }
        }
      }
    })
    
    return positions
  }, [])
  
  // Vertex Normal 계산 함수 (얼굴 중심 기준 방사형 normal 사용)
  // CloudCompare C2C 알고리즘: signed distance = dot(diff, normal)
  const getVertexNormals = useCallback((positions) => {
    // 얼굴의 대략적인 중심점 계산
    const center = new THREE.Vector3(0, 0, 0)
    positions.forEach(p => center.add(p))
    center.divideScalar(positions.length)
    
    // 각 vertex에서 중심을 향하는 방향의 반대 (바깥쪽)를 normal로 사용
    const normals = positions.map(p => {
      const normal = new THREE.Vector3().subVectors(p, center).normalize()
      return normal
    })
    
    return normals
  }, [])
  
  // ============================================================================
  // 전체 프레임 스캔: Epoch 로드 시 global min/max 계산
  // ============================================================================
  useEffect(() => {
    // Scene과 데이터가 모두 준비되었는지 확인
    if (!gtSceneRef.current || !trainingSceneRef.current) return
    if (!gtData || !trainingData) return
    if (globalRangeRef.current.scanned) return  // 이미 스캔 완료
    
    console.log('[HeatmapMesh] 전체 프레임 스캔 시작...')
    
    const gtScene = gtSceneRef.current
    const trainingScene = trainingSceneRef.current
    
    let globalMin = 0
    let globalMax = 0
    let sumDist = 0           // 합계 (mean 계산용)
    let sumSquaredDist = 0    // 제곱합 (std 계산용)
    let totalVertices = 0     // 총 vertex 수
    const totalFrames = Math.min(gtData.frames, trainingData.frames)
    
    // 성능을 위해 샘플링 (전체 프레임 중 최대 100개 프레임만 스캔)
    const sampleInterval = Math.max(1, Math.floor(totalFrames / 100))
    let sampledFrames = 0
    
    for (let frame = 0; frame < totalFrames; frame += sampleInterval) {
      // GT와 Training에 blendshape 적용
      gtScene.traverse((child) => {
        if (child.isMesh && child.morphTargetInfluences && child.morphTargetDictionary) {
          const frameData = gtData.data?.[frame]
          if (frameData && gtData.blendshapes) {
            gtData.blendshapes.forEach((name, i) => {
              const index = child.morphTargetDictionary[name]
              if (index !== undefined && frameData[i] !== undefined) {
                child.morphTargetInfluences[index] = frameData[i]
              }
            })
          }
        }
      })
      
      trainingScene.traverse((child) => {
        if (child.isMesh && child.morphTargetInfluences && child.morphTargetDictionary) {
          const frameData = trainingData.data?.[frame]
          if (frameData && trainingData.blendshapes) {
            trainingData.blendshapes.forEach((name, i) => {
              const index = child.morphTargetDictionary[name]
              if (index !== undefined && frameData[i] !== undefined) {
                child.morphTargetInfluences[index] = frameData[i]
              }
            })
          }
        }
      })
      
      // Vertex 위치 계산
      const gtPositions = getVertexPositions(gtScene)
      const trainingPositions = getVertexPositions(trainingScene)
      
      if (gtPositions.length !== trainingPositions.length) continue
      
      // Normal 계산
      const gtNormals = getVertexNormals(gtPositions)
      
      // Signed Distance 계산
      for (let i = 0; i < gtPositions.length; i++) {
        const diff = new THREE.Vector3().subVectors(trainingPositions[i], gtPositions[i])
        const signedDist = diff.dot(gtNormals[i])
        
        if (signedDist > globalMax) globalMax = signedDist
        if (signedDist < globalMin) globalMin = signedDist
        
        sumDist += signedDist
        sumSquaredDist += signedDist * signedDist
        totalVertices++
      }
      
      sampledFrames++
    }
    
    // Mean 계산
    const mean = totalVertices > 0 ? sumDist / totalVertices : 0
    
    // Standard Deviation 계산: sqrt(E[X^2] - E[X]^2)
    const variance = totalVertices > 0 ? (sumSquaredDist / totalVertices) - (mean * mean) : 0
    const std = Math.sqrt(Math.max(0, variance))  // 수치 오차로 인한 음수 방지
    
    // Global range 저장
    globalRangeRef.current = {
      globalMin,
      globalMax,
      scanned: true
    }
    
    console.log(`[HeatmapMesh] 전체 프레임 스캔 완료 (${sampledFrames}/${totalFrames} frames sampled, ${totalVertices} vertices)`)
    console.log(`[HeatmapMesh] Global Range: [${(globalMin * 1000).toFixed(4)}, ${(globalMax * 1000).toFixed(4)}] mm`)
    console.log(`[HeatmapMesh] Mean: ${(mean * 1000).toFixed(4)} mm, Std: ${(std * 1000).toFixed(4)} mm`)
    
    // 콜백으로 전달
    if (onGlobalRangeUpdate) {
      onGlobalRangeUpdate({
        globalMin: globalMin * 1000,  // mm 단위
        globalMax: globalMax * 1000,
        mean: mean * 1000,
        std: std * 1000,
        totalFrames,
        sampledFrames,
        totalVertices
      })
    }
  }, [gtData, trainingData, gtSceneRef.current, trainingSceneRef.current, getVertexPositions, getVertexNormals, onGlobalRangeUpdate])
  
  /**
   * CloudCompare 스타일 Signed Distance를 색상으로 변환 (비대칭 스케일 지원)
   * 양수(바깥쪽): 녹색 -> 노란색 -> 빨간색
   * 0(일치): 녹색
   * 음수(안쪽): 녹색 -> 청록색 -> 파란색
   * 
   * scaleMin/scaleMax로 클리핑 범위 지정 (CloudCompare scalar field 설정)
   */
  const signedDistanceToColor = useCallback((signedDist, minScale, maxScale) => {
    // 비대칭 정규화: minScale ~ maxScale 범위를 -1 ~ +1로 변환
    let normalized
    if (signedDist >= 0) {
      // 양수: 0 ~ maxScale -> 0 ~ 1
      normalized = Math.min(1, signedDist / Math.abs(maxScale))
    } else {
      // 음수: minScale ~ 0 -> -1 ~ 0
      normalized = Math.max(-1, signedDist / Math.abs(minScale))
    }
    
    let r, g, b
    
    if (normalized >= 0) {
      // 양수: 녹색(0) -> 노란색(0.5) -> 빨간색(1)
      if (normalized < 0.5) {
        // 녹색 -> 노란색
        const t = normalized * 2  // 0 ~ 1
        r = t
        g = 1
        b = 0
      } else {
        // 노란색 -> 빨간색
        const t = (normalized - 0.5) * 2  // 0 ~ 1
        r = 1
        g = 1 - t
        b = 0
      }
    } else {
      // 음수: 녹색(0) -> 청록색(-0.5) -> 파란색(-1)
      const absNorm = -normalized
      if (absNorm < 0.5) {
        // 녹색 -> 청록색
        const t = absNorm * 2  // 0 ~ 1
        r = 0
        g = 1
        b = t
      } else {
        // 청록색 -> 파란색
        const t = (absNorm - 0.5) * 2  // 0 ~ 1
        r = 0
        g = 1 - t
        b = 1
      }
    }
    
    return { r, g, b }
  }, [])
  
  // 히스토그램 계산 함수 (CloudCompare 스타일 - 20개 bin)
  const computeHistogram = useCallback((signedDistances, minVal, maxVal, numBins = 20) => {
    const bins = new Array(numBins).fill(0)
    const binWidth = (maxVal - minVal) / numBins
    
    signedDistances.forEach(d => {
      // 클리핑 범위 내로 제한
      const clipped = Math.max(minVal, Math.min(maxVal, d))
      const binIndex = Math.min(numBins - 1, Math.floor((clipped - minVal) / binWidth))
      bins[binIndex]++
    })
    
    // 정규화 (최대값 기준)
    const maxCount = Math.max(...bins, 1)
    const normalizedBins = bins.map(count => count / maxCount)
    
    return {
      bins,
      normalizedBins,
      binWidth,
      minVal,
      maxVal,
      total: signedDistances.length
    }
  }, [])
  
  // 히트맵 색상 업데이트 (CloudCompare C2C Signed Distance 방식)
  const updateHeatmapColors = useCallback((gtPositions, trainingPositions) => {
    if (!heatmapSceneRef.current) return
    if (gtPositions.length !== trainingPositions.length) return
    
    // GT 기준 normal 계산
    const gtNormals = getVertexNormals(gtPositions)
    
    // Signed Distance 계산 (CloudCompare C2C 알고리즘)
    // signedDist = dot(trainingPos - gtPos, gtNormal)
    // 양수: training이 GT보다 바깥쪽
    // 음수: training이 GT보다 안쪽
    const signedDistances = []
    for (let i = 0; i < gtPositions.length; i++) {
      const diff = new THREE.Vector3().subVectors(trainingPositions[i], gtPositions[i])
      const signedDist = diff.dot(gtNormals[i])
      signedDistances.push(signedDist)
    }
    
    // 현재 프레임 통계
    const currentAvgSigned = signedDistances.reduce((sum, d) => sum + d, 0) / signedDistances.length
    const currentMaxPositive = Math.max(...signedDistances, 0)
    const currentMaxNegative = Math.min(...signedDistances, 0)
    const absDistances = signedDistances.map(d => Math.abs(d))
    const currentAvgAbs = absDistances.reduce((sum, d) => sum + d, 0) / absDistances.length
    
    // 누적 통계 업데이트
    const stats = accumulatedStatsRef.current
    stats.frameCount += 1
    stats.sumSignedDist += currentAvgSigned
    stats.sumAbsDist += currentAvgAbs
    stats.maxPositive = Math.max(stats.maxPositive, currentMaxPositive)
    stats.maxNegative = Math.min(stats.maxNegative, currentMaxNegative)
    
    // vertex별 누적 (첫 프레임에서 초기화)
    if (!stats.vertexSumDist) {
      stats.vertexSumDist = new Array(signedDistances.length).fill(0)
    }
    for (let i = 0; i < signedDistances.length; i++) {
      stats.vertexSumDist[i] += signedDistances[i]
    }
    
    // 전체 프레임 평균 계산
    const totalAvgSigned = stats.sumSignedDist / stats.frameCount
    const totalAvgAbs = stats.sumAbsDist / stats.frameCount
    
    // 실제 데이터 범위
    const dataMin = Math.min(...signedDistances)
    const dataMax = Math.max(...signedDistances)
    
    // 히스토그램 계산 (scaleMin/scaleMax 범위 사용)
    const histogram = computeHistogram(signedDistances, scaleMin, scaleMax, 20)
    
    // 히스토그램 콜백
    if (onHistogramUpdate) {
      onHistogramUpdate({
        ...histogram,
        dataMin: dataMin * 1000,  // mm 단위
        dataMax: dataMax * 1000,
        scaleMin: scaleMin * 1000,
        scaleMax: scaleMax * 1000
      })
    }
    
    // 콜백으로 통계 정보 전달 (전체 프레임 누적 평균)
    if (onMatchUpdate) {
      onMatchUpdate({
        // 전체 프레임 누적 평균 (signed)
        avgSignedDist: (totalAvgSigned * 1000).toFixed(4),
        // 전체 프레임 누적 평균 (absolute)
        avgAbsDist: (totalAvgAbs * 1000).toFixed(4),
        // 전체 프레임에서 최대 양수 편차 (바깥쪽)
        maxPositive: (stats.maxPositive * 1000).toFixed(4),
        // 전체 프레임에서 최대 음수 편차 (안쪽)
        maxNegative: (stats.maxNegative * 1000).toFixed(4),
        // 현재 프레임의 실제 데이터 범위
        dataMin: (dataMin * 1000).toFixed(4),
        dataMax: (dataMax * 1000).toFixed(4),
        // 현재 프레임 통계
        currentAvgSigned: (currentAvgSigned * 1000).toFixed(4),
        // 처리된 프레임 수
        frameCount: stats.frameCount
      })
    }
    
    // 히트맵 색상 적용 (scaleMin/scaleMax 클리핑 범위 사용)
    heatmapSceneRef.current.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const colorAttribute = child.geometry.getAttribute('color')
        if (colorAttribute) {
          let vertexIndex = 0
          
          for (let i = 0; i < colorAttribute.count && vertexIndex < signedDistances.length; i++, vertexIndex++) {
            const signedDist = signedDistances[vertexIndex]
            const { r, g, b } = signedDistanceToColor(signedDist, Math.abs(scaleMin), Math.abs(scaleMax))
            colorAttribute.setXYZ(i, r, g, b)
          }
          
          colorAttribute.needsUpdate = true
        }
      }
    })
  }, [getVertexNormals, signedDistanceToColor, onMatchUpdate, onHistogramUpdate, scaleMin, scaleMax, computeHistogram])
  
  // 프레임 기반: currentFrame 변경 시 항상 morph/히트맵 갱신
  useFrame(() => {
    const gtScene = gtSceneRef.current
    const trainingScene = trainingSceneRef.current
    const heatmapScene = heatmapSceneRef.current

    if (!gtScene || !trainingScene || !heatmapScene) return

    const gtCurrentData = gtDataRef.current
    const trainingCurrentData = trainingDataRef.current

    if (!gtCurrentData || !trainingCurrentData) return

    const gtFrames = gtCurrentData.frames ?? gtCurrentData.data?.length ?? 0
    const predFrames = trainingCurrentData.frames ?? trainingCurrentData.data?.length ?? 0
    const clampedGtFrame = Math.min(Math.max(0, currentFrame), Math.max(0, gtFrames - 1))
    const clampedTrainingFrame = Math.min(Math.max(0, currentFrame), Math.max(0, predFrames - 1))

    const combinedFrame = clampedGtFrame * 10000 + clampedTrainingFrame

    if (combinedFrame !== lastFrameRef.current) {
      lastFrameRef.current = combinedFrame

      applyBlendshapes(gtScene, gtCurrentData, clampedGtFrame)
      applyBlendshapes(trainingScene, trainingCurrentData, clampedTrainingFrame)
      applyBlendshapes(heatmapScene, trainingCurrentData, clampedTrainingFrame)

      const gtPositions = getVertexPositions(gtScene)
      const trainingPositions = getVertexPositions(trainingScene)
      updateHeatmapColors(gtPositions, trainingPositions)
    }
  })

  if (!heatmapSceneRef.current) {
    return null
  }

  return (
    <primitive 
      ref={meshRef}
      object={heatmapSceneRef.current} 
      scale={100}
      position={[0, 0, 0]}
    />
  )
}

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial color="#666" wireframe />
    </mesh>
  )
}

export default function HeatmapFaceViewer({ 
  gtData,
  trainingData,
  audioRef, 
  isPlaying,
  playbackRate = 1.0,
  glbUrl = '/models/face.glb',
  scaleMin = -0.01,
  scaleMax = 0.01,
  onMatchUpdate,
  onHistogramUpdate,
  onGlobalRangeUpdate,
  use2D = false,
  currentFrame = 0  // 프레임 기반 재생
}) {
  // 카메라 조절용 state
  const [cameraDistance, setCameraDistance] = useState(70)
  const [cameraZoom, setCameraZoom] = useState(9)
  
  // 2D 모드: Orthographic 카메라, 3D 모드: Perspective 카메라
  // 모델 scale=100에 맞춰 카메라 거리 조정 (화면에 딱 맞게)
  const cameraProps = use2D 
    ? { position: [0, 0, 100], zoom: cameraZoom }
    : { position: [0, 0, cameraDistance], fov: 30 }

  return (
    <div className="relative w-full h-full">
      {/* 카메라 조절 UI */}
      <div className="absolute top-2 left-2 z-10 bg-black/70 px-3 py-2 rounded text-xs text-white space-y-2">
        <div className="font-bold text-yellow-400">Camera Settings</div>
        {use2D ? (
          <div className="flex items-center gap-2">
            <span>Zoom:</span>
            <input
              type="range"
              min="1"
              max="20"
              step="0.5"
              value={cameraZoom}
              onChange={(e) => setCameraZoom(parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="w-12 text-right">{cameraZoom.toFixed(1)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>Distance:</span>
            <input
              type="range"
              min="50"
              max="500"
              step="10"
              value={cameraDistance}
              onChange={(e) => setCameraDistance(parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="w-12 text-right">{cameraDistance}</span>
          </div>
        )}
      </div>
      
      <Canvas 
        orthographic={use2D}
        camera={cameraProps} 
        key={`heatmap-viewer-${use2D ? '2d' : '3d'}-${glbUrl}`}
      >
        <color attach="background" args={['#1a1a2e']} />
        
        <CameraController distance={cameraDistance} zoom={cameraZoom} use2D={use2D} />
        
        <ambientLight intensity={0.8} />
        <directionalLight position={[100, 100, 100]} intensity={0.5} />
        <directionalLight position={[-100, 100, 100]} intensity={0.3} />
        
        <Suspense fallback={<LoadingFallback />}>
          <HeatmapMesh 
            gtData={gtData}
            trainingData={trainingData}
            audioRef={audioRef}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            glbUrl={glbUrl}
            scaleMin={scaleMin}
            scaleMax={scaleMax}
            viewerId="heatmap"
            onMatchUpdate={onMatchUpdate}
            currentFrame={currentFrame}
            onHistogramUpdate={onHistogramUpdate}
            onGlobalRangeUpdate={onGlobalRangeUpdate}
          />
        </Suspense>
        
        <OrbitControls 
          enablePan={true}
          minDistance={0}
          maxDistance={1000}
          enableZoom={true}
          enableRotate={!use2D}
        />
      </Canvas>
    </div>
  )
}
