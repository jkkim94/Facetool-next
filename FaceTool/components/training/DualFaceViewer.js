/**
 * ============================================================================
 * DualFaceViewer: GT와 학습결과를 함께 표시하는 3D 뷰어
 * ============================================================================
 * 
 * 두 메쉬를 한 캔버스에 표시하고, 각각의 X축 위치와 투명도를 조절 가능
 * ============================================================================
 */

'use client'

import { useRef, useState, Suspense, useEffect, useMemo } from 'react'
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
 * FaceMesh: 개별 3D 메쉬 컴포넌트
 */
function FaceMesh({ 
  blendshapeData, 
  audioRef, 
  isPlaying, 
  playbackRate = 1.0,
  glbUrl = '/models/face.glb',
  serviceName, 
  viewerId,
  xOffset = 0,
  currentFrame = 0  // 프레임 기반 재생
}) {
  const meshRef = useRef()
  const sceneRef = useRef(null)
  const lastFrameRef = useRef(-1)
  
  const cacheKey = useMemo(() => `${viewerId}-${serviceName}-dual-${Date.now()}`, [viewerId, serviceName])
  const { scene: originalScene } = useGLTF(glbUrl, cacheKey)
  
  useEffect(() => {
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
          }
          
          // 머터리얼 클론 (원래 색상 유지)
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material = child.material.map(mat => mat.clone())
            } else {
              child.material = child.material.clone()
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
  }, [originalScene, viewerId, serviceName, cacheKey])
  
  
  const blendshapeDataRef = useRef(blendshapeData)
  useEffect(() => {
    blendshapeDataRef.current = blendshapeData
  }, [blendshapeData])

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = -1
    }
  }, [isPlaying])
  
  // 프레임 기반 재생: currentFrame 변경 시 항상 morph 갱신 (isPlaying 여부 무관)
  useFrame(() => {
    const currentScene = sceneRef.current
    if (!currentScene) return

    const currentData = blendshapeDataRef.current
    if (!currentData?.data?.length) return

    const clampedFrame = Math.min(
      Math.max(0, currentFrame),
      (currentData.frames ?? currentData.data.length) - 1,
    )

    if (clampedFrame !== lastFrameRef.current) {
      lastFrameRef.current = clampedFrame
      applyBlendshapeFrameToScene(currentScene, currentData, clampedFrame, {
        reset: true,
        clamp: true,
      })
    }
  })

  if (!sceneRef.current) {
    return null
  }

  return (
    <primitive 
      ref={meshRef}
      object={sceneRef.current} 
      scale={100}
      position={[xOffset, 0, 0]}
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

export default function DualFaceViewer({ 
  gtData,
  trainingData,
  audioRef, 
  isPlaying,
  playbackRate = 1.0,
  glbUrl = '/models/face.glb',
  use2D = false,
  gtXOffset = 0,
  trainingXOffset = 0,
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
        key={`dual-viewer-${use2D ? '2d' : '3d'}-${glbUrl}`}
      >
        <color attach="background" args={['#1a1a2e']} />
        
        <CameraController distance={cameraDistance} zoom={cameraZoom} use2D={use2D} />
        
        <ambientLight intensity={0.6} />
        <directionalLight position={[100, 100, 100]} intensity={1} />
        <directionalLight position={[-100, 100, 100]} intensity={0.5} />
        
        <Suspense fallback={<LoadingFallback />}>
          {/* GT 메쉬 */}
          {gtData && (
            <FaceMesh 
              blendshapeData={gtData}
              audioRef={audioRef}
              isPlaying={isPlaying}
              playbackRate={playbackRate}
              glbUrl={glbUrl}
              serviceName="gt"
              viewerId="dual-gt"
              xOffset={gtXOffset}
              currentFrame={currentFrame}
            />
          )}
          
          {/* 학습결과 메쉬 */}
          {trainingData && (
            <FaceMesh 
              blendshapeData={trainingData}
              audioRef={audioRef}
              isPlaying={isPlaying}
              playbackRate={playbackRate}
              glbUrl={glbUrl}
              serviceName="unitalker"
              viewerId="dual-training"
              xOffset={trainingXOffset}
              currentFrame={currentFrame}
            />
          )}
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
