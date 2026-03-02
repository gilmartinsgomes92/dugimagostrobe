import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { LaneCents } from '../hooks/useTuner'

function fmtCents(x: number) {
  const s = x >= 0 ? '+' : ''
  return `${s}${x.toFixed(1)}c`
}

type LaneProps = {
  title: string
  cents: number | null
  big?: boolean
}

function Lane({ title, cents, big }: LaneProps) {
  const patternRef = useRef<HTMLDivElement | null>(null)
  const offsetRef = useRef(0)
  const lastT = useRef<number | null>(null)
  const [shown, setShown] = useState(0)

  // Convert cents error to strobe speed (px/sec). Tuning feel:
  // 0c -> still; 5c -> slow; 25c -> fast.
  const speed = useMemo(() => {
    if (cents == null) return 0
    const c = Math.max(-50, Math.min(50, cents))
    return c * 16 // 1 cent -> 16 px/s
  }, [cents])

  useEffect(() => {
    let raf = 0
    const tick = (t: number) => {
      if (lastT.current == null) lastT.current = t
      const dt = (t - lastT.current) / 1000
      lastT.current = t

      offsetRef.current += speed * dt
      // wrap to keep numbers small
      if (offsetRef.current > 2000) offsetRef.current -= 2000
      if (offsetRef.current < -2000) offsetRef.current += 2000

      const el = patternRef.current
      if (el) {
        el.style.transform = `translate3d(0, ${offsetRef.current}px, 0)`
      }
      // only re-render small text readout at low rate
      if (cents != null) setShown(cents)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speed, cents])

  return (
    <div className={'lane' + (big ? ' big' : '')}>
      <div className="pattern" ref={patternRef} />
      <div className="mask" />
      <div className="centerLine" />
      <div className="title">{title}</div>
      <div className="readout">{cents == null ? '—' : fmtCents(shown)}</div>
    </div>
  )
}

export default function StrobeLanes({ lane }: { lane: LaneCents | null }) {
  const cF0 = lane ? lane.f0 : null
  const cO2 = lane ? lane.o2 : null
  const cP3 = lane ? lane.p3 : null

  return (
    <div className="strobes">
      <div className="strobeHeader">
        <h2>Strobe</h2>
        <div className="hint">Up/down motion reflects cents error (phase drift)</div>
      </div>
      <div className="lanes">
        <Lane title="Octave (2×)" cents={cO2} />
        <Lane title="Fundamental (1×)" cents={cF0} big />
        <Lane title="Fifth (3×)" cents={cP3} />
      </div>
      <div className="footerNote">
        Tip: when perfectly in tune, the lane should appear nearly still. If it drifts upward, you’re sharp; downward, you’re flat.
      </div>
    </div>
  )
}
