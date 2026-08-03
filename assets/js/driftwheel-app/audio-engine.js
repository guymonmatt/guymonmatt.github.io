import { buildChordFrequencies, CHORD_TYPES, TONES, TWINKLE_TONES } from './theory.js';

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

// A short, soft bell-like ping used for the "twinkle" ambience layer: a
// fundamental plus a quiet upper partial at an integer harmonic ratio (so
// it's always consonant with the fundamental regardless of key — the
// shimmer never clashes with the current chord). Fast attack, slow
// randomized decay so no two twinkles sound identical. Frequency is chosen
// by the caller from the current chord's own tones, transposed up into a
// high, glassy register.
function twinkleVoice(ctx, destination, frequency, when, options) {
  const { waveform, partialRatio, volume } = options;
  const attack = 0.008;
  const decay = 1.6 + Math.random() * 1.4;
  const peak = (0.09 + Math.random() * 0.06) * volume * 2;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, when + attack + decay);

  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() * 2 - 1) * 0.7;
  gain.connect(pan).connect(destination);

  const osc = ctx.createOscillator();
  osc.type = waveform;
  osc.frequency.value = frequency;
  osc.connect(gain);

  const partial = ctx.createOscillator();
  partial.type = waveform;
  partial.frequency.value = frequency * partialRatio;
  const partialGain = ctx.createGain();
  partialGain.gain.value = 0.2;
  partial.connect(partialGain).connect(gain);

  const stopAt = when + attack + decay + 0.1;
  osc.start(when);
  partial.start(when);
  osc.stop(stopAt);
  partial.stop(stopAt);

  const cleanupDelay = Math.max(0, when - ctx.currentTime) + attack + decay + 0.2;
  setTimeout(() => {
    osc.disconnect();
    partial.disconnect();
    partialGain.disconnect();
    gain.disconnect();
    pan.disconnect();
  }, cleanupDelay * 1000);
}

