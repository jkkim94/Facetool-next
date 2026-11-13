/**
 * ============================================================================
 * CustomGLBViewer: 사용자 업로드 GLB 파일용 뷰어
 * ============================================================================
 * 
 * 특징:
 * - 사용자가 직접 GLB 파일 업로드
 * - 여러 메쉬에 동일한 이름의 blendshape가 있을 경우 모두 동시 적용
 * - CSV 데이터(trainingData/gtData)와 연동
 * 
 * GLB 구조 예시:
 *   CC_Base_Body001_1: browOuterUpLeft, jawOpen, ...
 *   CC_Base_Body001_2: browOuterUpLeft, jawOpen, ...
 *   CC_Base_Body001_3: browOuterUpLeft, jawOpen, ...
 *   CC_Base_Body002: browOuterUpLeft, jawOpen, ...
 * 
 * ============================================================================
 */

'use client'

import { useRef, useState, Suspense, useEffect, useMemo, useCallback } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import * as THREE from 'three'

/**
 * CustomMesh: 업로드된 GLB를 표시하는 메쉬 컴포넌트
 */
function CustomMesh({ 
  glbUrl,
  blendshapeData, 
  audioRef, 
  isPlaying,
  playbackRate = 1.0,
  viewerId
}) {
  const meshRef = useRef()
  const sceneRef = useRef(null)
  const localTimeRef = useRef(0)
  const lastFrameRef = useRef(-1)
  const meshInfoRef = useRef([])  // 메쉬별 정보 저장
  const prevGlbUrlRef = useRef(null)  // 이전 GLB URL 추적
  
  // GLB 로드
  const gltf = useLoader(GLTFLoader, glbUrl)
  
  // GLB URL 변경 시 scene 초기화
  useEffect(() => {
    if (prevGlbUrlRef.current !== glbUrl) {
      console.log(`[CustomGLB] GLB URL 변경: ${prevGlbUrlRef.current} -> ${glbUrl}`)
      sceneRef.current = null
      meshInfoRef.current = []
      prevGlbUrlRef.current = glbUrl
    }
  }, [glbUrl])
  
  // Scene 초기화 및 메쉬 정보 수집
  useEffect(() => {
    if (gltf && !sceneRef.current) {
      console.log(`[CustomGLB] Scene 초기화 시작...`)
      sceneRef.current = gltf.scene.clone(true)
      const meshes = []
      
      sceneRef.current.traverse((child) => {
        if (child.isMesh) {
          // Geometry 클론
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
          
          // Material 클론
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material = child.material.map(mat => mat.clone())
            } else {
              child.material = child.material.clone()
            }
          }
          
          // Morph target influences 클론
          if (child.morphTargetInfluences) {
            const newInfluences = new Float32Array(child.morphTargetInfluences.length)
            for (let i = 0; i < child.morphTargetInfluences.length; i++) {
              newInfluences[i] = child.morphTargetInfluences[i]
            }
            child.morphTargetInfluences = newInfluences
          }
          
          // Morph target dictionary 클론
          if (child.morphTargetDictionary) {
            const newDictionary = {}
            Object.keys(child.morphTargetDictionary).forEach(key => {
              newDictionary[key] = child.morphTargetDictionary[key]
            })
            child.morphTargetDictionary = newDictionary
          }
          
          // 메쉬 정보 저장
          if (child.morphTargetDictionary && child.morphTargetInfluences) {
            meshes.push({
              name: child.name,
              mesh: child,
              blendshapes: Object.keys(child.morphTargetDictionary)
            })
            console.log(`[CustomGLB] 메쉬 발견: ${child.name}, Blendshapes: ${Object.keys(child.morphTargetDictionary).length}개`, 
              Object.keys(child.morphTargetDictionary).slice(0, 5))
          }
          
          child.uuid = THREE.MathUtils.generateUUID()
          if (child.geometry) child.geometry.uuid = THREE.MathUtils.generateUUID()
        }
      })
      
      meshInfoRef.current = meshes
      sceneRef.current.uuid = THREE.MathUtils.generateUUID()
      
      console.log(`[CustomGLB] 총 ${meshes.length}개 메쉬에 blendshape 적용 가능`)
      
      // CSV의 blendshape 이름과 GLB의 blendshape 이름 비교
      if (blendshapeData?.blendshapes && meshes.length > 0) {
        const csvBlendshapes = new Set(blendshapeData.blendshapes)
        const glbBlendshapes = new Set(meshes.flatMap(m => m.blendshapes))
        const matched = [...csvBlendshapes].filter(name => glbBlendshapes.has(name))
        const unmatched = [...csvBlendshapes].filter(name => !glbBlendshapes.has(name))
        
        console.log(`[CustomGLB] Blendshape 매칭: ${matched.length}/${csvBlendshapes.size}개 일치`)
        if (unmatched.length > 0) {
          console.warn(`[CustomGLB] 매칭 안 됨: ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '...' : ''}`)
        }
      }
    }
  }, [gltf, viewerId, glbUrl, blendshapeData])
  
  const blendshapeDataRef = useRef(blendshapeData)
  useEffect(() => {
    blendshapeDataRef.current = blendshapeData
  }, [blendshapeData])

  useEffect(() => {
    if (!isPlaying) {
      localTimeRef.current = 0
      lastFrameRef.current = -1
    }
  }, [isPlaying])
  
  // 모든 메쉬에 blendshape 동시 적용
  const applyBlendshapesToAllMeshes = useCallback((frameData, blendshapeNames, frameIndex) => {
    if (!sceneRef.current || !frameData || !blendshapeNames) return
    
    let appliedCount = 0
    let meshCount = 0
    
    // 모든 메쉬 순회
    sceneRef.current.traverse((child) => {
      if (child.isMesh && child.morphTargetInfluences && child.morphTargetDictionary) {
        meshCount++
        // 각 blendshape 적용
        blendshapeNames.forEach((name, i) => {
          const index = child.morphTargetDictionary[name]
          if (index !== undefined && frameData[i] !== undefined) {
            child.morphTargetInfluences[index] = frameData[i]
            appliedCount++
          }
        })
      }
    })
    
    // 첫 프레임에서만 로그 출력
    if (frameIndex === 0) {
      console.log(`[CustomGLB] Frame 0: ${meshCount}개 메쉬에 ${appliedCount}개 blendshape 적용됨`)
    }
  }, [])
  
  useFrame((state, delta) => {
    const currentScene = sceneRef.current
    if (!currentScene) return
    
    const currentData = blendshapeDataRef.current
    if (!currentData) return
    
    if (isPlaying) {
      let currentTime
      if (audioRef?.current) {
        currentTime = audioRef.current.currentTime
      } else {
        localTimeRef.current += delta * playbackRate
        currentTime = localTimeRef.current
      }
      
      const frame = Math.floor(currentTime * currentData.fps)
      const clampedFrame = Math.min(frame, currentData.frames - 1)
      
      if (clampedFrame !== lastFrameRef.current) {
        lastFrameRef.current = clampedFrame
        
        const frameData = currentData.data?.[clampedFrame]
        if (frameData) {
          applyBlendshapesToAllMeshes(frameData, currentData.blendshapes, clampedFrame)
        }
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
      scale={1}
      position={[0, -1, 0]}
    />
  )
}

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshStandardMaterial color="#666" wireframe />
    </mesh>
  )
}

