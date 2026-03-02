import { FFT, hannWindow, mag2, princarg } from './fft'

export type PVOptions = {
  fftSize: number
  hopSize: number
  sampleRate: number
  minHz: number
  maxHz: number
}

export type PVFrame = {
  rms: number
  noiseFloor: number
  peakBin: number
  peakHz: number
  peakMag: number
  confidence: number // 0..1
  instHz: number | null
  instHzAt: (hz: number, centsWindow?: number) => { hz: number | null; confidence: number }
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)) }

/**
 * Phase-vocoder instantaneous frequency estimator.
 * - Uses STFT frames with hopSize and tracks unwrapped phase per bin.
 * - Estimates instantaneous frequency from expected phase advance + residual.
 */
export class PhaseVocoderTracker {
  private readonly opt: PVOptions
  private readonly fft: FFT
  private readonly win: Float32Array
  private readonly buf: Float32Array
  private writePos = 0

  private readonly tmpFrame: Float32Array
  private readonly specRe: Float32Array
  private readonly specIm: Float32Array
  private readonly prevPhase: Float32Array
  private hasPrev = false

  // Noise floor estimation
  private noiseEma = 0

  constructor(opt: PVOptions) {
    this.opt = opt
    this.fft = new FFT(opt.fftSize)
    this.win = hannWindow(opt.fftSize)
    this.buf = new Float32Array(opt.fftSize + opt.hopSize * 2) // small ring-ish
    this.tmpFrame = new Float32Array(opt.fftSize)
    this.specRe = new Float32Array(opt.fftSize)
    this.specIm = new Float32Array(opt.fftSize)
    this.prevPhase = new Float32Array(opt.fftSize)
  }

  push(block: Float32Array): PVFrame | null {
    const { hopSize, fftSize } = this.opt
    // Append
    for (let i = 0; i < block.length; i++) {
      this.buf[this.writePos++] = block[i]
      if (this.writePos >= this.buf.length) {
        // shift left to avoid ring complexity
        this.buf.copyWithin(0, hopSize, this.writePos)
        this.writePos -= hopSize
      }
    }

    if (this.writePos < fftSize) return null
    // Take latest fftSize samples ending at writePos
    const start = this.writePos - fftSize
    // Window
    let sumSq = 0
    for (let i = 0; i < fftSize; i++) {
      const x = this.buf[start + i]
      sumSq += x * x
      this.tmpFrame[i] = x * this.win[i]
    }
    const rms = Math.sqrt(sumSq / fftSize)

    // FFT
    const { re, im } = this.fft.forwardReal(this.tmpFrame, { re: this.specRe, im: this.specIm })

    const sr = this.opt.sampleRate
    const binHz = sr / fftSize
    const minBin = Math.max(1, Math.floor(this.opt.minHz / binHz))
    const maxBin = Math.min(fftSize / 2 - 2, Math.ceil(this.opt.maxHz / binHz))

    // Find peak magnitude in range
    let peakBin = minBin
    let peakMag = 0
    let magSum = 0
    for (let k = minBin; k <= maxBin; k++) {
      const m = mag2(re[k], im[k])
      magSum += m
      if (m > peakMag) {
        peakMag = m
        peakBin = k
      }
    }
    const peakHz = peakBin * binHz

    // Noise floor: low percentile approximation via average excluding the peak neighborhood
    let noiseAcc = 0
    let noiseN = 0
    const guard = 2
    for (let k = minBin; k <= maxBin; k++) {
      if (Math.abs(k - peakBin) <= guard) continue
      noiseAcc += mag2(re[k], im[k])
      noiseN++
    }
    const noise = noiseN > 0 ? noiseAcc / noiseN : 0
    this.noiseEma = this.hasPrev ? (0.92 * this.noiseEma + 0.08 * noise) : noise
    const noiseFloor = this.noiseEma

    // Confidence as SNR-ish + peak sharpness
    const snr = peakMag / (noiseFloor + 1e-12)
    // Map to 0..1, with gentle saturation
    const confSNR = 1 - Math.exp(-0.12 * Math.max(0, Math.log2(snr + 1)))
    const confEnergy = clamp01((peakMag / (magSum + 1e-12)) * 10) // 0..1
    const confidence = clamp01(0.7 * confSNR + 0.3 * confEnergy)

    // Instantaneous frequency at the peak bin
    const instHz = this.instantaneousHzAtBin(peakBin)

    // Advance writePos by hopSize (consume)
    if (this.writePos >= hopSize) {
      // keep last fftSize samples, shift by hop
      this.buf.copyWithin(0, hopSize, this.writePos)
      this.writePos -= hopSize
    }

    return {
      rms,
      noiseFloor,
      peakBin,
      peakHz,
      peakMag,
      confidence,
      instHz,
      instHzAt: (hz: number, centsWindow = 50) => {
        const k0 = Math.round(hz / binHz)
        const winBins = Math.max(2, Math.round((centsWindow / 1200) * Math.log2(2) * hz / binHz)) // rough
        const minK = Math.max(minBin, k0 - winBins)
        const maxK = Math.min(maxBin, k0 + winBins)
        let bestK = -1
        let bestM = 0
        let localSum = 0
        for (let k = minK; k <= maxK; k++) {
          const m = mag2(re[k], im[k])
          localSum += m
          if (m > bestM) { bestM = m; bestK = k }
        }
        if (bestK < 0) return { hz: null, confidence: 0 }
        const localSNR = bestM / (noiseFloor + 1e-12)
        const localConf = clamp01((1 - Math.exp(-0.10 * Math.max(0, Math.log2(localSNR + 1)))) * clamp01((bestM / (localSum + 1e-12)) * 8))
        const f = this.instantaneousHzAtBin(bestK)
        return { hz: f, confidence: localConf }
      }
    }
  }

  private instantaneousHzAtBin(k: number): number | null {
    const { fftSize, hopSize, sampleRate } = this.opt
    const re = this.specRe[k]
    const im = this.specIm[k]
    const phase = Math.atan2(im, re)
    if (!this.hasPrev) {
      this.prevPhase[k] = phase
      this.hasPrev = true
      return null
    }
    const prev = this.prevPhase[k]
    this.prevPhase[k] = phase

    const omega = (2 * Math.PI * k) / fftSize
    // expected phase advance over hop: omega * hop
    const deltaPhi = princarg(phase - prev - omega * hopSize)
    const instOmega = omega + deltaPhi / hopSize
    const hz = (instOmega * sampleRate) / (2 * Math.PI)
    // Clamp to sensible range (avoid numerical jumps)
    if (!Number.isFinite(hz) || hz <= 0 || hz > sampleRate / 2) return null
    return hz
  }

  reset() {
    this.writePos = 0
    this.hasPrev = false
    this.prevPhase.fill(0)
    this.noiseEma = 0
  }
}
