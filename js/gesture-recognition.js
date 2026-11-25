import { detectNote, StableNote } from './hand-gestures.js'

const visionUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0'
const modelUrl = new URL('./models/hand_landmarker.task', import.meta.url).href
const knuckles = [5, 9, 13, 17]
const palmPoints = [0, ...knuckles]
const volumeTop = 0.35
const volumeBottom = 0.65
const chordHoldMs = 120

function qualityFromLeftTilt(hand, frameAspect) {
  const wrist = hand[0]
  if (!Number.isFinite(wrist?.x) || !Number.isFinite(wrist?.y)) return null

  let x = 0
  let y = 0
  for (const point of knuckles) {
    const joint = hand[point]
    if (!Number.isFinite(joint?.x) || !Number.isFinite(joint?.y)) return null
    x += joint.x
    y += joint.y
  }

  const mirroredX = (wrist.x - x / knuckles.length) * frameAspect
  const up = wrist.y - y / knuckles.length
  if (Math.hypot(mirroredX, up) < 0.02) return null

  const angle = Math.atan2(mirroredX, up) * 180 / Math.PI
  if (angle >= 35 && angle <= 110) return 'major'
  if (angle >= -65 && angle <= 20) return 'minor'
  return null
}

function volumeFromPalm(hand) {
  if (!hand) return null

  let sum = 0
  for (const point of palmPoints) {
    const y = hand[point]?.y
    if (!Number.isFinite(y)) return null
    sum += y
  }

  const palmY = sum / palmPoints.length
  const volume = (volumeBottom - palmY) / (volumeBottom - volumeTop)
  return Math.max(0, Math.min(1, volume))
}

export class GestureRecognition {
  #left = new StableNote()
  #right = new StableNote()
  #volume = null
  #volumeTime = 0
  #chordQuality = null
  #qualityCandidate = null
  #qualitySince = 0

  update({ worldLandmarks, handedness, landmarks = [] }, now, frameAspect = 1) {
    let left
    let right

    worldLandmarks.forEach((hand, i) => {
      const label = handedness[i]?.[0]
      if (label?.categoryName === 'Left' && (!left || label.score > left.score)) {
        left = { hand, score: label.score, inFrame: landmarks[i] }
      }
      if (label?.categoryName === 'Right' && (!right || label.score > right.score)) {
        right = { hand, score: label.score, inFrame: landmarks[i] }
      }
    })

    return {
      leftGestureId: this.#left.update(left ? detectNote(left.hand) : null, now, Boolean(left)),
      rightGestureId: this.#right.update(right ? detectNote(right.hand) : null, now, Boolean(right)),
      volume: this.#updateVolume(right?.inFrame, now),
      chordQuality: this.#updateChordQuality(left?.inFrame, now, frameAspect)
    }
  }

  #updateVolume(hand, now) {
    const target = volumeFromPalm(hand)

    if (target === null || this.#volume === null) {
      this.#volume = target
    } else {
      const elapsed = Math.max(0, now - this.#volumeTime)
      const weight = 1 - Math.exp(-elapsed / 100)
      this.#volume += (target - this.#volume) * weight
    }

    this.#volumeTime = now
    return this.#volume === null ? null : Math.round(this.#volume * 100) / 100
  }

  #updateChordQuality(hand, now, frameAspect = 1) {
    if (!hand) {
      this.#chordQuality = null
      this.#qualityCandidate = null
      return null
    }

    const candidate = qualityFromLeftTilt(hand, frameAspect)
    if (candidate !== this.#qualityCandidate) {
      this.#qualityCandidate = candidate
      this.#qualitySince = now
    }
    if (candidate && now - this.#qualitySince >= chordHoldMs) {
      this.#chordQuality = candidate
    }

    return this.#chordQuality
  }

  reset() {
    this.#volume = null
    this.#volumeTime = 0
    return {
      leftGestureId: this.#left.reset(),
      rightGestureId: this.#right.reset(),
      volume: null,
      chordQuality: this.#updateChordQuality(null, 0)
    }
  }
}

async function loadModel() {
  const { FilesetResolver, HandLandmarker } = await import(`${visionUrl}/vision_bundle.mjs`)
  const files = await FilesetResolver.forVisionTasks(`${visionUrl}/wasm`)
  const options = { runningMode: 'VIDEO', numHands: 2 }
  let detector

  try {
    detector = await HandLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' }
    })
  } catch {
    detector = await HandLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: modelUrl }
    })
  }

  return { detector, connections: HandLandmarker.HAND_CONNECTIONS }
}

export function createGestureTracking({ video, onFrame, onGestures, onError }) {
  const recognition = new GestureRecognition()
  let lastGestures = recognition.reset()
  let model
  let stream
  let animation
  let session = 0
  let active = false

  function publish(gestures) {
    if (gestures.leftGestureId === lastGestures.leftGestureId &&
        gestures.rightGestureId === lastGestures.rightGestureId &&
        gestures.volume === lastGestures.volume &&
        gestures.chordQuality === lastGestures.chordQuality) return

    lastGestures = gestures
    onGestures({ ...gestures })
  }

  function stop() {
    active = false
    session++
    cancelAnimationFrame(animation)
    stream?.getTracks().forEach(track => track.stop())
    stream = undefined
    video.pause()
    video.srcObject = null
    onFrame([], [], [])
    publish(recognition.reset())
  }

  function fail(error) {
    stop()
    onError(error)
  }

  async function start() {
    if (active) return
    active = true
    const current = ++session

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Откройте сайт через localhost или HTTPS.')
      }

      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      if (current !== session) {
        cameraStream.getTracks().forEach(track => track.stop())
        return
      }

      stream = cameraStream
      video.srcObject = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (current === session) fail(new Error('Камера отключилась.'))
      })
      await video.play()
      if (current !== session) return

      model ??= loadModel().catch(error => {
        model = undefined
        throw error
      })

      const { detector, connections } = await model
      if (current !== session) return

      let lastVideoTime = -1
      function frame(now) {
        if (current !== session) return

        try {
          if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime
            const result = detector.detectForVideo(video, now)
            onFrame(result.landmarks, result.handedness, connections)
            publish(recognition.update(result, now, video.videoWidth / video.videoHeight))
          }
          if (current === session) animation = requestAnimationFrame(frame)
        } catch (error) {
          model = undefined
          detector.close()
          fail(error)
        }
      }

      animation = requestAnimationFrame(frame)
    } catch (error) {
      if (current === session) fail(error)
    }
  }

  return { start, stop }
}
