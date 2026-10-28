export type Point3D = {
  x: number
  y: number
  z: number
}
export type Note = 1 | 2 | 3 | 4 | 5 | null
export type FingerState = 'up' | 'down' | 'unclear'

function distance(a: Point3D, b: Point3D) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function validHand(hand: readonly Point3D[]) {
  return hand.length === 21 && hand.every(p => [p.x, p.y, p.z].every(Number.isFinite))
    && distance(hand[5], hand[17]) > 1e-6
}

export function analyzeHand(hand: readonly Point3D[]) {
  if (!validHand(hand)) return null

  const palmWidth = distance(hand[5], hand[17])

  const fingers = [5, 9, 13, 17].map(base => {
    const mcp = hand[base]
    const pip = hand[base + 1]
    const dip = hand[base + 2]
    const tip = hand[base + 3]

    const axis = { x: pip.x - mcp.x, y: pip.y - mcp.y, z: pip.z - mcp.z }
    const axisLength = distance(mcp, pip)
    const path = axisLength + distance(pip, dip) + distance(dip, tip)

    if (axisLength < palmWidth * 0.05 || path < palmWidth * 0.1) {
      return { state: 'unclear' as FingerState, reach: 0, straightness: 0 }
    }

    const reach = (
      (tip.x - mcp.x) * axis.x +
      (tip.y - mcp.y) * axis.y +
      (tip.z - mcp.z) * axis.z
    ) / axisLength ** 2
    const straightness = distance(mcp, tip) / path
    const outward = (distance(tip, hand[0]) - distance(pip, hand[0])) / palmWidth
    const state: FingerState = reach > 1.35 && straightness > 0.65 && outward > -0.08 ? 'up' : 'down'

    return { state, reach, straightness }
  })

  const thumbGap = distance(hand[4], hand[5]) / palmWidth
  const thumbSpan = distance(hand[4], hand[17]) / palmWidth
  const thumb: FingerState = thumbGap > 0.45 && thumbSpan > 1.3 ? 'up' : 'down'

  const states = fingers.map(finger => finger.state)
  const pattern = states.join(',')
  let note: Note = null

  if (pattern === 'up,down,down,down') note = 1
  else if (pattern === 'up,up,down,down') note = 2
  else if (pattern === 'up,up,up,down') note = 3
  else if (pattern === 'up,up,up,up') note = thumb === 'up' ? 5 : 4

  return { note, thumb, fingers, thumbGap, thumbSpan }
}

export function detectNote(hand: readonly Point3D[]): Note {
  return analyzeHand(hand)?.note ?? null
}

export function selectNote(hands: readonly (readonly Point3D[])[]): Note {
  const notes = new Set(hands.map(detectNote).filter(note => note !== null))
  return notes.size === 1 ? notes.values().next().value ?? null : null
}

export class StableNote {
  private history: { note: Note; time: number }[] = []
  private value: Note = null

  update(note: Note, now: number, handVisible: boolean): Note {
    if (!handVisible) return this.reset()

    this.history.push({ note, time: now })
    const cutoff = now - 250
    while (this.history.length > 1 && this.history[1].time <= cutoff) this.history.shift()

    const votes = new Map<Note, number>()
    let total = 0

    for (let i = 0; i < this.history.length - 1; i++) {
      const frame = this.history[i]
      const duration = Math.max(0, this.history[i + 1].time - Math.max(cutoff, frame.time))
      votes.set(frame.note, (votes.get(frame.note) ?? 0) + duration)
      total += duration
    }

    if (this.value !== null && !votes.get(this.value)) this.value = null

    for (const [candidate, duration] of votes) {
      const delay = candidate === null ? 180 : 150
      if (duration >= delay && duration / total >= 0.65) {
        this.value = candidate
        break
      }
    }

    return this.value
  }

  reset(): Note {
    this.history = []
    this.value = null
    return null
  }
}
