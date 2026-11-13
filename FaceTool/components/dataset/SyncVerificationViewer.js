'use client';

import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

/**
 * 동기화 검증 뷰어
 * 비디오 위에 3D 모델을 반투명하게 오버레이하여 동기화 확인
 */
export default function SyncVerificationViewer({
  videoPath,
  glbPath,
  currentTime,
  isPlaying,
  playbackRate,
  blendshapeData,
  blendshapeNames,
  onTimeUpdate,
  onPlay,
  onPause,
  onLoadedMetadata,
  onError,
  currentFrame,
  totalFrames,
  latency,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const modelRef = useRef(null);
  const controlsRef = useRef(null);
  const mixerRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const animationFrameRef = useRef(null);
  const compositeCanvasRef = useRef(null); // 비디오+3D 합성용 캔버스

  // UI 상태
  const [modelOpacity, setModelOpacity] = useState(0.7);
  const [modelScale, setModelScale] = useState(1.0);
  const [showModel, setShowModel] = useState(true);
  const [showVideo, setShowVideo] = useState(true);
  const [alignmentMode, setAlignmentMode] = useState('overlay'); // 'overlay' or 'side-by-side'
  
  // 녹화 상태
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState('video'); // 'video' or 'frames'
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const frameCountRef = useRef(0);
  const frameImagesRef = useRef([]);
  const compositeAnimationRef = useRef(null);

  // 비디오 제어 (기존 VideoPlayer 로직)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (onLoadedMetadata && video.duration > 0) {
        onLoadedMetadata({
          duration: video.duration,
          fps: 30,
        });
      }
    };

    if (video.readyState >= 1 && video.duration > 0) {
      handleLoadedMetadata();
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [onLoadedMetadata]);

  // currentTime 동기화
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const timeDiff = Math.abs(video.currentTime - currentTime);
    if (timeDiff > 0.1) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  // 재생 속도 설정
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (playbackRate !== undefined && playbackRate >= 0.1 && playbackRate <= 1.0) {
      video.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // 재생/일시정지
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      const tryPlay = () => {
        if (video.readyState >= 1) {
          if (!video.paused) return;
          
          video.play().catch(err => {
            if (err.name !== 'AbortError' && !video.paused) {
              console.error('[동기화 검증] 재생 오류:', err);
            }
          });
        } else {
          video.addEventListener('loadedmetadata', () => {
            if (isPlaying) tryPlay();
          }, { once: true });
        }
      };
      tryPlay();
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // requestAnimationFrame으로 매 프레임마다 시간 업데이트
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onTimeUpdate) return;

    let rafId = null;
    let isActive = true;
    let lastUpdateTime = -1;
    
    const updateTime = () => {
      if (!isActive) return;
      
      if (video.readyState >= 2) {
        const currentTime = video.currentTime;
        if (Math.abs(currentTime - lastUpdateTime) >= 0.033) {
          onTimeUpdate(currentTime);
          lastUpdateTime = currentTime;
        }
      }
      
      if (isActive) {
        rafId = requestAnimationFrame(updateTime);
      }
    };

    rafId = requestAnimationFrame(updateTime);

    return () => {
      isActive = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [onTimeUpdate]);

  // Three.js 씬 초기화
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 1.5);
    cameraRef.current = camera;

    // Renderer (투명 배경)
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true, // 투명 배경
      antialias: true,
      preserveDrawingBuffer: true, // 캔버스 복사를 위해 필수!
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // 완전 투명
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    // Controls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Load Model
    const loader = new GLTFLoader();
    loader.load(
      glbPath,
      (gltf) => {
        const model = gltf.scene;
        
        // 모델 투명도 설정
        model.traverse((child) => {
          if (child.isMesh) {
            child.material.transparent = true;
            child.material.opacity = modelOpacity;
            child.material.depthWrite = true;
          }
        });

        // 모델 중앙 정렬
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);

        scene.add(model);
        modelRef.current = model;

        console.log('[동기화 검증] 모델 로드 완료');
      },
      undefined,
      (error) => {
        console.error('[동기화 검증] 모델 로드 실패:', error);
      }
    );

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      
      const width = container.clientWidth;
      const height = container.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (compositeAnimationRef.current) {
        cancelAnimationFrame(compositeAnimationRef.current);
      }

      if (rendererRef.current) {
        rendererRef.current.dispose();
      }

      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
    };
  }, [glbPath]);

  // 모델 투명도 업데이트
  useEffect(() => {
    if (!modelRef.current) return;

    modelRef.current.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.opacity = modelOpacity;
      }
    });
  }, [modelOpacity]);

  // 모델 스케일 업데이트
  useEffect(() => {
    if (!modelRef.current) return;

    modelRef.current.scale.set(modelScale, modelScale, modelScale);
  }, [modelScale]);

  // 모델 표시/숨김
  useEffect(() => {
    if (!modelRef.current) return;

    modelRef.current.visible = showModel;
  }, [showModel]);

  // 블렌드쉐입 적용
  useEffect(() => {
    if (!modelRef.current || !blendshapeData || !blendshapeNames) return;

    modelRef.current.traverse((child) => {
      if (child.isMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
        blendshapeNames.forEach((name) => {
          const index = child.morphTargetDictionary[name];
          if (index !== undefined) {
            const value = blendshapeData[name];
            if (typeof value === 'number') {
              child.morphTargetInfluences[index] = value;
            }
          }
        });
      }
    });
  }, [blendshapeData, blendshapeNames]);

  // 녹화 시작
  const startRecording = () => {
    if (!canvasRef.current || !videoRef.current || !containerRef.current) {
      alert('뷰어가 준비되지 않았습니다.');
      return;
    }

    frameCountRef.current = 0;
    frameImagesRef.current = [];
    recordedChunksRef.current = [];

    if (recordingMode === 'video') {
      // 비디오 녹화 (비디오 + 3D 합성)
      try {
        const container = containerRef.current;
        const video = videoRef.current;
        const canvas3D = canvasRef.current;
        
        // 합성용 캔버스 생성
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = container.clientWidth;
        compositeCanvas.height = container.clientHeight;
        compositeCanvasRef.current = compositeCanvas;
        
        const ctx = compositeCanvas.getContext('2d', { alpha: false });

        // 합성 애니메이션 루프
        let isComposing = true;
        const composeFrame = () => {
          if (!isComposing) return;

          // 먼저 3D 씬을 렌더링 (최신 상태 보장)
          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
          }

          // 1. 비디오 그리기 (배경)
          if (showVideo && video.readyState >= 2) {
            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = compositeCanvas.width / compositeCanvas.height;
            
            let drawWidth, drawHeight, offsetX, offsetY;
            
            if (videoAspect > canvasAspect) {
              drawHeight = compositeCanvas.height;
              drawWidth = drawHeight * videoAspect;
              offsetX = (compositeCanvas.width - drawWidth) / 2;
              offsetY = 0;
            } else {
              drawWidth = compositeCanvas.width;
              drawHeight = drawWidth / videoAspect;
              offsetX = 0;
              offsetY = (compositeCanvas.height - drawHeight) / 2;
            }
            
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
            ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
          } else {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
          }

          // 2. 3D 캔버스 그리기 (오버레이)
          if (showModel && canvas3D.width > 0 && canvas3D.height > 0) {
            try {
              ctx.drawImage(canvas3D, 0, 0, compositeCanvas.width, compositeCanvas.height);
            } catch (err) {
              console.warn('[합성] 3D 캔버스 그리기 실패:', err);
            }
          }

          compositeAnimationRef.current = requestAnimationFrame(composeFrame);
        };

        // 합성 시작
        composeFrame();

        // MediaRecorder로 합성 캔버스 녹화
        const stream = compositeCanvas.captureStream(30); // 30 FPS
        
        // 비디오 오디오 스트림 추가
        if (video.captureStream) {
          try {
            const videoStream = video.captureStream();
            const audioTracks = videoStream.getAudioTracks();
            audioTracks.forEach(track => stream.addTrack(track));
          } catch (e) {
            console.warn('[녹화] 오디오 트랙 추가 실패:', e);
          }
        }

        const options = {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 8000000, // 8 Mbps
        };

        // VP9이 지원되지 않으면 VP8 시도
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = 'video/webm;codecs=vp8';
        }

        const mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          // 합성 애니메이션 중지
          isComposing = false;
          if (compositeAnimationRef.current) {
            cancelAnimationFrame(compositeAnimationRef.current);
            compositeAnimationRef.current = null;
          }

          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `sync_verification_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.webm`;
          a.click();
          URL.revokeObjectURL(url);
          
          console.log('[녹화] 비디오 저장 완료');
        };

        mediaRecorder.start(100); // 100ms마다 데이터 저장
        setIsRecording(true);
        console.log('[녹화] 비디오+3D 합성 녹화 시작');
      } catch (error) {
        console.error('[녹화] 비디오 녹화 실패:', error);
        alert('비디오 녹화를 시작할 수 없습니다: ' + error.message);
      }
    } else {
      // 프레임 시퀀스 녹화
      setIsRecording(true);
      console.log('[녹화] 프레임 시퀀스 녹화 시작');
    }
  };

  // 녹화 중지
  const stopRecording = () => {
    if (recordingMode === 'video') {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      
      // 합성 애니메이션 중지
      if (compositeAnimationRef.current) {
        cancelAnimationFrame(compositeAnimationRef.current);
        compositeAnimationRef.current = null;
      }
    } else {
      // 프레임 시퀀스 저장
      if (frameImagesRef.current.length > 0) {
        downloadFrameSequence();
      }
    }
    
    setIsRecording(false);
    console.log('[녹화] 녹화 중지');
  };

  // 프레임 시퀀스 다운로드 (ZIP으로 압축)
  const downloadFrameSequence = async () => {
    if (frameImagesRef.current.length === 0) {
      alert('저장할 프레임이 없습니다.');
      return;
    }

    // 간단한 텍스트 파일로 프레임 정보 저장
    const frameInfo = [
      '# 동기화 검증 프레임 시퀀스',
      `# 녹화 시간: ${new Date().toISOString()}`,
      `# 총 캡처 프레임 수: ${frameImagesRef.current.length}`,
      `# FPS: 30`,
      '',
      '# 파일명 | 비디오 시간(초) | 비디오 프레임 | CSV 프레임 | 캡처 순서',
      '# -------------------------------------------------------------------------',
      ...frameImagesRef.current.map((frame, idx) => 
        `frame_${String(idx).padStart(6, '0')}.png | ${frame.time.toFixed(3)}s | ${frame.videoFrame} | ${frame.csvFrame} | ${frame.captureIndex}`
      )
    ].join('\n');

    const infoBlob = new Blob([frameInfo], { type: 'text/plain' });
    const infoUrl = URL.createObjectURL(infoBlob);
    const infoLink = document.createElement('a');
    infoLink.href = infoUrl;
    infoLink.download = `frame_info_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.txt`;
    infoLink.click();
    URL.revokeObjectURL(infoUrl);

    // 각 프레임 이미지 다운로드
    for (let i = 0; i < frameImagesRef.current.length; i++) {
      const frame = frameImagesRef.current[i];
      const link = document.createElement('a');
      link.href = frame.dataUrl;
      link.download = `frame_${String(i).padStart(6, '0')}.png`;
      link.click();
      
      // 브라우저가 다운로드를 처리할 시간 제공
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`[녹화] ${frameImagesRef.current.length}개 프레임 저장 완료`);
    alert(`${frameImagesRef.current.length}개의 프레임 이미지가 다운로드되었습니다.\nframe_info.txt 파일에서 프레임 정보를 확인하세요.`);
  };

  // 현재 프레임 캡처
  const captureCurrentFrame = () => {
    if (!containerRef.current) return;

    // HTML2Canvas 없이 수동으로 합성
    const container = containerRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || video.readyState < 2) return;

    // 비디오의 현재 시간을 직접 읽음 (prop보다 정확)
    const videoCurrentTime = video.currentTime;
    
    // 먼저 3D 씬을 렌더링 (최신 상태 보장)
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }

    // 임시 캔버스 생성 (원본 크기 사용)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = container.clientWidth;
    tempCanvas.height = container.clientHeight;
    const ctx = tempCanvas.getContext('2d', { 
      alpha: false, // 알파 채널 불필요
      willReadFrequently: false // 성능 최적화
    });

    // 1. 비디오 그리기
    if (showVideo) {
      const videoAspect = video.videoWidth / video.videoHeight;
      const containerAspect = tempCanvas.width / tempCanvas.height;
      
      let drawWidth, drawHeight, offsetX, offsetY;
      
      if (videoAspect > containerAspect) {
        // 비디오가 더 넓음 - 높이를 맞춤
        drawHeight = tempCanvas.height;
        drawWidth = drawHeight * videoAspect;
        offsetX = (tempCanvas.width - drawWidth) / 2;
        offsetY = 0;
      } else {
        // 비디오가 더 높음 - 너비를 맞춤
        drawWidth = tempCanvas.width;
        drawHeight = drawWidth / videoAspect;
        offsetX = 0;
        offsetY = (tempCanvas.height - drawHeight) / 2;
      }
      
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
    } else {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    }

    // 2. 3D 캔버스 그리기
    if (showModel && canvas.width > 0 && canvas.height > 0) {
      try {
        ctx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
      } catch (err) {
        console.warn('[캡처] 3D 캔버스 그리기 실패:', err);
      }
    }

    // 비디오 프레임 번호 계산 (30fps 기준)
    const capturedVideoFrame = Math.floor(videoCurrentTime * 30);
    const capturedCsvFrame = capturedVideoFrame;

    // 3. 프레임 정보 텍스트 추가
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, 350, 80);
    ctx.fillStyle = 'white';
    ctx.fillText(`Video Time: ${videoCurrentTime.toFixed(3)}s`, 20, 30);
    ctx.fillText(`Video Frame: ${capturedVideoFrame}`, 20, 50);
    ctx.fillText(`CSV Frame: ${capturedCsvFrame}`, 20, 70);
    ctx.fillText(`Capture #${frameCountRef.current}`, 20, 90);

    // PNG 변환
    const dataUrl = tempCanvas.toDataURL('image/png');
    
    frameImagesRef.current.push({
      dataUrl,
      time: videoCurrentTime,
      videoFrame: capturedVideoFrame,
      csvFrame: capturedCsvFrame,
      captureIndex: frameCountRef.current, // 캡처 순서
    });
    
    frameCountRef.current++;
    
    // 메모리 정리
    tempCanvas.width = 0;
    tempCanvas.height = 0;
  };

  // 녹화 중 프레임 캡처 (프레임 시퀀스 모드)
  useEffect(() => {
    if (!isRecording || recordingMode !== 'frames') return;

    const video = videoRef.current;
    if (!video) return;

    let lastCapturedFrame = -1;
    let isActive = true;
    let callbackId = null;

    // requestVideoFrameCallback 사용 (비디오 프레임과 정확히 동기화)
    const captureLoop = (now, metadata) => {
      if (!isActive) return;

      if (video.readyState >= 2) {
        // metadata에서 정확한 시간 정보 가져오기
        const videoTime = metadata.mediaTime || video.currentTime;
        const currentVideoFrame = Math.floor(videoTime * 30);
        
        // 새로운 프레임이면 즉시 캡처
        if (currentVideoFrame !== lastCapturedFrame) {
          lastCapturedFrame = currentVideoFrame;
          
          try {
            captureCurrentFrame();
            console.log(`[캡처] 프레임 ${currentVideoFrame} 캡처 (시간: ${videoTime.toFixed(3)}s, 실제 프레임#: ${metadata.presentedFrames || 'N/A'})`);
          } catch (err) {
            console.error('[캡처] 프레임 캡처 실패:', err);
          }
        }
      }

      // 다음 비디오 프레임을 기다림
      if (isActive && video.requestVideoFrameCallback) {
        callbackId = video.requestVideoFrameCallback(captureLoop);
      }
    };

    // requestVideoFrameCallback 지원 확인
    if (video.requestVideoFrameCallback) {
      callbackId = video.requestVideoFrameCallback(captureLoop);
      console.log('[캡처] requestVideoFrameCallback 사용 - 정확한 프레임 동기화');
      
      return () => {
        isActive = false;
        if (callbackId !== null && video.cancelVideoFrameCallback) {
          video.cancelVideoFrameCallback(callbackId);
        }
      };
    } else {
      // Fallback: requestAnimationFrame
      console.warn('[캡처] requestVideoFrameCallback 미지원 - requestAnimationFrame 사용 (정확도 낮음)');
      
      let rafId = null;
      const fallbackLoop = () => {
        if (!isActive) return;

        if (video.readyState >= 2) {
          const currentVideoFrame = Math.floor(video.currentTime * 30);
          
          if (currentVideoFrame !== lastCapturedFrame) {
            lastCapturedFrame = currentVideoFrame;
            
            try {
              captureCurrentFrame();
              console.log(`[캡처] 프레임 ${currentVideoFrame} 캡처 (시간: ${video.currentTime.toFixed(3)}s)`);
            } catch (err) {
              console.error('[캡처] 프레임 캡처 실패:', err);
            }
          }
        }

        if (isActive) {
          rafId = requestAnimationFrame(fallbackLoop);
        }
      };

      rafId = requestAnimationFrame(fallbackLoop);

      return () => {
        isActive = false;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
      };
    }
  }, [isRecording, recordingMode]);

  return (
    <div className="w-full h-full flex flex-col bg-gray-900">
      {/* 컨트롤 패널 */}
      <div className="bg-gray-800 p-2 flex items-center gap-4 flex-wrap text-xs">
        <div className="flex items-center gap-2">
          <label className="text-white">3D 투명도:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={modelOpacity}
            onChange={(e) => setModelOpacity(parseFloat(e.target.value))}
            className="w-32"
          />
          <span className="text-white font-mono w-12">{(modelOpacity * 100).toFixed(0)}%</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-white">3D 크기:</label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={modelScale}
            onChange={(e) => setModelScale(parseFloat(e.target.value))}
            className="w-32"
          />
          <span className="text-white font-mono w-12">{modelScale.toFixed(1)}x</span>
        </div>

        <button
          onClick={() => setShowModel(!showModel)}
          className={`px-3 py-1 rounded ${showModel ? 'bg-green-600' : 'bg-gray-600'} text-white`}
        >
          3D {showModel ? '표시' : '숨김'}
        </button>

        <button
          onClick={() => setShowVideo(!showVideo)}
          className={`px-3 py-1 rounded ${showVideo ? 'bg-green-600' : 'bg-gray-600'} text-white`}
        >
          비디오 {showVideo ? '표시' : '숨김'}
        </button>

        {/* 구분선 */}
        <div className="h-8 w-px bg-gray-600"></div>

        {/* 녹화 컨트롤 */}
        {!isRecording ? (
          <>
            <select
              value={recordingMode}
              onChange={(e) => setRecordingMode(e.target.value)}
              className="px-2 py-1 bg-gray-700 text-white rounded border border-gray-600"
              title="비디오 녹화: 빠르고 가벼움 (권장) | 프레임 시퀀스: 정밀 분석용 (무거움)"
            >
              <option value="video">비디오 녹화 (WebM) - 권장</option>
              <option value="frames">프레임 시퀀스 (PNG) - 무거움 주의</option>
            </select>
            <button
              onClick={startRecording}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 font-semibold flex items-center gap-1"
              title="화면 녹화 시작"
            >
              <span className="w-2 h-2 bg-white rounded-full"></span>
              녹화 시작
            </button>
            {recordingMode === 'frames' && (
              <span className="text-yellow-400 text-xs">
                ⚠️ 프레임 시퀀스는 CPU 사용량이 높아 버벅거릴 수 있습니다
              </span>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-1 bg-red-600 text-white rounded animate-pulse">
              <span className="w-2 h-2 bg-white rounded-full"></span>
              <span className="font-semibold">
                녹화 중... {recordingMode === 'frames' ? `(${frameImagesRef.current.length} 프레임)` : ''}
              </span>
            </div>
            <button
              onClick={stopRecording}
              className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 font-semibold"
            >
              녹화 중지
            </button>
            {recordingMode === 'frames' && (
              <span className="text-yellow-300 text-xs animate-pulse">
                처리 중... 느려질 수 있음
              </span>
            )}
          </>
        )}

        <div className="ml-auto text-yellow-400 font-semibold">
          동기화 검증 모드
        </div>
      </div>

      {/* 메인 뷰어 영역 */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {/* 비디오 레이어 */}
        {showVideo && (
          <div className="absolute inset-0 w-full h-full bg-black">
            <video
              ref={videoRef}
              src={videoPath}
              className="w-full h-full object-contain"
              onPlay={onPlay}
              onPause={onPause}
              onError={(e) => {
                const video = videoRef.current;
                if (video && video.error && onError) {
                  onError({
                    code: video.error.code,
                    message: video.error.message,
                    description: `비디오 로드 오류 (코드: ${video.error.code})`,
                    path: videoPath,
                  });
                }
              }}
              preload="auto"
              playsInline
              crossOrigin="anonymous"
            >
              <source src={videoPath} type="video/mp4" />
            </video>
          </div>
        )}

        {/* 3D 오버레이 레이어 */}
        {showModel && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-auto"
            style={{ mixBlendMode: 'normal' }}
          />
        )}

        {/* 프레임 번호 및 Latency 표시 - 좌상단 */}
        {(currentFrame !== undefined && totalFrames !== undefined) && (
          <div className="absolute top-2 left-2 bg-black bg-opacity-80 text-white px-2 py-1 rounded text-xs font-mono z-20">
            <div>Frame: {currentFrame} / {totalFrames}</div>
            {latency !== undefined && (
              <div className={`${Math.abs(latency) > 16.67 ? 'text-red-400' : 'text-green-400'}`}>
                Latency: {latency > 0 ? '+' : ''}{latency.toFixed(2)}ms
              </div>
            )}
          </div>
        )}

        {/* 안내 텍스트 */}
        <div className="absolute top-4 left-4 bg-black bg-opacity-70 text-white px-3 py-2 rounded text-xs max-w-sm" style={{ marginTop: currentFrame !== undefined ? '60px' : '0' }}>
          <div className="font-semibold mb-1">동기화 검증 도움말:</div>
          <div>• 3D 투명도를 조절하여 비디오와 비교하세요</div>
          <div>• 마우스로 3D 모델 회전/줌 가능</div>
          <div>• 입 모양, 눈 깜빡임 등이 정확히 일치하는지 확인</div>
          <div className="mt-2 pt-2 border-t border-gray-600">
            <div className="font-semibold mb-1">녹화 기능:</div>
            <div>• <span className="text-green-300">비디오 녹화 (권장)</span>: WebM 파일로 저장 - 빠르고 부드러움</div>
            <div>• <span className="text-yellow-300">프레임 시퀀스 (주의)</span>: PNG 이미지로 저장 - CPU 사용량 높음</div>
            <div className="mt-1 text-yellow-300 text-xs">
              ⚠️ 프레임 분석이 필요하면 비디오 녹화 후 별도 도구로 추출 권장
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
