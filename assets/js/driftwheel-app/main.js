import { NOTE_NAMES, CHORD_TYPES, TONES, TWINKLE_TONES, ARP_PATTERNS, ARP_RATES } from './theory.js';
import { Wheel } from './wheel.js';
import { AudioEngine } from './audio-engine.js';
import { Sequencer } from './sequencer.js';
import { TouchPad } from './touchpad.js';

const engine = new AudioEngine();

const els = {
  intro: document.getElementById('driftwheel-intro'),
  start: document.getElementById('driftwheel-start'),
  app: document.getElementById('driftwheel-app'),
  playToggle: document.getElementById('driftwheel-play'),
  arpToggle: document.getElementById('driftwheel-arp-toggle'),
  tempo: document.getElementById('driftwheel-tempo'),
  tempoValue: document.getElementById('driftwheel-tempo-value'),
  volume: document.getElementById('driftwheel-volume'),
  chordLabel: document.getElementById('driftwheel-chord-label'),
  canvas: document.getElementById('driftwheel-canvas'),
  seqToggle: document.getElementById('driftwheel-seq-toggle'),
  seqClear: document.getElementById('driftwheel-seq-clear'),
  seqGrid: document.getElementById('driftwheel-seq-grid'),
  windToggle: document.getElementById('driftwheel-wind-toggle'),
  twinkleToggle: document.getElementById('driftwheel-twinkle-toggle'),
  twinklePad: document.getElementById('driftwheel-twinkle-pad'),
  twinkleVolume: document.getElementById('driftwheel-twinkle-volume'),
  delayToggle: document.getElementById('driftwheel-delay-toggle'),
  reverb: document.getElementById('driftwheel-reverb'),
};

let rootIndex = 0; // C
let chordTypeIndex = 0; // Major
let toneIndex = 0; // Warm Sine
let playing = false;
// When a sequencer step tile is selected, the wheels edit that step instead
// of the live chord — see applyChord() and the tone wheel's onChange below.
let selectedStepIndex = null;
// Root note driving the background glow's hue — tracks the wheels normally,
// but follows the sequencer's active step while it's playing (see
// handleSequencerStep below) so the glow matches what's actually sounding.
let activeRootIndex = rootIndex;

function updateChordLabel() {
  activeRootIndex = rootIndex;
  els.chordLabel.textContent = `${NOTE_NAMES[rootIndex]} ${CHORD_TYPES[chordTypeIndex].name}`;
}

function applyChord() {
  updateChordLabel();
  if (selectedStepIndex !== null) {
    sequencer.setSelectedStep({ rootIndex, chordTypeIndex, toneIndex });
  } else if (playing) {
    engine.setChord(rootIndex, chordTypeIndex, toneIndex);
  }
}

const rootWheel = new Wheel({
  container: document.getElementById('driftwheel-wheel-root'),
  options: NOTE_NAMES,
  index: rootIndex,
  label: 'Root note',
  onChange: (i) => {
    rootIndex = i;
    applyChord();
  },
});

const typeWheel = new Wheel({
  container: document.getElementById('driftwheel-wheel-type'),
  options: CHORD_TYPES.map((c) => c.name),
  index: chordTypeIndex,
  label: 'Chord type',
  onChange: (i) => {
    chordTypeIndex = i;
    applyChord();
  },
});

const toneWheel = new Wheel({
  container: document.getElementById('driftwheel-wheel-tone'),
  options: TONES.map((t) => t.name),
  index: toneIndex,
  label: 'Synth tone',
  onChange: (i) => {
    toneIndex = i;
    if (selectedStepIndex !== null) {
      sequencer.setSelectedStep({ rootIndex, chordTypeIndex, toneIndex });
    } else if (playing) {
      engine.setTone(toneIndex);
    }
  },
});