function UploadPrompt({ onFileSelect }) {
  const inputRef = useRef()
  
  return (
    <div className="flex flex-col items-center justify-center h-full bg-black/20 rounded-lg border-2 border-dashed border-gray-600 p-4">
      <p className="text-gray-400 text-sm mb-2">GLB 파일을 업로드하세요</p>
      <p className="text-gray-500 text-xs mb-4">여러 메쉬의 동일 blendshape 동시 적용</p>
      <button
        onClick={() => inputRef.current?.click()}
        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition"
      >
        GLB 선택
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFileSelect(file)
        }}
        className="hidden"
      />
    </div>
  )
}

export default function CustomGLBViewer({ 
  blendshapeData,  // trainingData 또는 gtData
  audioRef, 
  isPlaying,
  playbackRate = 1.0,
  glbUrl: externalGlbUrl = null,  // 외부에서 전달된 GLB URL
  use2D = false
}) {
  const [glbFile, setGlbFile] = useState(null)
  const [internalGlbUrl, setInternalGlbUrl] = useState(null)
  const [meshInfo, setMeshInfo] = useState(null)
  
  // 실제 사용할 GLB URL (외부 props 우선, 없으면 내부 업로드)
  const glbUrl = externalGlbUrl || internalGlbUrl
  
  // GLB 파일 선택 시 URL 생성
  const handleFileSelect = useCallback((file) => {
    setGlbFile(file)
    const url = URL.createObjectURL(file)
    setInternalGlbUrl(url)
    console.log(`[CustomGLB] 파일 로드: ${file.name}`)
  }, [])
  
  // 카메라 설정
  const cameraProps = use2D 
    ? { position: [0, 0, 5], zoom: 100 }
    : { position: [0, 0, 3], fov: 50 }

  if (!glbUrl) {
    return <UploadPrompt onFileSelect={handleFileSelect} />
  }

  return (
    <div className="relative w-full h-full">
      {/* 파일명/URL 표시 */}
      <div className="absolute top-2 left-2 z-10 bg-black/50 px-2 py-1 rounded text-xs text-white max-w-[60%] truncate">
        {glbFile?.name || (externalGlbUrl ? 'GLB 설정에서 로드됨' : 'Unknown')}
      </div>
      
      {/* 파일 변경 버튼 (내부 업로드만 초기화) */}
      {!externalGlbUrl && (
        <button
          onClick={() => {
            setInternalGlbUrl(null)
            setGlbFile(null)
          }}
          className="absolute top-2 right-2 z-10 bg-red-600/80 hover:bg-red-600 px-2 py-1 rounded text-xs text-white transition"
        >
          변경
        </button>
      )}
      
      <Canvas 
        orthographic={use2D}
        camera={cameraProps} 
        key={`custom-glb-viewer-${use2D ? '2d' : '3d'}-${glbUrl}`}
      >
        <color attach="background" args={['#1a1a2e']} />
        
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <directionalLight position={[-5, 5, 5]} intensity={0.5} />
        
        <Suspense fallback={<LoadingFallback />}>
          <CustomMesh 
            glbUrl={glbUrl}
            blendshapeData={blendshapeData}
            audioRef={audioRef}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            viewerId="custom-glb"
          />
        </Suspense>
        
        <OrbitControls 
          enablePan={true}
          minDistance={0.1}
          maxDistance={100}
          enableZoom={true}
          enableRotate={!use2D}
        />
      </Canvas>
    </div>
  )
}
