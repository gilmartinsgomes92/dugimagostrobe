import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PhaseVocoderTracker } from '../dsp/phaseVocoderTracker'
import { centsBetween, nearestNote } from '../dsp/notes'

export type LaneCents = {
  f0: number
  o2: number
  p3: number
  f0Raw: number
  o2Raw: number
  p3Raw: number
  conf: number
  hzDetected: number | null
  hzF0: number | null
  hzO2: number | null
  hzP3: number | null
}

export type TunerState = {
  running: boolean
  locked: boolean
  noteName: string | null
  targetHz: number | null
  detectedHz: number | null
  cents: number
  status: 'good' | 'warn' | 'bad' | 'none'
  rms: number
  confidence: number
  laneCents: LaneCents | null
  debug: {
    noiseFloor: number
    confidence: number
    candidateNote: string | null
    candidateMs: number
    rawCents: number | null
    smoothedCents: number | null
  }
}

const STATUS_TOL_GOOD = 7
const STATUS_TOL_WARN = 15

function statusFromCents(c: number): 'good' | 'warn' | 'bad' {
  const a = Math.abs(c)
  if (a <= STATUS_TOL_GOOD) return 'good'
  if (a <= STATUS_TOL_WARN) return 'warn'
  return 'bad'
}

function expSmooth(prev: number, next: number, alpha: number): number {
  return prev + alpha * (next - prev)
}

