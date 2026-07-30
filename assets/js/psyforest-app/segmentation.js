// On-device person/background segmentation via MediaPipe Tasks Vision.
// Used to cut the person out of the live frame so they can be composited
// onto the generated biome scene. Runs entirely in-browser.

const VISION_VERSION = "0.10.14";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export class Segmenter {
  constructor() {
    this.segmenter = null;
    this.ready = false;
  }

  async init() {
    const { FilesetResolver, ImageSegmenter } = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        // CPU, not GPU: this app also runs a Three.js WebGL scene on the
        // same page, and contending with MediaPipe's GPU delegate for the
        // WebGL context produced degenerate (near-uniform) mask output.
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    this.ready = true;
  }

  /**
   * Returns { data: Float32Array, width, height } where data[i] is the
   * person-likelihood (0..1) of pixel i, or null if unavailable.
   */
  segment(videoEl, timestampMs) {
    if (!this.ready || !videoEl.videoWidth) return null;

    const result = this.segmenter.segmentForVideo(videoEl, timestampMs);
    const mask = result.confidenceMasks && result.confidenceMasks[0];
    if (!mask) return null;

    const data = mask.getAsFloat32Array();
    const width = mask.width;
    const height = mask.height;
    mask.close();

    return { data, width, height };
  }
}
