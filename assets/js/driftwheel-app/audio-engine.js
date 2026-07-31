import { buildChordFrequencies, CHORD_TYPES, TONES } from './theory.js';

const PAD_ATTACK = 2.4;
const PAD_RELEASE = 2.0;
const NOISE_BUFFER_SECONDS = 2;
const REVERB_SECONDS = 3.2;

// Sustained chord tone. Wraps either oscillator(s) (for the tonal timbres and
// the two-oscillator "glass" blend) or a filtered noise loop (for "Noise
// Wash"), all behind the same fade in/out interface so the engine doesn't
// need to know which one it's holding.
class PadVoice {
  constructor(ctx, destination, frequency, toneType, noiseBuffer) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(destination);
    this.nodes = [];

    if (toneType === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = frequency;
      band.Q.value = 6;
      src.connect(band).connect(this.gain);
      src.start();
      this.nodes.push(src, band);
    } else if (toneType === 'glass') {
      const a = ctx.createOscillator();
      a.type = 'sine';
      a.frequency.value = frequency;
      const b = ctx.createOscillator();
      b.type = 'triangle';
      b.frequency.value = frequency;
      b.detune.value = 8;
      a.connect(this.gain);
      b.connect(this.gain);
      a.start();
      b.start();
      this.nodes.push(a, b);
    } else {
      const osc = ctx.createOscillator();
      osc.type = toneType;
      osc.frequency.value = frequency;
      osc.connect(this.gain);
      osc.start();
      this.nodes.push(osc);
    }
  }

  fadeIn(targetLevel) {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(targetLevel, now + PAD_ATTACK);
  }

  fadeOutAndStop() {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + PAD_RELEASE);
    this.nodes.forEach((node) => {
      if (node.stop) node.stop(now + PAD_RELEASE + 0.1);
    });
    setTimeout(() => {
      this.nodes.forEach((n) => n.disconnect());
      this.gain.disconnect();
    }, (PAD_RELEASE + 0.2) * 1000);
  }

  setLevel(level) {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.linearRampToValueAtTime(level, now + 0.4);
  }
}

function pluckVoice(ctx, destination, frequency, toneType, noiseBuffer, duration, when) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(destination);
  const now = when;
  const attack = 0.015;
  const release = Math.max(0.05, duration * 0.85);
  const peak = 0.5;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + attack + release);

  const nodes = [];
  if (toneType === 'noise') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = frequency;
    band.Q.value = 10;
    src.connect(band).connect(gain);
    src.start(now);
    src.stop(now + attack + release + 0.1);
    nodes.push(src, band);
  } else if (toneType === 'glass') {
    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = frequency;
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = frequency;
    b.detune.value = 8;
    a.connect(gain);
    b.connect(gain);
    a.start(now);
    b.start(now);
    a.stop(now + attack + release + 0.1);
    b.stop(now + attack + release + 0.1);
    nodes.push(a, b);
  } else {
    const osc = ctx.createOscillator();
    osc.type = toneType;
    osc.frequency.value = frequency;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + attack + release + 0.1);
    nodes.push(osc);
  }

  const delayUntilCleanup = Math.max(0, when - ctx.currentTime) + attack + release + 0.2;
  setTimeout(() => {
    nodes.forEach((n) => n.disconnect());
    gain.disconnect();
  }, delayUntilCleanup * 1000);
}

function buildImpulseResponse(ctx) {
  const length = Math.floor(ctx.sampleRate * REVERB_SECONDS);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
  }
  return impulse;
}

function buildNoiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.padVoices = [];
    this.currentFrequencies = [];
    this.currentToneType = 'sine';
    this.arp = {
      enabled: false,
      pattern: 'Up',
      div: 8,
      tempo: 76,
      timerId: null,
      nextNoteTime: 0,
      stepIndex: 0,
      direction: 1,
    };
    this.volume = 0.6;
  }

  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2600;
    this.filter.Q.value = 0.4;

    this.panner = ctx.createStereoPanner();

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = buildImpulseResponse(ctx);
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0.32;
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.85;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this._levelData = new Uint8Array(this.analyser.frequencyBinCount);

    // voices -> filter -> panner -> split to dry + reverb send -> master -> out
    this.filter.connect(this.panner);
    this.panner.connect(this.dryGain);
    this.panner.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.dryGain.connect(this.masterGain);
    this.wetGain.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.voiceBus = this.filter;
    this.noiseBuffer = buildNoiseBuffer(ctx);

    // Slow, gentle filter drift so the pad never feels perfectly static.
    this._lfo = ctx.createOscillator();
    this._lfo.frequency.value = 0.05;
    this._lfoGain = ctx.createGain();
    this._lfoGain.gain.value = 500;
    this._lfo.connect(this._lfoGain);
    this._lfoGain.connect(this.filter.frequency);
    this._lfo.start();

    this._panLfo = ctx.createOscillator();
    this._panLfo.frequency.value = 0.03;
    this._panLfoGain = ctx.createGain();
    this._panLfoGain.gain.value = 0.4;
    this._panLfo.connect(this._panLfoGain);
    this._panLfoGain.connect(this.panner.pan);
    this._panLfo.start();
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  getLevel() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this._levelData);
    let sum = 0;
    for (let i = 0; i < this._levelData.length; i++) sum += this._levelData[i];
    return sum / this._levelData.length / 255;
  }

  setChord(rootPitchClass, chordTypeIndex, toneIndex) {
    const chordType = CHORD_TYPES[chordTypeIndex];
    const toneType = TONES[toneIndex].type;
    const frequencies = buildChordFrequencies(rootPitchClass, chordType.intervals);
    this.currentFrequencies = frequencies;
    this.currentToneType = toneType;
    this._retriggerPad(frequencies, toneType);
  }

  setTone(toneIndex) {
    this.currentToneType = TONES[toneIndex].type;
    this._retriggerPad(this.currentFrequencies, this.currentToneType);
  }

  _retriggerPad(frequencies, toneType) {
    if (!this.ctx) return;
    const old = this.padVoices;
    const perVoiceLevel = 0.22 / Math.sqrt(Math.max(1, frequencies.length));
    this.padVoices = frequencies.map((freq) => {
      const voice = new PadVoice(this.ctx, this.voiceBus, freq, toneType, this.noiseBuffer);
      voice.fadeIn(perVoiceLevel);
      return voice;
    });
    old.forEach((voice) => voice.fadeOutAndStop());
  }

  setVolume(v) {
    this.volume = v;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.linearRampToValueAtTime(v, now + 0.1);
  }

  setArpEnabled(enabled) {
    this.arp.enabled = enabled;
    if (enabled) this._startArpScheduler();
    else this._stopArpScheduler();
  }

  setArpPattern(pattern) {
    this.arp.pattern = pattern;
    this.arp.stepIndex = 0;
    this.arp.direction = 1;
  }

  setArpRate(div) {
    this.arp.div = div;
  }

  setTempo(bpm) {
    this.arp.tempo = bpm;
  }

  _startArpScheduler() {
    if (this.arp.timerId) return;
    this.arp.nextNoteTime = this.ctx.currentTime + 0.05;
    this.arp.stepIndex = 0;
    this.arp.direction = 1;
    this.arp.timerId = setInterval(() => this._scheduleArpNotes(), 25);
  }

  _stopArpScheduler() {
    if (this.arp.timerId) {
      clearInterval(this.arp.timerId);
      this.arp.timerId = null;
    }
  }

  _nextArpIndex(length) {
    const { pattern } = this.arp;
    if (pattern === 'Random') return Math.floor(Math.random() * length);

    if (pattern === 'Down') {
      const idx = this.arp.stepIndex;
      this.arp.stepIndex = (this.arp.stepIndex - 1 + length) % length;
      return length - 1 - idx;
    }

    if (pattern === 'Up-Down') {
      const span = length > 1 ? length * 2 - 2 : 1;
      const pos = this.arp.stepIndex % span;
      this.arp.stepIndex++;
      return pos < length ? pos : span - pos;
    }

    // 'Up'
    const idx = this.arp.stepIndex % length;
    this.arp.stepIndex++;
    return idx;
  }

  _scheduleArpNotes() {
    const lookahead = 0.15;
    const frequencies = this.currentFrequencies;
    if (!frequencies.length) return;
    const noteDuration = (60 / this.arp.tempo) * (4 / this.arp.div);

    while (this.arp.nextNoteTime < this.ctx.currentTime + lookahead) {
      const idx = this._nextArpIndex(frequencies.length);
      const freq = frequencies[idx] * 2; // an octave up so the pluck cuts through the pad
      pluckVoice(this.ctx, this.voiceBus, freq, this.currentToneType, this.noiseBuffer, noteDuration, this.arp.nextNoteTime);
      this.arp.nextNoteTime += noteDuration;
    }
  }

  stopAll() {
    this._stopArpScheduler();
    this.padVoices.forEach((voice) => voice.fadeOutAndStop());
    this.padVoices = [];
  }
}
