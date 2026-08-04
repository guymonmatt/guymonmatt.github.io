// Music theory data + helpers shared by the audio engine and the UI wheels.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const CHORD_TYPES = [
  { name: 'Major', intervals: [0, 4, 7] },
  { name: 'Minor', intervals: [0, 3, 7] },
  { name: 'Sus2', intervals: [0, 2, 7] },
  { name: 'Sus4', intervals: [0, 5, 7] },
  { name: 'Maj7', intervals: [0, 4, 7, 11] },
  { name: 'Min7', intervals: [0, 3, 7, 10] },
  { name: 'Dom7', intervals: [0, 4, 7, 10] },
  { name: 'Add9', intervals: [0, 4, 7, 14] },
  { name: 'Dim', intervals: [0, 3, 6] },
  { name: 'Aug', intervals: [0, 4, 8] },
];

export const TONES = [
  { name: 'Warm Sine', type: 'sine', short: 'Sine' },
  { name: 'Soft Triangle', type: 'triangle', short: 'Tri' },
  { name: 'Bright Saw', type: 'sawtooth', short: 'Saw' },
  { name: 'Hollow Square', type: 'square', short: 'Sqr' },
  { name: 'Glass', type: 'glass', short: 'Glass' },
  { name: 'Noise Wash', type: 'noise', short: 'Noise' },
];

// Timbres for the twinkle ambience layer: each pairs an oscillator waveform
// with a harmonic partial ratio (an integer multiple of the fundamental, so
// it's always consonant with whatever chord tone the twinkle is voicing).
export const TWINKLE_TONES = [
  { name: 'Bell', waveform: 'sine', partialRatio: 3 },
  { name: 'Chime', waveform: 'sine', partialRatio: 4 },
  { name: 'Glass', waveform: 'triangle', partialRatio: 2 },
  { name: 'Crystal', waveform: 'sine', partialRatio: 6 },
];

// Inversion wheel: a fixed 0-6 range regardless of chord size. For a chord
// with N tones, values cycle through its N inversions (0 = root position)
// and then keep going — each full cycle past N pushes the whole chord up
// another octave, so the same control doubles as a quick octave-shift once
// you run out of new inversions to reach (e.g. a triad's value 3 is root
// position again, just an octave up; value 6 is root position two octaves
// up).
export const MAX_INVERSION = 6;

export const ARP_PATTERNS = ['Up', 'Down', 'Up-Down', 'Random'];

export const ARP_RATES = [
  { name: '1/2', div: 2 },
  { name: '1/4', div: 4 },
  { name: '1/8', div: 8 },
  { name: '1/8T', div: 12 },
  { name: '1/16', div: 16 },
];

// A4 = 440Hz, MIDI note 69. midi = (octave + 1) * 12 + pitchClass.
export function noteFrequency(pitchClass, octave) {
  const midi = (octave + 1) * 12 + pitchClass;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Voices a chord as an array of frequencies, spreading intervals wider than
// an octave (e.g. Add9's 14) up into higher octaves automatically.
//
// `inversion` rotates which tone lands at the bottom of the voicing: the
// bottom `inversion % intervals.length` tones move up an octave to the top
// (standard chord inversion), and every full trip through that cycle
// (`Math.floor(inversion / intervals.length)`) shifts the entire chord up
// one more octave on top of that.
export function buildChordFrequencies(rootPitchClass, intervals, baseOctave = 3, inversion = 0) {
  const n = intervals.length;
  const cyclePosition = ((inversion % n) + n) % n;
  const octaveShift = Math.floor(inversion / n);
  const rotated = intervals
    .slice(cyclePosition)
    .concat(intervals.slice(0, cyclePosition).map((iv) => iv + 12));

  return rotated.map((interval) => {
    const semitones = rootPitchClass + interval + octaveShift * 12;
    const octave = baseOctave + Math.floor(semitones / 12);
    const pitchClass = ((semitones % 12) + 12) % 12;
    return noteFrequency(pitchClass, octave);
  });
}
