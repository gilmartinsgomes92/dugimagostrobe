const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export type NoteInfo = {
  midi: number
  name: string
  freq: number
}

export function freqToMidi(freq: number): number {
  // A4 = 440Hz -> midi 69
  return 69 + 12 * Math.log2(freq / 440)
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function nearestNote(freq: number): NoteInfo {
  const midiFloat = freqToMidi(freq)
  const midi = Math.round(midiFloat)
  const name = NOTE_NAMES[(midi % 12 + 12) % 12] + String(Math.floor(midi / 12) - 1)
  const f = midiToFreq(midi)
  return { midi, name, freq: f }
}

export function centsBetween(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target)
}