export function useTuner() {
  const [state, setState] = useState<TunerState>({
    running: false,
    locked: false,
    noteName: null,
    targetHz: null,
    detectedHz: null,
    cents: 0,
    status: 'none',
    rms: 0,
    confidence: 0,
    laneCents: null,
    debug: {
      noiseFloor: 0,
      confidence: 0,
      candidateNote: null,
      candidateMs: 0,
      rawCents: null,
      smoothedCents: null
    }
  })

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null) // for compatibility; worklet would be nicer but heavier.
  const streamRef = useRef<MediaStream | null>(null)

  const trackerRef = useRef<PhaseVocoderTracker | null>(null)

  // gating for target note selection
  const candidateRef = useRef<{ name: string; hz: number; since: number } | null>(null)
  const targetRef = useRef<{ name: string; hz: number } | null>(null)

  const smoothedRef = useRef<{ f0: number; o2: number; p3: number } | null>(null)

  const debug = useMemo(() => new URLSearchParams(window.location.search).has('debug'), [])

  const stop = useCallback(async () => {
    try {
      processorRef.current?.disconnect()
      sourceRef.current?.disconnect()
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        await audioCtxRef.current.close()
      }
    } catch {}
    processorRef.current = null
    sourceRef.current = null
    audioCtxRef.current = null

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    trackerRef.current?.reset()
    trackerRef.current = null
    candidateRef.current = null
    targetRef.current = null
    smoothedRef.current = null

    setState(s => ({ ...s, running: false, rms: 0, confidence: 0, detectedHz: null, laneCents: null }))
  }, [])

  const start = useCallback(async () => {
    if (state.running) return
    const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
    const ctx = new AudioContextCtor({ latencyHint: 'interactive' })
    audioCtxRef.current = ctx

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      }
    })
    streamRef.current = stream
    const source = ctx.createMediaStreamSource(stream)
    sourceRef.current = source

    // ScriptProcessorNode still supported on iOS Safari; keep buffer small.
    const bufSize = 1024
    const sp = ctx.createScriptProcessor(bufSize, 1, 1)
    processorRef.current = sp

    const tracker = new PhaseVocoderTracker({
      fftSize: 4096,
      hopSize: 256,
      sampleRate: ctx.sampleRate,
      minHz: 60,
      maxHz: 1200
    })
    trackerRef.current = tracker

    // Prevent feedback
    const zeroGain = ctx.createGain()
    zeroGain.gain.value = 0
    sp.connect(zeroGain)
    zeroGain.connect(ctx.destination)

    source.connect(sp)

    const stableMsNeeded = 380 // within user's 300-500ms requirement
    const confMin = 0.30
    const rmsMin = 0.008 // helps ignore silence

    sp.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0)
      const frame = tracker.push(input)
      if (!frame) return

      const now = performance.now()
      const rms = frame.rms
      const confidence = frame.confidence

      let detectedHz: number | null = frame.instHz
      // If instHz at peak not ready yet, fallback to peakHz (only for early startup)
      if (!detectedHz) detectedHz = frame.peakHz

      // Gate very low RMS / confidence
      const usable = rms >= rmsMin && confidence >= confMin && detectedHz >= 60 && detectedHz <= 1200

      let noteName: string | null = targetRef.current?.name ?? null
      let targetHz: number | null = targetRef.current?.hz ?? null

      let candidateName: string | null = candidateRef.current?.name ?? null
      let candidateMs = candidateRef.current ? now - candidateRef.current.since : 0

      if (usable) {
        const n = nearestNote(detectedHz)
        // Candidate stability gating (avoid target flicker)
        if (!candidateRef.current || candidateRef.current.name !== n.name) {
          candidateRef.current = { name: n.name, hz: n.freq, since: now }
        } else {
          // same candidate continues
        }
        candidateName = candidateRef.current.name
        candidateMs = now - candidateRef.current.since

        if (!state.locked) {
          if (candidateMs >= stableMsNeeded) {
            targetRef.current = { name: candidateRef.current.name, hz: candidateRef.current.hz }
            noteName = targetRef.current.name
            targetHz = targetRef.current.hz
          }
        } else {
          // locked: do not change target
        }
      } else {
        // degrade candidate slowly (keep last candidate but don't advance)
      }

      // If no target set yet, do not compute cents
      let rawF0: number | null = null
      let rawO2: number | null = null
      let rawP3: number | null = null
      let smF0: number | null = null
      let smO2: number | null = null
      let smP3: number | null = null

      let hzF0: number | null = null
      let hzO2: number | null = null
      let hzP3: number | null = null

      let lane: LaneCents | null = null

      if (targetHz && usable) {
        // Measure partials using phase-vocoder inst Hz near expected bins
        const f0Expected = targetHz
        const o2Expected = targetHz * 2
        const p3Expected = targetHz * 3

        const f0m = frame.instHzAt(f0Expected, 60)
        const o2m = frame.instHzAt(o2Expected, 50)
        const p3m = frame.instHzAt(p3Expected, 50)

        hzF0 = f0m.hz ?? detectedHz
        hzO2 = o2m.hz
        hzP3 = p3m.hz

        rawF0 = centsBetween(hzF0, f0Expected)
        rawO2 = hzO2 ? centsBetween(hzO2, o2Expected) : rawF0
        rawP3 = hzP3 ? centsBetween(hzP3, p3Expected) : rawF0

        // Confidence weight: combine global + local
        const conf = Math.max(0, Math.min(1, 0.55 * confidence + 0.25 * f0m.confidence + 0.10 * o2m.confidence + 0.10 * p3m.confidence))

        // Smoothing: strong smoothing near lock to avoid "jitter explosion"
        const alpha = 0.10 + 0.20 * conf // 0.10..0.30
        if (!smoothedRef.current) {
          smoothedRef.current = { f0: rawF0, o2: rawO2, p3: rawP3 }
        } else {
          smoothedRef.current.f0 = expSmooth(smoothedRef.current.f0, rawF0, alpha)
          smoothedRef.current.o2 = expSmooth(smoothedRef.current.o2, rawO2, alpha)
          smoothedRef.current.p3 = expSmooth(smoothedRef.current.p3, rawP3, alpha)
        }

        smF0 = smoothedRef.current.f0
        smO2 = smoothedRef.current.o2
        smP3 = smoothedRef.current.p3

        lane = {
          f0: smF0,
          o2: smO2,
          p3: smP3,
          f0Raw: rawF0,
          o2Raw: rawO2,
          p3Raw: rawP3,
          conf,
          hzDetected: detectedHz,
          hzF0,
          hzO2,
          hzP3
        }
      } else {
        smoothedRef.current = null
      }

      const mainCents = lane ? lane.f0 : 0
      const status = (targetHz && usable && lane) ? statusFromCents(mainCents) : 'none'

      setState(s => ({
        ...s,
        running: true,
        noteName,
        targetHz,
        detectedHz: usable ? detectedHz : null,
        cents: (targetHz && usable && lane) ? mainCents : 0,
        status,
        rms,
        confidence,
        laneCents: lane,
        debug: {
          noiseFloor: frame.noiseFloor,
          confidence,
          candidateNote: candidateName,
          candidateMs,
          rawCents: rawF0,
          smoothedCents: smF0
        }
      }))
    }

    setState(s => ({ ...s, running: true }))
  }, [state.running, state.locked])

  const toggleLock = useCallback(() => {
    setState(s => {
      const nextLocked = !s.locked
      if (!nextLocked) {
        // unlocking: allow target to change; keep current target but candidate gating will shift later
      } else {
        // locking: if no target yet but candidate exists, lock to candidate immediately
        const c = candidateRef.current
        if (!targetRef.current && c) targetRef.current = { name: c.name, hz: c.hz }
      }
      return { ...s, locked: nextLocked }
    })
  }, [])

  const clearTarget = useCallback(() => {
    targetRef.current = null
    candidateRef.current = null
    smoothedRef.current = null
    setState(s => ({ ...s, noteName: null, targetHz: null }))
  }, [])

  useEffect(() => {
    return () => { stop() }
  }, [stop])

  return { state, start, stop, toggleLock, clearTarget, debug }
}
