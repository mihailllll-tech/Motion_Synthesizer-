import './style.css'
import { DrawingUtils, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { analyzeHand, selectNote, StableNote } from './gestures'
import type { Note, Point3D } from './gestures'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <h1>Gesture Synth</h1>
    <div class="controls">
      <button id="start" type="button">Включить камеру</button>
      <button id="stop" type="button" disabled>Остановить</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
    <div class="viewer">
      <video id="video" autoplay muted playsinline aria-label="Зеркальное изображение с камеры"></video>
      <canvas id="overlay" aria-hidden="true"></canvas>
    </div>
    <p id="note" role="status" aria-live="polite">Нота: —</p>
    <details id="diagnostics">
      <summary>Диагностика</summary>
      <p id="fingers">—</p>
      <button id="save-pose" type="button" disabled>Сохранить точки жеста</button>
    </details>
  </main>
`

const video = document.querySelector<HTMLVideoElement>('#video')!
const canvas = document.querySelector<HTMLCanvasElement>('#overlay')!
const ctx = canvas.getContext('2d')!
const drawing = new DrawingUtils(ctx)
const startButton = document.querySelector<HTMLButtonElement>('#start')!
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const noteLabel = document.querySelector<HTMLParagraphElement>('#note')!
const stableNote = new StableNote()
const diagnostics = document.querySelector<HTMLDetailsElement>('#diagnostics')!
const fingersLabel = document.querySelector<HTMLParagraphElement>('#fingers')!
const savePoseButton = document.querySelector<HTMLButtonElement>('#save-pose')!
type CapturedFrame = {
  timeMs: number
  worldLandmarks: Point3D[][]
  landmarks: Point3D[][]
  detected: Note
}

let capturedFrames: CapturedFrame[] = []
let lastCapture = 0

function showDiagnostics() {
  const frame = capturedFrames.at(-1)
  if (!frame?.worldLandmarks.length) {
    fingersLabel.textContent = 'Рука не найдена.'
    return
  }

  const names = ['указательный', 'средний', 'безымянный', 'мизинец']
  const labels = { up: 'поднят', down: 'согнут', unclear: 'неясно' }

  fingersLabel.textContent = frame.worldLandmarks.map((hand, i) => {
    const analysis = analyzeHand(hand)
    if (!analysis) return `Кисть ${i + 1}: нет данных.`

    const states = analysis.fingers.map((finger, index) =>
      `${names[index]} — ${labels[finger.state]}`
    )
    return `Кисть ${i + 1}: ${states.join('; ')}; большой — ${labels[analysis.thumb]}.`
  }).join('\n')
}

diagnostics.addEventListener('toggle', () => {
  if (diagnostics.open) showDiagnostics()
})

savePoseButton.addEventListener('click', () => {
  if (!capturedFrames.some(frame => frame.worldLandmarks.length)) return

  const data = {
    version: 1,
    recordedAt: new Date().toISOString(),
    frameSize: {
      width: video.videoWidth,
      height: video.videoHeight
    },
    frames: capturedFrames.map(frame => ({
      ...frame,
      analysis: frame.worldLandmarks.map(analyzeHand)
    }))
  }

  const url = URL.createObjectURL(new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json' }
  ))
  const link = document.createElement('a')
  link.href = url
  link.download = `gesture-${Date.now()}.json`
  link.click()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
})

let detector: HandLandmarker | undefined
let stream: MediaStream | undefined
let running = false
let loading = false
let session = 0
let animation = 0
let lastVideoTime = -1
let lastFrame = 0

function stop(message = 'Камера выключена.') {
  session++
  running = false
  cancelAnimationFrame(animation)

  stream?.getTracks().forEach(track => track.stop())
  stream = undefined
  video.pause()
  video.srcObject = null

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  stableNote.reset()
  noteLabel.textContent = 'Нота: —'

  capturedFrames = []
  lastCapture = 0
  savePoseButton.disabled = true
  fingersLabel.textContent = '—'

  startButton.disabled = loading
  stopButton.disabled = true
  status.textContent = message
}

function errorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : ''

  if (name === 'NotAllowedError') return 'Нет доступа к камере. Разреши камеру для localhost в настройках браузера и проверь разрешение браузеру в настройках macOS.'
  if (name === 'NotFoundError') return 'Камера не найдена. Проверь, доступна ли она на этом устройстве.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Не удалось включить камеру. Закрой другие приложения, которые её используют, и попробуй снова.'
  return 'Не удалось запустить трекинг. Обнови страницу и попробуй Chrome. Подробности ошибки — в консоли браузера.'
}

function frame(now: number) {
  if (!running || !detector) return

  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastFrame >= 32) {
      lastFrame = now
      lastVideoTime = video.currentTime

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        document.querySelector<HTMLElement>('.viewer')!.style.aspectRatio = `${canvas.width} / ${canvas.height}`
      }

      const result = detector.detectForVideo(video, now)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      result.landmarks.forEach((landmarks, i) => {
        const color = i === 0 ? '#b7f36b' : '#74caff'
        drawing.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color,
          lineWidth: 3
        })
        drawing.drawLandmarks(landmarks, {
          color: '#142020',
          fillColor: color,
          radius: 4,
          lineWidth: 1
        })
      })

      const detected = selectNote(result.worldLandmarks)
      const note = stableNote.update(detected, now, result.worldLandmarks.length > 0)
      const text = note === null ? 'Нота: —' : `Нота ${note}`
      if (noteLabel.textContent !== text) noteLabel.textContent = text

      if (now - lastCapture >= 100) {
        capturedFrames.push({
          timeMs: now,
          worldLandmarks: result.worldLandmarks,
          landmarks: result.landmarks,
          detected
        })
        capturedFrames = capturedFrames.filter(frame => now - frame.timeMs <= 2000)
        lastCapture = now
        savePoseButton.disabled = !result.worldLandmarks.length
        if (diagnostics.open) showDiagnostics()
      }
    }

    animation = requestAnimationFrame(frame)
  } catch (error) {
    console.error('Hand tracking failed:', error)
    detector.close()
    detector = undefined
    stop('Трекинг прервался. Нажми «Включить камеру», чтобы повторить.')
  }
}

async function start() {
  if (loading || running) return

  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'Камера недоступна. Открой приложение через localhost в Chrome или Safari.'
    return
  }

  const current = ++session
  loading = true
  startButton.disabled = true
  stopButton.disabled = false

  try {
    if (!detector) {
      status.textContent = 'Загрузка модели…'
      const files = await FilesetResolver.forVisionTasks('/wasm')
      if (current !== session) return

      const options = {
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task' },
        runningMode: 'VIDEO' as const,
        numHands: 2
      }

      try {
        detector = await HandLandmarker.createFromOptions(files, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'GPU' }
        })
      } catch {
        if (current !== session) return
        detector = await HandLandmarker.createFromOptions(files, options)
      }
    }

    if (current !== session) return
    status.textContent = 'Ожидание доступа к камере…'
    const acquired = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 720 },
        facingMode: 'user',
        frameRate: { ideal: 30 }
      },
      audio: false
    })

    if (current !== session) {
      acquired.getTracks().forEach(track => track.stop())
      return
    }

    stream = acquired
    video.srcObject = stream
    await video.play()

    if (current !== session) return
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (current === session) stop('Камера отключилась. Проверь доступ и запусти снова.')
    })

    running = true
    status.textContent = ''
    lastVideoTime = -1
    lastFrame = 0

    animation = requestAnimationFrame(frame)
  } catch (error) {
    if (current === session) {
      console.error('Camera startup failed:', error)
      stop(errorMessage(error))
    }
  } finally {
    loading = false
    startButton.disabled = running
    stopButton.disabled = !running
  }
}

startButton.addEventListener('click', start)
stopButton.addEventListener('click', () => stop())

function onHidden() {
  if (document.hidden && (running || loading)) stop('Камера остановлена при смене вкладки.')
}

function dispose() {
  stop()
  detector?.close()
  detector = undefined
  document.removeEventListener('visibilitychange', onHidden)
  window.removeEventListener('pagehide', dispose)
}

document.addEventListener('visibilitychange', onHidden)
window.addEventListener('pagehide', dispose)
if (import.meta.hot) import.meta.hot.dispose(dispose)
