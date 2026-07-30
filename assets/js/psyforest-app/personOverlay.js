// Composites the segmented, translucent person onto a standalone 2D canvas
// layered on top of the Three.js WebGL canvas. Same masking technique as
// Biome Mirror's renderer.js, factored out since this app has no single
// "background canvas" to draw the person into directly.

const PERSON_OPACITY = 0.7;
const MASK_LO = 0.25;
const MASK_HI = 0.6;

export class PersonOverlay {
  constructor(canvas, videoEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.video = videoEl;
    this.mirror = true;

    this.cutout = document.createElement("canvas");
    this.cutoutCtx = this.cutout.getContext("2d");
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");

    this.width = 0;
    this.height = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /** mask comes from segmentation.js (or null, in which case nothing is drawn). */
  draw(mask) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    if (!mask || !this.video.videoWidth) return;

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;

    if (this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
      this.maskCanvas.width = mask.width;
      this.maskCanvas.height = mask.height;
    }
    const imgData = this.maskCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      imgData.data[i * 4 + 3] = maskAlphaCurve(mask.data[i]) * 255;
    }
    this.maskCtx.putImageData(imgData, 0, 0);

    if (this.cutout.width !== vw || this.cutout.height !== vh) {
      this.cutout.width = vw;
      this.cutout.height = vh;
    }
    const cctx = this.cutoutCtx;
    cctx.clearRect(0, 0, vw, vh);
    cctx.drawImage(this.video, 0, 0, vw, vh);
    cctx.globalCompositeOperation = "destination-in";
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(this.maskCanvas, 0, 0, vw, vh);
    cctx.globalCompositeOperation = "source-over";

    const canvasRatio = w / h;
    const videoRatio = vw / vh;
    let dw = w;
    let dh = h;
    if (videoRatio > canvasRatio) {
      dh = h;
      dw = h * videoRatio;
    } else {
      dw = w;
      dh = w / videoRatio;
    }

    ctx.save();
    if (this.mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.globalAlpha = PERSON_OPACITY;
    ctx.drawImage(this.cutout, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
}

function maskAlphaCurve(v) {
  const t = Math.max(0, Math.min(1, (v - MASK_LO) / (MASK_HI - MASK_LO)));
  return t * t * (3 - 2 * t);
}
