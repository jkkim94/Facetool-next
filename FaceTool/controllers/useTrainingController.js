/**
 * ============================================================================
 * Controller: 학습 모니터링 컨트롤러
 * ============================================================================
 */

import { useCallback } from 'react'
import { validateBlendshapeCsvHeader } from '@/lib/blendshapeCsvValidation'

export function useTrainingController({
  trainingModel,
  gtModel,
  audioModel
}) {
  // File → 텍스트로 읽기
  const readFileAsText = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = (e) => reject(e)
      reader.readAsText(file)
    })
  }, [])

  // CSV 텍스트를 blendshape 데이터 구조로 변환 (30fps 가정)
  const parseCsvToBlendshapeData = useCallback((text, serviceName = 'unitalker') => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length < 2) {
      throw new Error('CSV에 데이터가 부족합니다 (헤더 + 최소 1줄 필요).')
    }

    const header = lines[0].split(',').map(h => h.trim()).filter(h => h.length > 0)
    if (header.length === 0) {
      throw new Error('헤더에서 블렌드셰이프 이름을 찾을 수 없습니다.')
    }

    const validation = validateBlendshapeCsvHeader(header)
    if (!validation.valid) {
      throw new Error(validation.error)
    }

    // frame, time_sec 컬럼은 블렌드쉐입이 아니므로 항상 제외 (학습/GT 공통)
    const frameIndex = header.indexOf('frame')
    const timeSecIndex = header.indexOf('time_sec')
    const skipIndices = []
    if (frameIndex !== -1) skipIndices.push(frameIndex)
    if (timeSecIndex !== -1) skipIndices.push(timeSecIndex)
    const blendshapes = header.filter((_, i) => !skipIndices.includes(i))

    const data = lines.slice(1).map((line, rowIndex) => {
      const cols = line.split(',').map(c => c.trim())
      if (cols.length < header.length) {
        throw new Error(`CSV ${rowIndex + 2}번째 줄의 컬럼 수가 헤더보다 적습니다.`)
      }
      
      // skipIndices에 포함된 컬럼은 제외하고 blendshape 값만 추출
      const frameValues = blendshapes.map((_, i) => {
        // 원본 헤더에서 blendshape의 실제 인덱스 찾기
        const originalIndex = header.indexOf(blendshapes[i])
        const v = parseFloat(cols[originalIndex])
        return Number.isFinite(v) ? v : 0
      })
      return frameValues
    })

    const fps = 30
    const frames = data.length

    return {
      service: serviceName,
      fps,
      frames,
      duration: frames / fps,
      blendshapes,
      data
    }
  }, [])

  /**
   * 에폭 폴더에서 CSV와 WAV 로드
   */
  const loadEpochFolder = useCallback(async (epochData) => {
    const { csvContent, gtCsvContent, audioBase64, audioFileName, csvFileName, gtCsvFileName, folderName, lve, lvd, valLve, valLvd, run, folderPath, source_audio_filename } = epochData

    console.log(`[epoch] 📥 에폭 폴더 로드: ${folderName}`)
    
    trainingModel.reset()
    gtModel.reset()
    trainingModel.setTrainingLoading(true)
    gtModel.setGTLoading(true)

    try {
      // 학습 결과 CSV 파싱
      const blendshapeData = parseCsvToBlendshapeData(csvContent, 'unitalker')
      console.log(`[epoch] ✅ CSV 파싱 성공: ${csvFileName}`, {
        frames: blendshapeData.frames,
        fps: blendshapeData.fps,
        blendshapes: blendshapeData.blendshapes.slice(0, 10)
      })
      trainingModel.setTrainingData(blendshapeData)
      
      // 프레임 기반 재생을 위해 totalFrames, fps 설정
      audioModel.setTotalFrames(blendshapeData.frames)
      audioModel.setFps(blendshapeData.fps)
      audioModel.setCurrentFrame(0)
      
      // 클립명 자동 추출. inference_debug는 예측 CSV(오디오) 기준만 사용, GT 파일명 제외
      let extractedClipName = ''
      const sourceFileName = (folderPath === 'inference_debug' ? csvFileName : (gtCsvFileName || csvFileName)) || ''
      if (sourceFileName) {
        let baseName = sourceFileName.replace(/\.(csv|npy|wav)$/i, '')
        const lipIdx = baseName.indexOf('lip_')
        if (lipIdx >= 0) {
          baseName = baseName.substring(lipIdx)
          if (folderPath === 'inference_debug') baseName = baseName.replace(/_input_blendshape$/, '').replace(/_input$/, '')
        } else if (lipIdx < 0 && baseName.indexOf('_gt') > 0) {
          baseName = baseName.replace(/_gt$/, '')
        }
        extractedClipName = baseName
        console.log(`[epoch] 클립명 추출: ${extractedClipName} (from: ${sourceFileName})`)
      }

      // 데이터셋 비디오 프레임 조회용 이름. LipReading_Dataset_Frames 구조: train/lip_xxx_frames/ → lip_ 부터 사용
      let videoClipNameForFrames = null
      if (source_audio_filename && source_audio_filename.trim()) {
        let stem = source_audio_filename.replace(/\.[^.]+$/, '').trim().replace(/^speaker\d+_/i, '')
        const lipIdx = stem.indexOf('lip_')
        if (lipIdx >= 0) stem = stem.substring(lipIdx)
        if (stem) videoClipNameForFrames = stem
      }
      if (!videoClipNameForFrames && folderPath === 'inference_debug' && csvFileName) {
        const predBase = csvFileName.replace(/\.(csv|npy)$/i, '').trim()
        const baseNoInput = predBase.replace(/_input_blendshape$/, '').replace(/_input$/, '')
        if (baseNoInput) {
          const lipIdx = baseNoInput.indexOf('lip_')
          videoClipNameForFrames = lipIdx >= 0 ? baseNoInput.substring(lipIdx) : baseNoInput
        }
      }

      // LVE/LVD 메트릭 + 클립명 저장
      trainingModel.setMetrics({
        lve: lve !== undefined ? lve : null,
        lvd: lvd !== undefined ? lvd : null,
        valLve: valLve !== undefined ? valLve : null,
        valLvd: valLvd !== undefined ? valLvd : null,
        folderName,
        clipName: extractedClipName,
        csvFileName: csvFileName || '',
        gtCsvFileName: gtCsvFileName || '',
        videoClipNameForFrames: videoClipNameForFrames || undefined,
      })
      console.log(`[epoch] 메트릭 로드:`, { lve, lvd, valLve, valLvd, clipName: extractedClipName, videoClipNameForFrames: videoClipNameForFrames || null })
      // 프레임 이미지는 /api/frames?name=videoClipNameForFrames 로 요청됨. 서버는 LipReading_Dataset_Frames/train|val|test 내에서만 검색
      const frameLookupName = videoClipNameForFrames || extractedClipName
      if (frameLookupName) {
        console.log(`[epoch] 프레임 조회용 클립명(서버에서 train/val/test 기준 조회): ${frameLookupName}`, frameLookupName ? `→ 예: /api/frames?name=${frameLookupName}&frame=0` : '')
      }

      // GT: 백엔드에서 보낸 CSV가 있으면 사용, 없으면 원본 파일명(source_audio_filename) 또는 클립명으로 데이터셋/NPY 조회
      const tryGtFromApi = async (nameForGt, useInferenceDebugParams = false) => {
        const gtParams = new URLSearchParams({ name: nameForGt })
        if (useInferenceDebugParams && folderPath === 'inference_debug' && run) {
          gtParams.set('run', run)
          gtParams.set('folderPath', 'inference_debug')
        }
        const res = await fetch(`/api/gt?${gtParams.toString()}`)
        const apiData = await res.json()
        if (apiData.success && apiData.gtCsvContent) {
          const gtBlendshapeData = parseCsvToBlendshapeData(apiData.gtCsvContent, 'gt')
          gtModel.setGTData(gtBlendshapeData)
          console.log(`[epoch] ✅ GT (API CSV) 로드 성공: ${apiData.gtFileName || nameForGt}`, {
            frames: gtBlendshapeData.frames,
            blendshapes: gtBlendshapeData.blendshapes.slice(0, 10)
          })
          return true
        }
        if (apiData.success && apiData.data && apiData.blendshapes) {
          const gtBlendshapeData = {
            service: 'gt',
            fps: apiData.fps || 30,
            frames: apiData.frames || apiData.data.length,
            duration: (apiData.frames || apiData.data.length) / (apiData.fps || 30),
            blendshapes: apiData.blendshapes,
            data: apiData.data
          }
          gtModel.setGTData(gtBlendshapeData)
          console.log(`[epoch] ✅ GT (DatasetGen NPY) 로드 성공: ${nameForGt}`, {
            frames: gtBlendshapeData.frames,
            blendshapes: gtBlendshapeData.blendshapes.slice(0, 10)
          })
          return true
        }
        return false
      }

      if (gtCsvContent) {
        try {
          const gtBlendshapeData = parseCsvToBlendshapeData(gtCsvContent, 'gt')
          console.log(`[epoch] ✅ GT (백엔드 CSV) 파싱 성공: ${gtCsvFileName || 'GT'}`, {
            frames: gtBlendshapeData.frames,
            fps: gtBlendshapeData.fps,
            blendshapes: gtBlendshapeData.blendshapes.slice(0, 10)
          })
          gtModel.setGTData(gtBlendshapeData)
        } catch (gtErr) {
          console.error('[epoch] ⚠️ GT CSV 파싱 실패:', gtErr)
          gtModel.setGTError(gtErr?.message || 'GT CSV 파싱 중 오류가 발생했습니다.')
        }
      } else {
        let gtLoaded = false
        try {
          // inference_debug: _input_source.txt에 있는 값(예: speaker0_RD_Radio1_000_00.wav)에서 화자 접두사 제거 후 오디오 stem으로 데이터셋 GT 조회 (D3_RD_Radio1_000_00 등)
          if (source_audio_filename && source_audio_filename.trim()) {
            let stem = source_audio_filename.replace(/\.[^.]+$/, '').trim()
            stem = stem.replace(/^speaker\d+_/i, '')
            if (stem) {
              gtLoaded = await tryGtFromApi(stem, false)
              if (!gtLoaded) console.log(`[epoch] ⚠️ GT 없음 (원본 파일명): ${stem}`)
            }
          }
          // 원본 파일명으로 못 찾으면 inference_debug 폴더 내 _gt.csv 또는 클립명으로 재시도
          if (!gtLoaded && extractedClipName) {
            gtLoaded = await tryGtFromApi(extractedClipName, true)
            if (!gtLoaded) console.log(`[epoch] ⚠️ GT 없음 또는 실패: ${extractedClipName}`)
          }
          if (!gtLoaded && !extractedClipName && !source_audio_filename) {
            console.log(`[epoch] ⚠️ GT 없음 (클립명/원본 파일명 없음)`)
          }
        } catch (gtErr) {
          console.warn('[epoch] GT API 요청 실패 (무시):', gtErr?.message)
        }
      }

      if (audioBase64 && audioFileName) {
        const audioBlob = await fetch(`data:audio/wav;base64,${audioBase64}`).then(r => r.blob())
        const displayName = source_audio_filename && source_audio_filename.trim() ? source_audio_filename.trim() : audioFileName
        const audioFile = new File([audioBlob], displayName, { type: 'audio/wav' })
        
        audioModel.reset()
        audioModel.setAudioFile(audioFile)
        console.log(`[epoch] ✅ 오디오 로드 성공: ${displayName}${source_audio_filename ? ' (우리가 추론 시 보낸 이름)' : ` (백엔드 저장명)`}`)
      } else {
        console.log(`[epoch] ⚠️ 오디오 파일 없음`)
      }
    } catch (err) {
      console.error('[epoch] ❌ 에폭 폴더 로드 실패:', err)
      const msg = err?.message || '에폭 폴더 로드 중 오류가 발생했습니다.'
      trainingModel.setTrainingError(msg)
    } finally {
      trainingModel.setTrainingLoading(false)
      gtModel.setGTLoading(false)
    }
  }, [trainingModel, gtModel, audioModel, parseCsvToBlendshapeData])

  /**
   * 오디오 재생
   */
  const playAudio = useCallback(async () => {
    const { audioRef, isPlaying, setIsPlaying, playbackRate } = audioModel
    const { trainingData } = trainingModel

    // 이미 재생 중이면 무시 (중복 재생 방지)
    if (isPlaying) {
      console.log('⚠️ Already playing, ignoring duplicate play request')
      return
    }

    const hasData = !!trainingData

    if (audioRef.current && hasData) {
      try {
        // 재생 전 정지 상태 확인
        audioRef.current.pause()
        audioRef.current.currentTime = 0
        audioRef.current.playbackRate = playbackRate
        
        // 버퍼링 완료 대기
        if (audioRef.current.readyState < 3) {
          await new Promise((resolve) => {
            const handleCanPlay = () => {
              audioRef.current.removeEventListener('canplaythrough', handleCanPlay)
              resolve()
            }
            audioRef.current.addEventListener('canplaythrough', handleCanPlay)
            // 이미 로드되어 있으면 바로 resolve
            if (audioRef.current.readyState >= 3) {
              audioRef.current.removeEventListener('canplaythrough', handleCanPlay)
              resolve()
            }
          })
        }
        
        await audioRef.current.play()
        setIsPlaying(true)
        console.log(`▶️ Play started (audio + animation) at ${playbackRate}x speed`)
      } catch (err) {
        console.error('❌ Play failed:', err.name, err.message)
        setIsPlaying(false)
      }
      return
    }

    if (!audioRef.current && hasData) {
      setIsPlaying(true)
      console.log(`▶️ Play started (animation only, no audio element) at ${playbackRate}x speed`)
      return
    }

    console.warn('⚠️ Cannot play - no training data available')
  }, [audioModel, trainingModel])

  /**
   * 오디오 정지
   */
  const stopAudio = useCallback(() => {
    const { audioRef, setIsPlaying } = audioModel

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsPlaying(false)
    }
  }, [audioModel])

  /**
   * 오디오 종료 처리
   */
  const handleAudioEnded = useCallback(() => {
    audioModel.setIsPlaying(false)
  }, [audioModel])

  return {
    loadEpochFolder,
    playAudio,
    stopAudio,
    handleAudioEnded
  }
}

