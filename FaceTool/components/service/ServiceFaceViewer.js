/**
 * ============================================================================
 * ServiceFaceViewer: 서비스별 독립적인 3D 뷰어
 * ============================================================================
 * 
 * 객체 지향적 설계: 각 서비스가 독립적인 3D 모델 인스턴스를 가짐
 * ============================================================================
 */

'use client'

import { useRef, useState, Suspense, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

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
 * FaceMesh: 각 서비스별 독립적인 3D 메쉬 컴포넌트
 */
function FaceMesh({ blendshapeData, audioRef, isPlaying, serviceName, viewerId }) {
  const meshRef = useRef()
  const [currentFrame, setCurrentFrame] = useState(0)
  const initializedRef = useRef(false)
  const sceneRef = useRef(null)
  const frameCountRef = useRef(0)
  const animationStartedRef = useRef(false)
  const localTimeRef = useRef(0)
  
  const cacheKey = useMemo(() => `${viewerId}-${serviceName}-${Date.now()}`, [viewerId, serviceName])
  const { scene: originalScene } = useGLTF('/models/face.glb', cacheKey)
  
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
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => { mat.uuid = THREE.MathUtils.generateUUID() })
            } else {
              child.material.uuid = THREE.MathUtils.generateUUID()
            }
          }
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
    const currentScene = sceneRef.current
    if (currentScene && !blendshapeData && !initializedRef.current) {
      currentScene.traverse((child) => {
        if (child.isMesh && child.morphTargetInfluences) {
          for (let i = 0; i < child.morphTargetInfluences.length; i++) {
            child.morphTargetInfluences[i] = 0
          }
        }
      })
      initializedRef.current = true
    }
  }, [blendshapeData, viewerId, serviceName])

  useEffect(() => {
    const currentScene = sceneRef.current
    if (currentScene && !isPlaying) {
      currentScene.traverse((child) => {
        if (child.isMesh && child.morphTargetInfluences) {
          for (let i = 0; i < child.morphTargetInfluences.length; i++) {
            child.morphTargetInfluences[i] = 0
          }
        }
      })
    }
  }, [isPlaying, serviceName, viewerId])
  
  useEffect(() => {
    if (!isPlaying) {
      animationStartedRef.current = false
      frameCountRef.current = 0
      localTimeRef.current = 0
      lastFrameRef.current = -1
    }
  }, [isPlaying])

  const lastLoggedFrameRef = useRef(-1)
  const lastFrameRef = useRef(-1)
  
  useFrame((state, delta) => {
    const currentScene = sceneRef.current
    if (!currentScene) return
    
    const currentData = blendshapeDataRef.current
    
    if (!currentData) return
    
    if (isPlaying && currentData.service === serviceName) {
      let currentTime
      if (audioRef?.current) {
        currentTime = audioRef.current.currentTime
      } else {
        localTimeRef.current += delta
        currentTime = localTimeRef.current
      }
      const frame = Math.floor(currentTime * currentData.fps)
      const clampedFrame = Math.min(frame, currentData.frames - 1)
      
      if (clampedFrame !== lastFrameRef.current) {
        lastFrameRef.current = clampedFrame
        setCurrentFrame(clampedFrame)

        currentScene.traverse((child) => {
          if (child.isMesh && child.morphTargetInfluences && child.morphTargetDictionary) {
            const frameData = currentData.data?.[clampedFrame]
            
            if (frameData && currentData.blendshapes) {
              currentData.blendshapes.forEach((name, i) => {
                const index = child.morphTargetDictionary[name]
                if (index !== undefined && frameData[i] !== undefined) {
                  child.morphTargetInfluences[index] = frameData[i]
                }
              })
            }
          }
        })
      }
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

export default function ServiceFaceViewer({ 
  blendshapeData, 
  audioRef, 
  isPlaying, 
  serviceName,
  viewerId,
  use2D = false
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
        key={`${viewerId}-${serviceName}-${use2D ? '2d' : '3d'}`}
      >
        <color attach="background" args={['#1a1a2e']} />
        
        <CameraController distance={cameraDistance} zoom={cameraZoom} use2D={use2D} />
        
        <ambientLight intensity={0.6} />
        <directionalLight position={[100, 100, 100]} intensity={1} />
        <directionalLight position={[-100, 100, 100]} intensity={0.5} />
        
        <Suspense fallback={<LoadingFallback />}>
          <FaceMesh 
            blendshapeData={blendshapeData}
            audioRef={audioRef}
            isPlaying={isPlaying}
            serviceName={serviceName}
            viewerId={viewerId}
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

