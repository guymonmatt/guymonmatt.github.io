// On-device face landmark detection via MediaPipe Tasks Vision.
// Model + WASM are fetched from Google/jsDelivr CDNs at load time, but the
// video frames themselves are never sent anywhere — inference runs locally.

const VISION_VERSION = "0.10.14";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Classic 468-point face mesh indices (stable across tasks-vision versions).
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const FOREHEAD = 10;
const CHIN = 152;
const LEFT_FACE_EDGE = 234;
const RIGHT_FACE_EDGE = 454;
const NOSE_LEFT = 98;
const NOSE_RIGHT = 327;
const JAW_LEFT = 172;
const JAW_RIGHT = 397;
const CHEEK_SAMPLE = 50;

// Rough plausible ranges (as fractions of face width/height) used to
// normalize geometry ratios into 0..1 so no single face maxes out an axis.
const RANGES = {
  eyeSpacing: [0.3, 0.46],
  faceAspect: [1.05, 1.55],
  noseWidth: [0.17, 0.3],
  jawWidth: [0.55, 0.85],
};

const SAMPLE_SIZE = 160;

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.ready = false;
    this.sampleCanvas = document.createElement("canvas");
    this.sampleCanvas.width = SAMPLE_SIZE;
    this.sampleCanvas.height = SAMPLE_SIZE;
    this.sampleCtx = this.sampleCanvas.getContext("2d", { willReadFrequently: true });
  }

  async init() {
    const { FilesetResolver, FaceLandmarker } = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      runningMode: "VIDEO",
      numFaces: 1,
    });
    this.ready = true;
  }

  /**
   * Returns normalized data points for the most prominent face in frame,
   * or null if no face is currently detected.
   */
  detect(videoEl, timestampMs) {
    if (!this.ready || !videoEl.videoWidth) return null;

    this._drawnThisCall = false;

    const result = this.landmarker.detectForVideo(videoEl, timestampMs);
    const landmarks = result.faceLandmarks && result.faceLandmarks[0];
    if (!landmarks) return null;

    const blendshapes = {};
    const categories = result.faceBlendshapes?.[0]?.categories || [];
    for (const c of categories) blendshapes[c.categoryName] = c.score;

    const leftEye = landmarks[LEFT_EYE_OUTER];
    const rightEye = landmarks[RIGHT_EYE_OUTER];
    const forehead = landmarks[FOREHEAD];
    const chin = landmarks[CHIN];

    const interocular = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
    const faceHeight = Math.hypot(chin.x - forehead.x, chin.y - forehead.y);
    const size = clamp01((interocular + faceHeight) / 0.9);

    const tilt = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    const smile = clamp01(
      ((blendshapes.mouthSmileLeft || 0) + (blendshapes.mouthSmileRight || 0)) / 2
    );
    const blink = clamp01(
      ((blendshapes.eyeBlinkLeft || 0) + (blendshapes.eyeBlinkRight || 0)) / 2
    );
    const browRaise = clamp01(
      ((blendshapes.browOuterUpLeft || 0) + (blendshapes.browOuterUpRight || 0)) / 2
    );

    let sumX = 0;
    let sumY = 0;
    for (const p of landmarks) {
      sumX += p.x;
      sumY += p.y;
    }
    const x = sumX / landmarks.length;
    const y = sumY / landmarks.length;

    // Stable, per-person geometry ratios — these barely move frame to frame
    // for the same face, which is what makes them a usable "signature" as
    // opposed to the expression signals above, which are meant to move.
    const faceEdgeLeft = landmarks[LEFT_FACE_EDGE];
    const faceEdgeRight = landmarks[RIGHT_FACE_EDGE];
    const noseLeft = landmarks[NOSE_LEFT];
    const noseRight = landmarks[NOSE_RIGHT];
    const jawLeft = landmarks[JAW_LEFT];
    const jawRight = landmarks[JAW_RIGHT];

    const faceWidth = dist(faceEdgeLeft, faceEdgeRight) || 1e-6;
    const eyeSpacing = normalizeRange(interocular / faceWidth, RANGES.eyeSpacing);
    const faceAspect = normalizeRange(faceHeight / faceWidth, RANGES.faceAspect);
    const noseWidth = normalizeRange(dist(noseLeft, noseRight) / faceWidth, RANGES.noseWidth);
    const jawWidth = normalizeRange(dist(jawLeft, jawRight) / faceWidth, RANGES.jawWidth);

    const skin = this._samplePixel(videoEl, landmarks[CHEEK_SAMPLE]);
    // Hairline is just above the forehead landmark, extrapolated along the
    // forehead-to-chin axis so it tracks head tilt/size reasonably well.
    const hairPoint = {
      x: forehead.x + (forehead.x - chin.x) * 0.6,
      y: forehead.y + (forehead.y - chin.y) * 0.6,
    };
    const hair = this._samplePixel(videoEl, hairPoint);

    return {
      present: true,
      size,
      tilt,
      smile,
      blink,
      browRaise,
      x,
      y,
      eyeSpacing,
      faceAspect,
      noseWidth,
      jawWidth,
      skinR: skin.r,
      skinG: skin.g,
      skinB: skin.b,
      hairR: hair.r,
      hairG: hair.g,
      hairB: hair.b,
    };
  }

  _samplePixel(videoEl, point) {
    const ctx = this.sampleCtx;
    if (!this._drawnThisCall) {
      ctx.drawImage(videoEl, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      this._drawnThisCall = true;
    }
    const px = Math.max(0, Math.min(SAMPLE_SIZE - 1, Math.round(point.x * SAMPLE_SIZE)));
    const py = Math.max(0, Math.min(SAMPLE_SIZE - 1, Math.round(point.y * SAMPLE_SIZE)));
    const half = 2;
    const x0 = Math.max(0, px - half);
    const y0 = Math.max(0, py - half);
    const w = Math.min(SAMPLE_SIZE - x0, half * 2 + 1);
    const h = Math.min(SAMPLE_SIZE - y0, half * 2 + 1);
    const { data } = ctx.getImageData(x0, y0, w, h);

    let r = 0;
    let g = 0;
    let b = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return { r: r / count, g: g / count, b: b / count };
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeRange(v, [min, max]) {
  return clamp01((v - min) / (max - min));
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
