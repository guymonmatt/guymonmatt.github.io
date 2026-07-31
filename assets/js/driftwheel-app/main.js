import { NOTE_NAMES, CHORD_TYPES, TONES, ARP_PATTERNS, ARP_RATES } from './theory.js';
import { Wheel } from './wheel.js';
import { AudioEngine } from './audio-engine.js';

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
};

let rootIndex = 0; // C
let chordTypeIndex = 0; // Major
let toneIndex = 0; // Warm Sine
let playing = false;

function updateChordLabel() {
  els.chordLabel.textContent = `${NOTE_NAMES[rootIndex]} ${CHORD_TYPES[chordTypeIndex].name}`;
}

function applyChord() {
  updateChordLabel();
  if (playing) engine.setChord(rootIndex, chordTypeIndex, toneIndex);
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
    if (playing) engine.setTone(toneIndex);
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

els.arpToggle.addEventListener('change', () => {
  engine.setArpEnabled(els.arpToggle.checked);
});

els.tempo.addEventListener('input', () => {
  const bpm = Number(els.tempo.value);
  engine.setTempo(bpm);
  els.tempoValue.textContent = `${bpm}`;
});

els.volume.addEventListener('input', () => {
  engine.setVolume(Number(els.volume.value) / 100);
});

els.playToggle.addEventListener('click', () => {
  playing = !playing;
  if (playing) {
    engine.setChord(rootIndex, chordTypeIndex, toneIndex);
    if (els.arpToggle.checked) engine.setArpEnabled(true);
    els.playToggle.textContent = 'Pause';
    els.playToggle.classList.add('is-playing');
  } else {
    engine.stopAll();
    els.playToggle.textContent = 'Play';
    els.playToggle.classList.remove('is-playing');
  }
});

async function start() {
  engine.init();
  await engine.resume();
  engine.setVolume(Number(els.volume.value) / 100);
  engine.setTempo(Number(els.tempo.value));
  engine.setArpRate(ARP_RATES[arpRateWheel.index].div);
  engine.setArpPattern(ARP_PATTERNS[arpPatternWheel.index]);

  els.intro.hidden = true;
  els.app.classList.add('is-active');
  updateChordLabel();

  playing = true;
  engine.setChord(rootIndex, chordTypeIndex, toneIndex);
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
    const hue = (rootIndex / 12) * 360;
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