// Brown-ish noise (a leaky integral of white noise, normalized): weighted
// toward low frequencies, a much more organic base for a wind texture than
// flat white noise. Looped and shaped further with filters in the engine.
function buildWindBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 6);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last;
    peak = Math.max(peak, Math.abs(last));
  }
  const norm = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < length; i++) data[i] *= norm;
  return buffer;
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

    // Chord sequencer: steps in a fixed-length array, each either null
    // (a rest) or { rootIndex, chordTypeIndex, toneIndex }. Shares the
    // "tempo" set via setTempo() with the arp, at a fixed 4 beats/step.
    this.sequence = [];
    this.seq = {
      enabled: false,
      stepBeats: 4,
      stepIndex: -1,
      timerId: null,
      nextStepTime: 0,
      onStepChange: null,
    };

    // Ambience layers: generative wind + twinkle, independent of the pad.
    // octaveRange/density are normalized 0-1 touchpad axes (X/Y); volume is
    // a 0-1 scalar; toneIndex picks from TWINKLE_TONES. Defaults reproduce
    // the original fixed twinkle sound before these became adjustable.
    this.twinkle = {
      enabled: false,
      timerId: null,
      nextTime: 0,
      octaveRange: 0.33,
      density: 0.4,
      volume: 0.5,
      toneIndex: 0,
    };
    this.windEnabled = false;

    // Effects sends. reverbAmount matches the convolver's original fixed
    // wet level (0.32 / 0.7 ≈ 0.46) so the default sound doesn't change.
    this.reverbAmount = 0.46;
    this.delayEnabled = false;
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
    this.wetGain.gain.value = this.reverbAmount * 0.7;
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.85;

    // Echo send: a feedback delay line, tempo-synced (see setTempo), tapping
    // the same pre-reverb signal as the dry/wet reverb split above. Off
    // (delayWet at 0) until setDelayEnabled(true).
    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.5;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.35;
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 2800; // keeps repeats from building up brightness
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this._levelData = new Uint8Array(this.analyser.frequencyBinCount);

    // voices -> filter -> panner -> {dry, reverb send, delay send} -> master -> out
    this.filter.connect(this.panner);
    this.panner.connect(this.dryGain);
    this.panner.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.dryGain.connect(this.masterGain);
    this.wetGain.connect(this.masterGain);

    this.panner.connect(this.delay);
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay); // feedback loop
    this.delayFilter.connect(this.delayWet);
    this.delayWet.connect(this.masterGain);

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

    // Wind: looping filtered brown noise, always running under the hood at
    // zero gain until enabled, with its own slow filter-sweep, gust, and
    // pan LFOs so it drifts independently of the pad.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windPan = ctx.createStereoPanner();
    this.windFilter.connect(this.windGain).connect(this.windPan).connect(this.voiceBus);

    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = buildWindBuffer(ctx);
    this.windSource.loop = true;
    this.windSource.connect(this.windFilter);
    this.windSource.start();

    this._windFilterLfo = ctx.createOscillator();
    this._windFilterLfo.frequency.value = 0.04;
    this._windFilterLfoGain = ctx.createGain();
    this._windFilterLfoGain.gain.value = 350;
    this._windFilterLfo.connect(this._windFilterLfoGain).connect(this.windFilter.frequency);
    this._windFilterLfo.start();

    this._windGustLfo = ctx.createOscillator();
    this._windGustLfo.frequency.value = 0.07;
    this._windGustLfoGain = ctx.createGain();
    this._windGustLfoGain.gain.value = 0; // ramped up in setWindEnabled()
    this._windGustLfo.connect(this._windGustLfoGain).connect(this.windGain.gain);
    this._windGustLfo.start();

    this._windPanLfo = ctx.createOscillator();
    this._windPanLfo.frequency.value = 0.025;
    this._windPanLfoGain = ctx.createGain();
    this._windPanLfoGain.gain.value = 0.5;
    this._windPanLfo.connect(this._windPanLfoGain).connect(this.windPan.pan);
    this._windPanLfo.start();
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

  // v: 0 (no reverb) to 1 (max wet). 1 maps to a 0.7 wet gain — lush, but
  // short of drowning the dry signal, which stays fixed.
  setReverbAmount(v) {
    this.reverbAmount = v;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.wetGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.linearRampToValueAtTime(v * 0.7, now + 0.2);
  }

  setDelayEnabled(enabled) {
    this.delayEnabled = enabled;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.delayWet.gain.cancelScheduledValues(now);
    this.delayWet.gain.setValueAtTime(this.delayWet.gain.value, now);
    this.delayWet.gain.linearRampToValueAtTime(enabled ? 0.28 : 0, now + 1.2);
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
    // Keep the echo in the same rhythmic pocket as the arp/sequencer: a
    // dotted-eighth delay relative to the current tempo.
    if (this.delay) this.delay.delayTime.setTargetAtTime((60 / bpm) * 0.75, this.ctx.currentTime, 0.05);
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

  setSequence(steps) {
    this.sequence = steps;
  }

  setSequencerEnabled(enabled, onStepChange) {
    this.seq.enabled = enabled;
    this.seq.onStepChange = onStepChange || null;
    if (enabled) this._startSequencer();
    else this._stopSequencer();
  }

  _startSequencer() {
    if (this.seq.timerId || !this.ctx) return;
    this.seq.stepIndex = -1;
    this.seq.nextStepTime = this.ctx.currentTime;
    this._advanceStep();
    this.seq.timerId = setInterval(() => {
      if (this.ctx.currentTime >= this.seq.nextStepTime) this._advanceStep();
    }, 50);
  }

  _stopSequencer() {
    if (this.seq.timerId) {
      clearInterval(this.seq.timerId);
      this.seq.timerId = null;
    }
  }

  _advanceStep() {
    const length = this.sequence.length;
    if (!length) return;
    this.seq.stepIndex = (this.seq.stepIndex + 1) % length;
    const stepDuration = (60 / this.arp.tempo) * this.seq.stepBeats;
    this.seq.nextStepTime = this.ctx.currentTime + stepDuration;

    const step = this.sequence[this.seq.stepIndex];
    if (step) {
      this.setChord(step.rootIndex, step.chordTypeIndex, step.toneIndex);
    } else {
      // A rest: fade the pad out without starting anything new.
      this.currentFrequencies = [];
      this._retriggerPad([], this.currentToneType);
    }

    if (this.seq.onStepChange) this.seq.onStepChange(this.seq.stepIndex);
  }

  setWindEnabled(enabled) {
    this.windEnabled = enabled;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const target = enabled ? 0.12 : 0;
    const gustTarget = enabled ? 0.04 : 0;
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setValueAtTime(this.windGain.gain.value, now);
    this.windGain.gain.linearRampToValueAtTime(target, now + 2.5);
    this._windGustLfoGain.gain.cancelScheduledValues(now);
    this._windGustLfoGain.gain.setValueAtTime(this._windGustLfoGain.gain.value, now);
    this._windGustLfoGain.gain.linearRampToValueAtTime(gustTarget, now + 2.5);
  }

  setTwinkleEnabled(enabled) {
    this.twinkle.enabled = enabled;
    if (enabled) this._startTwinkle();
    else this._stopTwinkle();
  }

  // x: 0 (low, ~1 octave up) to 1 (high, ~4 octaves up).
  setTwinkleOctaveRange(x) {
    this.twinkle.octaveRange = x;
  }

  // y: 0 (dense, frequent) to 1 (sparse, rare).
  setTwinkleDensity(y) {
    this.twinkle.density = y;
  }

  setTwinkleVolume(v) {
    this.twinkle.volume = v;
  }

  setTwinkleTone(index) {
    this.twinkle.toneIndex = index;
  }

  _startTwinkle() {
    if (this.twinkle.timerId || !this.ctx) return;
    this.twinkle.nextTime = this.ctx.currentTime + 0.6;
    this.twinkle.timerId = setInterval(() => this._scheduleTwinkle(), 150);
  }

  _stopTwinkle() {
    if (this.twinkle.timerId) {
      clearInterval(this.twinkle.timerId);
      this.twinkle.timerId = null;
    }
  }

  _twinkleOctaveMultiplier() {
    const center = 1 + this.twinkle.octaveRange * 3; // 1 to 4 octaves up
    const choices = [center - 1, center, center, center + 1].map((o) => Math.max(1, Math.round(o)));
    const octaves = choices[Math.floor(Math.random() * choices.length)];
    return Math.pow(2, octaves); // integer octaves only, so the pitch class never shifts
  }

  _twinkleNextGap() {
    const y = this.twinkle.density;
    const minGap = 0.25 + y * (2.5 - 0.25);
    const maxGap = 0.9 + y * (6 - 0.9);
    return minGap + Math.random() * (maxGap - minGap);
  }

  _scheduleTwinkle() {
    const lookahead = 0.6;
    while (this.twinkle.nextTime < this.ctx.currentTime + lookahead) {
      const frequencies = this.currentFrequencies;
      if (frequencies.length) {
        const base = frequencies[Math.floor(Math.random() * frequencies.length)];
        const tone = TWINKLE_TONES[this.twinkle.toneIndex] || TWINKLE_TONES[0];
        twinkleVoice(this.ctx, this.voiceBus, base * this._twinkleOctaveMultiplier(), this.twinkle.nextTime, {
          waveform: tone.waveform,
          partialRatio: tone.partialRatio,
          volume: this.twinkle.volume,
        });
      }
      // Sparse, irregular gaps rather than a fixed rhythm.
      this.twinkle.nextTime += this._twinkleNextGap();
    }
  }

  stopAll() {
    this._stopArpScheduler();
    this._stopSequencer();
    this.setWindEnabled(false);
    this._stopTwinkle();
    this.padVoices.forEach((voice) => voice.fadeOutAndStop());
    this.padVoices = [];
  }
}