const arpPatternWheel = new Wheel({
  container: document.getElementById('driftwheel-wheel-arp-pattern'),
  options: ARP_PATTERNS,
  index: 0,
  label: 'Arp pattern',
  onChange: (i) => engine.setArpPattern(ARP_PATTERNS[i]),
});

const arpRateWheel = new Wheel({
  container: document.getElementById('driftwheel-wheel-arp-rate'),
  options: ARP_RATES.map((r) => r.name),
  index: 2,
  label: 'Arp rate',
  onChange: (i) => engine.setArpRate(ARP_RATES[i].div),
});

engine.setArpRate(ARP_RATES[2].div);

const sequencer = new Sequencer({
  container: els.seqGrid,
  onSelect: (index, step) => {
    selectedStepIndex = index;
    els.seqClear.hidden = index === null;
    if (index === null) return;
    if (step) {
      // Sync the wheels to reflect this existing step's stored values.
      rootIndex = step.rootIndex;
      chordTypeIndex = step.chordTypeIndex;
      toneIndex = step.toneIndex;
      rootWheel.scrollToIndex(step.rootIndex, true);
      typeWheel.scrollToIndex(step.chordTypeIndex, true);
      toneWheel.scrollToIndex(step.toneIndex, true);
      updateChordLabel();
    } else {
      // An empty tile was just selected: fill it with whatever's dialed in.
      sequencer.setSelectedStep({ rootIndex, chordTypeIndex, toneIndex });
    }
  },
  onChange: (steps) => engine.setSequence(steps),
});
engine.setSequence(sequencer.steps);

// While the sequence plays, show whichever step is currently sounding at
// the top — unless a tile is being edited, in which case that edit takes
// priority (handled by updateChordLabel()/applyChord() elsewhere).
function handleSequencerStep(i) {
  sequencer.setPlayingIndex(i);
  if (selectedStepIndex !== null) return;
  const step = sequencer.steps[i];
  if (step) activeRootIndex = step.rootIndex;
  els.chordLabel.textContent = step ? `${NOTE_NAMES[step.rootIndex]} ${CHORD_TYPES[step.chordTypeIndex].name}` : '—';
}

els.seqToggle.addEventListener('change', () => {
  if (!playing) return;
  if (els.seqToggle.checked) {
    engine.setSequencerEnabled(true, handleSequencerStep);
  } else {
    engine.setSequencerEnabled(false);
    sequencer.setPlayingIndex(null);
    // Hand control back to the wheels' current live chord.
    engine.setChord(rootIndex, chordTypeIndex, toneIndex);
    if (selectedStepIndex === null) updateChordLabel();
  }
});

els.seqClear.addEventListener('click', () => {
  sequencer.clearSelectedStep();
});

els.arpToggle.addEventListener('change', () => {
  engine.setArpEnabled(els.arpToggle.checked);
});

els.windToggle.addEventListener('change', () => {
  engine.setWindEnabled(els.windToggle.checked);
});

els.twinkleToggle.addEventListener('change', () => {
  engine.setTwinkleEnabled(els.twinkleToggle.checked);
});

els.delayToggle.addEventListener('change', () => {
  engine.setDelayEnabled(els.delayToggle.checked);
});

els.reverb.addEventListener('input', () => {
  engine.setReverbAmount(Number(els.reverb.value) / 100);
});

// Defaults (0.33, 0.4) reproduce the twinkle sound as originally shipped;
// see the matching defaults in AudioEngine's constructor.
const twinklePad = new TouchPad({
  container: els.twinklePad,
  x: 0.33,
  y: 0.4,
  onChange: (x, y) => {
    engine.setTwinkleOctaveRange(x);
    engine.setTwinkleDensity(y);
  },
});

const twinkleToneWheel = new Wheel({
  container: document.getElementById('driftwheel-wheel-twinkle-tone'),
  options: TWINKLE_TONES.map((t) => t.name),
  index: 0,
  label: 'Twinkle tone',
  onChange: (i) => engine.setTwinkleTone(i),
});

