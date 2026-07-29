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

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.ready = false;
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

    return { present: true, size, tilt, smile, blink, browRaise, x, y };
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
