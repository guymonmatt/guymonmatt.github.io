import { Camera } from "./camera.js";
import { FaceTracker } from "./face.js";
import { Segmenter } from "./segmentation.js";
import { Forest3D } from "./scene3d.js";
import { PersonOverlay } from "./personOverlay.js";
import { computePsychedelicState } from "./psychedelic.js";
import { Smoother, Pulse, ambientFromClock } from "./state.js";

const INFERENCE_INTERVAL_MS = 80; // ~12fps for the two ML models
const BLINK_THRESHOLD = 0.5;
const MOUTH_OPEN_THRESHOLD = 0.35;

const els = {
  video: document.getElementById("psyforest-video"),
  canvas: document.getElementById("psyforest-canvas"),
  overlay: document.getElementById("psyforest-overlay"),
  label: document.getElementById("psyforest-label"),
  flip: document.getElementById("psyforest-flip"),
  intro: document.getElementById("psyforest-intro"),
  start: document.getElementById("psyforest-start"),
  error: document.getElementById("psyforest-error"),
  errorMessage: document.getElementById("psyforest-error-message"),
  retry: document.getElementById("psyforest-retry"),
  loading: document.getElementById("psyforest-loading"),
};

const camera = new Camera(els.video);
const faceTracker = new FaceTracker();
const segmenter = new Segmenter();

const smoother = new Smoother(0.28, {
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

const blinkPulse = new Pulse(2.5);
const gustPulse = new Pulse(1.2);
let wasBlinking = false;
let wasMouthOpen = false;

let forest = null;
let personOverlay = null;
let running = false;
let lastInferenceTs = 0;
let lastMask = null;
let lastFaceSample = null;
let lastLabel = "";
let lastLoopTs = null;
let sceneTime = 0;

els.start.addEventListener("click", boot);
els.retry.addEventListener("click", boot);
els.flip.addEventListener("click", async () => {
  try {
    const facing = await camera.flip();
    if (personOverlay) personOverlay.mirror = facing === "user";
  } catch (err) {
    showError(Camera.describeError(err));
  }
});

async function boot() {
  if (!Camera.isSupported()) {
    showError("This browser doesn't support camera access. Try Chrome or Safari on a phone.");
    return;
  }
  if (!window.WebGLRenderingContext) {
    showError("This browser doesn't support WebGL, which this page needs.");
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

  if (!forest) forest = new Forest3D(els.canvas);
  if (!personOverlay) personOverlay = new PersonOverlay(els.overlay, els.video);
  personOverlay.mirror = camera.facingMode === "user";

  faceTracker.init().catch(() => {
    /* degrades to ambient idle drift, handled in the loop */
  });
  segmenter.init().catch(() => {
    /* segmentation unavailable: forest renders without a person cutout */
  });

  hide(els.loading);

  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

function loop(nowMs) {
  if (!running) return;

  const dt = lastLoopTs ? Math.min((nowMs - lastLoopTs) / 1000, 0.1) : 0.016;
  lastLoopTs = nowMs;
  sceneTime += dt;

  if (nowMs - lastInferenceTs >= INFERENCE_INTERVAL_MS) {
    lastInferenceTs = nowMs;
    runInference(nowMs);
  }

  const smoothed = smoother.push(lastFaceSample);
  const ambient = ambientFromClock();
  const pulses = { blinkPulse: blinkPulse.update(dt), gustPulse: gustPulse.update(dt) };
  const state = computePsychedelicState(smoothed, ambient, sceneTime, pulses);

  if (forest) forest.draw(state, dt);
  if (personOverlay) personOverlay.draw(lastMask);
  updateLabel(state);

  requestAnimationFrame(loop);
}

function runInference(nowMs) {
  try {
    if (faceTracker.ready) {
      lastFaceSample = faceTracker.detect(els.video, nowMs);
      trackPulseTriggers(lastFaceSample);
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

function trackPulseTriggers(sample) {
  const blinking = !!sample && sample.blink > BLINK_THRESHOLD;
  if (blinking && !wasBlinking) blinkPulse.trigger(1);
  wasBlinking = blinking;

  const mouthOpen = !!sample && sample.mouthOpen > MOUTH_OPEN_THRESHOLD;
  if (mouthOpen && !wasMouthOpen) gustPulse.trigger(1);
  wasMouthOpen = mouthOpen;
}

function updateLabel(state) {
  const text = state.hasFace ? "your forest" : "idle";
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