els.twinkleVolume.addEventListener('input', () => {
  engine.setTwinkleVolume(Number(els.twinkleVolume.value) / 100);
});

els.tempo.addEventListener('input', () => {
  const bpm = Number(els.tempo.value);
  engine.setTempo(bpm);
  els.tempoValue.textContent = `${bpm}`;
});

els.volume.addEventListener('input', () => {
  engine.setVolume(Number(els.volume.value) / 100);
});

// Starts either the step sequencer or a plain held chord, then layers the
// arp on top either way (it always arpeggiates whatever the engine is
// currently sounding, sequenced or not).
function beginPlayback() {
  if (els.seqToggle.checked) {
    engine.setSequencerEnabled(true, handleSequencerStep);
  } else {
    engine.setChord(rootIndex, chordTypeIndex, toneIndex);
  }
  if (els.arpToggle.checked) engine.setArpEnabled(true);
  if (els.windToggle.checked) engine.setWindEnabled(true);
  if (els.twinkleToggle.checked) engine.setTwinkleEnabled(true);
  if (els.delayToggle.checked) engine.setDelayEnabled(true);
}

els.playToggle.addEventListener('click', () => {
  playing = !playing;
  if (playing) {
    beginPlayback();
    els.playToggle.textContent = 'Pause';
    els.playToggle.classList.add('is-playing');
  } else {
    engine.stopAll();
    sequencer.setPlayingIndex(null);
    els.playToggle.textContent = 'Play';
    els.playToggle.classList.remove('is-playing');
  }
});

async function start() {
  try {
    engine.init();
    await engine.resume();
    engine.setVolume(Number(els.volume.value) / 100);
    engine.setTempo(Number(els.tempo.value));
    engine.setArpRate(ARP_RATES[arpRateWheel.index].div);
    engine.setArpPattern(ARP_PATTERNS[arpPatternWheel.index]);
    engine.setTwinkleOctaveRange(twinklePad.x);
    engine.setTwinkleDensity(twinklePad.y);
    engine.setTwinkleVolume(Number(els.twinkleVolume.value) / 100);
    engine.setTwinkleTone(twinkleToneWheel.index);
    engine.setReverbAmount(Number(els.reverb.value) / 100);
  } catch (err) {
    // Whatever went wrong with the audio graph, don't leave the intro card
    // stuck forever — show the panel so the wheels/back button still work.
    console.error('Driftwheel failed to start audio:', err);
  }

  els.intro.hidden = true;
  els.app.classList.add('is-active');
  updateChordLabel();

  playing = true;
  beginPlayback();
  els.playToggle.textContent = 'Pause';
  els.playToggle.classList.add('is-playing');

  startVisualizer();
}

els.start.addEventListener('click', start);

// Soft, slowly drifting glow field behind the UI. Hue tracks the root note,
// brightness breathes gently with the pad's output level.
function startVisualizer() {
  const ctx2d = els.canvas.getContext('2d');
  let w, h;
  function resize() {
    w = els.canvas.width = els.canvas.clientWidth * devicePixelRatio;
    h = els.canvas.height = els.canvas.clientHeight * devicePixelRatio;
  }
  resize();
  window.addEventListener('resize', resize);

  let t = 0;
  function frame() {
    t += 0.004;
    const level = engine.getLevel();
    const hue = (activeRootIndex / 12) * 360;
    ctx2d.fillStyle = 'rgba(6, 10, 16, 0.18)';
    ctx2d.fillRect(0, 0, w, h);

    const cx = w / 2 + Math.sin(t * 0.7) * w * 0.18;
    const cy = h / 2 + Math.cos(t * 0.5) * h * 0.18;
    const radius = Math.max(w, h) * (0.35 + level * 0.25);
    const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `hsla(${hue}, 70%, ${45 + level * 25}%, 0.35)`);
    grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, w, h);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
