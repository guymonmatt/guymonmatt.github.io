import { Camera } from "./camera.js";
import { FaceTracker } from "./face.js";
import { Segmenter } from "./segmentation.js";
import { Renderer } from "./renderer.js";
import { computeBiomeBlend } from "./biomes.js";
import { Smoother, ambientFromClock } from "./state.js";

const INFERENCE_INTERVAL_MS = 80; // ~12fps for the two ML models

const els = {
  video: document.getElementById("biome-video"),
  canvas: document.getElementById("biome-canvas"),
  label: document.getElementById("biome-label"),
  flip: document.getElementById("biome-flip"),
  intro: document.getElementById("biome-intro"),
  start: document.getElementById("biome-start"),
  error: document.getElementById("biome-error"),
  errorMessage: document.getElementById("biome-error-message"),
  retry: document.getElementById("biome-retry"),
  loading: document.getElementById("biome-loading"),
};

const camera = new Camera(els.video);
const faceTracker = new FaceTracker();
const segmenter = new Segmenter();
// Expression signals (smile, distance, tilt...) track quickly; per-person
// geometry/color signals are smoothed slowly so they settle into a stable
// "signature" instead of jittering with pose or lighting noise.
const smoother = new Smoother(0.12, {
  eyeSpacing: 0.04,
  faceAspect: 0.04,
  noseWidth: 0.04,
  jawWidth: 0.04,
  skinR: 0.05,
  skinG: 0.05,
  skinB: 0.05,
  hairR: 0.05,
  hairG: 0.05,
  hairB: 0.05,
});

let renderer = null;
let running = false;
let lastInferenceTs = 0;
let lastMask = null;
let lastLabel = "";

els.start.addEventListener("click", boot);
els.retry.addEventListener("click", boot);
els.flip.addEventListener("click", async () => {
  try {
    const facing = await camera.flip();
    if (renderer) renderer.mirror = facing === "user";
  } catch (err) {
    showError(Camera.describeError(err));
  }
});

async function boot() {
  if (!Camera.isSupported()) {
    showError("This browser doesn't support camera access. Try Chrome or Safari on a phone.");
    return;
  }

  hide(els.intro);
  hide(els.error);
  show(els.loading);

  try {
    await camera.start("user");
  } catch (err) {
    hide(els.loading);
    showError(Camera.describeError(err));
    return;
  }

  els.flip.hidden = !camera.canFlip;

  if (!renderer) {
    renderer = new Renderer(els.canvas, els.video);
  }
  renderer.mirror = camera.facingMode === "user";

  // Model loading happens in the background; the scene runs in an idle
  // ambient state immediately and gains face-reactivity once ready.
  faceTracker.init().catch(() => {
    /* face tracking degrades to ambient idle drift, handled in the loop */
  });
  segmenter.init().catch(() => {
    /* segmentation unavailable: biome renders full-screen, person cutout skipped */
  });

  hide(els.loading);

  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

function loop(nowMs) {
  if (!running) return;

  if (nowMs - lastInferenceTs >= INFERENCE_INTERVAL_MS) {
    lastInferenceTs = nowMs;
    runInference(nowMs);
  }

  const smoothed = smoother.push(lastFaceSample);
  const ambient = ambientFromClock();
  const state = computeBiomeBlend(smoothed, ambient);

  renderer.draw(state, lastMask);
  updateLabel(state);

  requestAnimationFrame(loop);
}

let lastFaceSample = null;

function runInference(nowMs) {
  try {
    if (faceTracker.ready) {
      lastFaceSample = faceTracker.detect(els.video, nowMs);
    }
  } catch {
    lastFaceSample = null;
  }

  try {
    if (segmenter.ready) {
      lastMask = segmenter.segment(els.video, nowMs);
    }
  } catch {
    lastMask = null;
  }
}

function updateLabel(state) {
  const text = state.hasFace ? state.top.name : `${state.top.name} • idle`;
  if (text !== lastLabel) {
    lastLabel = text;
    els.label.textContent = text;
  }
}

function showError(message) {
  els.errorMessage.textContent = message;
  show(els.error);
}

function show(el) {
  el.hidden = false;
}
function hide(el) {
  el.hidden = true;
}
