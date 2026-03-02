import React, { useMemo } from 'react'
import { useTuner } from './hooks/useTuner'
import StrobeLanes from './components/StrobeLanes'

function fmtHz(x: number | null, digits = 2) {
  if (x == null || !Number.isFinite(x)) return '—'
  return x.toFixed(digits) + ' Hz'
}

function fmtCents(x: number) {
  const s = x >= 0 ? '+' : ''
  return `${s}${x.toFixed(1)} c`
}

export default function App() {
  const { state, start, stop, toggleLock, clearTarget, debug } = useTuner()

  const statusEmoji = useMemo(() => {
    if (state.status === 'good') return '✅'
    if (state.status === 'warn') return '⚠️'
    if (state.status === 'bad') return '❌'
    return '—'
  }, [state.status])

  const statusText = useMemo(() => {
    if (!state.targetHz) return 'Play a note to auto-select a target'
    if (!state.detectedHz) return 'Listening…'
    if (state.status === 'good') return 'In tune (≤ 7c)'
    if (state.status === 'warn') return 'Close (7–15c)'
    if (state.status === 'bad') return 'Out (> 15c)'
    return '—'
  }, [state.status, state.targetHz, state.detectedHz])

  const rmsPct = Math.max(0, Math.min(1, state.rms / 0.15)) * 100

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <h1>Dugimago Handpan Tuning Check</h1>
          <p>Phase-drift strobe tuner (Linotune-style) • Web (Vite + React)</p>
        </div>

        <div className="row">
          {!state.running ? (
            <button className="btn" onClick={start}>Start mic</button>
          ) : (
            <button className="btn secondary" onClick={stop}>Stop</button>
          )}
          <button className="btn" onClick={toggleLock} disabled={!state.running}>
            {state.locked ? 'Locked' : 'Auto'}
          </button>
          <button className="btn secondary" onClick={clearTarget} disabled={!state.running}>
            Clear target
          </button>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <StrobeLanes lane={state.laneCents} />
          {debug && (
            <div className="debug">
{`debug=1
rms: ${state.rms.toFixed(4)}
noiseFloor: ${state.debug.noiseFloor.toExponential(3)}
locked: ${state.locked}
target: ${state.noteName ?? '—'} @ ${fmtHz(state.targetHz, 2)}
confidence: ${state.debug.confidence.toFixed(3)}
candidate: ${state.debug.candidateNote ?? '—'} (${Math.round(state.debug.candidateMs)}ms)
raw cents f0: ${state.debug.rawCents == null ? '—' : state.debug.rawCents.toFixed(2)}
smoothed cents f0: ${state.debug.smoothedCents == null ? '—' : state.debug.smoothedCents.toFixed(2)}
`}
            </div>
          )}
        </div>

        <div className="card">
          <div className="section">
            <div className="kv">
              <div>
                <div className="k">Note</div>
                <div className="v">{state.noteName ?? '—'}</div>
              </div>
              <div>
                <div className="k">Status</div>
                <div className="v">{statusEmoji} <span style={{fontWeight: 700, fontSize: 14, color: 'var(--muted)'}}>{statusText}</span></div>
              </div>

              <div>
                <div className="k">Target</div>
                <div className="v">{fmtHz(state.targetHz, 2)}</div>
              </div>
              <div>
                <div className="k">Detected</div>
                <div className="v">{fmtHz(state.detectedHz, 2)}</div>
              </div>

              <div>
                <div className="k">Cents (smoothed)</div>
                <div className="v">{state.targetHz && state.detectedHz ? fmtCents(state.cents) : '—'}</div>
              </div>
              <div>
                <div className="k">Confidence</div>
                <div className="v">{(state.confidence * 100).toFixed(0)}%</div>
              </div>
            </div>

            <div style={{height: 12}} />

            <div className="meterWrap">
              <div className="meter" aria-label="Input level meter">
                <div style={{ width: `${rmsPct}%` }} />
              </div>
              <div className="small">{state.running ? 'Input' : 'Stopped'}</div>
            </div>

            <div style={{height: 10}} />
            <div className="small">
              • Auto picks the nearest equal-temperament note once stable (~0.38s).<br/>
              • Lock freezes the target note (ideal when tuning one field).<br/>
              • Add <code>?debug</code> to the URL to see tuning internals.
            </div>
          </div>

          <div className="status">
            <div className="label">Browser audio note</div>
            <div className="badge">
              iPhone: set Ring/Silent off if you can’t hear feedback (mic still works). Use headphones to avoid acoustic coupling.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
