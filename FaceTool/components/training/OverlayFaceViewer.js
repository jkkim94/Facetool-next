/**
 * ============================================================================
 * OverlayFaceViewer: GT와 학습결과를 오버레이하는 3D 뷰어
 * ============================================================================
 * 
 * GT는 초록색 와이어프레임, 학습결과는 빨간색 와이어프레임으로 표시
 * 각각 ON/OFF 토글 가능
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
 * WireframeMesh: 와이어프레임 메쉬 컴포넌트
 */
function WireframeMesh({ 
  blendshapeData, 
  audioRef, 
  isPlaying, 
  playbackRate = 1.0,
  glbUrl = '/models/face.glb',
  serviceName, 
  viewerId,
  wireframeColor,
  visible,
  opacity = 0.6,
  currentFrame = 0  // 프레임 기반 재생
}) {
  const meshRef = useRef()
  const sceneRef = useRef(null)
  const lastFrameRef = useRef(-1)
  
  const cacheKey = useMemo(() => `${viewerId}-${serviceName}-overlay-${Date.now()}`, [viewerId, serviceName])
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
          
          // 와이어프레임 머터리얼로 교체 (투명도로 겹침 표시)
          child.material = new THREE.MeshBasicMaterial({
            color: wireframeColor,
            wireframe: true,
            transparent: true,
            opacity: opacity,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
          
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
  }, [originalScene, viewerId, serviceName, cacheKey, wireframeColor])
  
  const blendshapeDataRef = useRef(blendshapeData)
  useEffect(() => {
    blendshapeDataRef.current = blendshapeData
  }, [blendshapeData])

  // 투명도 변경 시 머터리얼 업데이트
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.opacity = opacity
          child.material.needsUpdate = true
        }
      })
    }
  }, [opacity])

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = -1
    }
  }, [isPlaying])
  
  // 프레임 기반: currentFrame 변경 시 항상 morph 갱신
  useFrame(() => {
    const currentScene = sceneRef.current
    if (!currentScene || !visible) return

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

  if (!sceneRef.current || !visible) {
    return null
  }

  return (
    <primitive 
      ref={meshRef}
      object={sceneRef.current} 
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

export default function OverlayFaceViewer({ 
  gtData,
  trainingData,
  audioRef, 
  isPlaying,
  playbackRate = 1.0,
  glbUrl = '/models/face.glb',
  showGT = true,
  showTraining = true,
  use2D = false,
  opacity = 0.6,
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
        key={`overlay-viewer-${use2D ? '2d' : '3d'}-${glbUrl}`}
      >
        <color attach="background" args={['#1a1a2e']} />
        
        <CameraController distance={cameraDistance} zoom={cameraZoom} use2D={use2D} />
        
        <ambientLight intensity={0.6} />
        <directionalLight position={[100, 100, 100]} intensity={1} />
        <directionalLight position={[-100, 100, 100]} intensity={0.5} />
        
        <Suspense fallback={<LoadingFallback />}>
          {/* GT 메쉬 - 초록색 */}
          <WireframeMesh 
            blendshapeData={gtData}
            audioRef={audioRef}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            glbUrl={glbUrl}
            serviceName="gt"
            viewerId="overlay-gt"
            wireframeColor="#00ff00"
            visible={showGT && !!gtData}
            opacity={opacity}
            currentFrame={currentFrame}
          />
          
          {/* 학습결과 메쉬 - 빨간색 */}
          <WireframeMesh 
            blendshapeData={trainingData}
            audioRef={audioRef}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            glbUrl={glbUrl}
            serviceName="unitalker"
            viewerId="overlay-training"
            wireframeColor="#ff0000"
            visible={showTraining && !!trainingData}
            opacity={opacity}
            currentFrame={currentFrame}
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
