/**
 * Tiny radix-2 FFT for real input producing complex spectrum.
 * Optimized enough for 2048/4096 on mobile.
 */
export type ComplexArray = { re: Float32Array; im: Float32Array }

function reverseBits(x: number, bits: number): number {
  let y = 0
  for (let i = 0; i < bits; i++) {
    y = (y << 1) | (x & 1)
    x >>>= 1
  }
  return y
}

export class FFT {
  readonly size: number
  readonly levels: number
  private readonly cosTable: Float32Array
  private readonly sinTable: Float32Array
  private readonly bitRev: Uint32Array

  constructor(size: number) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be power of 2')
    this.size = size
    this.levels = Math.log2(size) | 0
    this.cosTable = new Float32Array(size / 2)
    this.sinTable = new Float32Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      const angle = (2 * Math.PI * i) / size
      this.cosTable[i] = Math.cos(angle)
      this.sinTable[i] = Math.sin(angle)
    }
    this.bitRev = new Uint32Array(size)
    for (let i = 0; i < size; i++) this.bitRev[i] = reverseBits(i, this.levels)
  }

  forwardReal(input: Float32Array, out?: ComplexArray): ComplexArray {
    const n = this.size
    const re = out?.re ?? new Float32Array(n)
    const im = out?.im ?? new Float32Array(n)
    // Bit-reversed copy
    for (let i = 0; i < n; i++) {
      re[i] = input[this.bitRev[i]]
      im[i] = 0
    }
    // Cooley–Tukey
    for (let size = 2; size <= n; size <<= 1) {
      const halfsize = size >>> 1
      const tablestep = n / size
      for (let i = 0; i < n; i += size) {
        let k = 0
        for (let j = i; j < i + halfsize; j++) {
          const l = j + halfsize
          const tpre = re[l] * this.cosTable[k] + im[l] * this.sinTable[k]
          const tpim = -re[l] * this.sinTable[k] + im[l] * this.cosTable[k]
          re[l] = re[j] - tpre
          im[l] = im[j] - tpim
          re[j] = re[j] + tpre
          im[j] = im[j] + tpim
          k += tablestep
        }
      }
    }
    return { re, im }
  }
}

export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n)
  const denom = n - 1
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom))
  }
  return w
}

export function princarg(x: number): number {
  // Wrap to (-pi, pi]
  x = (x + Math.PI) % (2 * Math.PI)
  if (x < 0) x += 2 * Math.PI
  return x - Math.PI
}

export function mag2(re: number, im: number): number {
  return re * re + im * im
}
