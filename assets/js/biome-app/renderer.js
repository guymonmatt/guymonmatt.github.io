import { blendPalette, blendColor, lerpRgb, rgbToCss } from "./color.js";

const TREE_LAYERS = [
  { count: 9, minY: 0.62, maxY: 0.7, minScale: 0.35, maxScale: 0.55, opacity: 0.55, parallax: 0.01 },
  { count: 8, minY: 0.7, maxY: 0.82, minScale: 0.6, maxScale: 0.9, opacity: 0.78, parallax: 0.025 },
  { count: 6, minY: 0.82, maxY: 0.98, minScale: 1.0, maxScale: 1.5, opacity: 1.0, parallax: 0.05 },
];

const MAX_PARTICLES = 70;
const TOP_K = 3;
const PERSON_OPACITY = 0.65;

export class Renderer {
  constructor(canvas, videoEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.video = videoEl;

    this.cutout = document.createElement("canvas");
    this.cutoutCtx = this.cutout.getContext("2d");
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");

    this.width = 0;
    this.height = 0;
    this.trees = [];
    this.particles = [];
    this.time = 0;
    this.lastTs = null;
    this.mirror = true;

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

    this.trees = generateTrees(this.width, this.height);
    if (this.particles.length === 0) this.particles = generateParticles(this.width, this.height);
  }

  /** state comes from computeBiomeBlend(); mask comes from segmentation.js (or null). */
  draw(state, mask) {
    const now = performance.now();
    const dt = this.lastTs ? Math.min((now - this.lastTs) / 1000, 0.08) : 0.016;
    this.lastTs = now;
    this.time += dt;

    const top = state.blend.slice(0, TOP_K);
    const weightSum = top.reduce((s, w) => s + w.weight, 0);
    const blend = top.map((w) => ({ biome: w.biome, weight: w.weight / weightSum }));

    const sky = blendPalette(blend, "sky");
    const ground = blendPalette(blend, "ground");
    let foliage = blendPalette(blend, "foliage");
    let particleColor = blendColor(blend, (b) => b.particle.color);
    const particleDensity = blend.reduce((s, w) => s + w.biome.particle.baseDensity * w.weight, 0);

    // Personal tint: the actual sampled hair/skin color of whoever is in
    // frame nudges the particle and canopy color, so the same biome still
    // looks a little different depending on who's looking at it.
    if (state.personal) {
      const { skin, hair } = state.personal;
      particleColor = lerpRgb(particleColor, hair, 0.3);
      foliage = foliage.map((c) => lerpRgb(c, skin, 0.15));
    }

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    this._drawSky(ctx, w, h, sky);
    this._drawTrees(ctx, w, h, state, ground, foliage);
    this._drawPerson(ctx, w, h, mask);
    this._drawParticles(ctx, w, h, dt, state, particleColor, particleDensity);
  }

  _drawSky(ctx, w, h, sky) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgbToCss(sky[0]));
    grad.addColorStop(0.55, rgbToCss(sky[1]));
    grad.addColorStop(1, rgbToCss(sky[2]));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  _drawTrees(ctx, w, h, state, ground, foliage) {
    const groundGrad = ctx.createLinearGradient(0, h * 0.6, 0, h);
    groundGrad.addColorStop(0, rgbToCss(ground[0]));
    groundGrad.addColorStop(1, rgbToCss(ground[1]));
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, h * 0.6, w, h * 0.4);

    const pan = (state.panX - 0.5) * 2;
    const windX = Math.sin(state.tilt) * 40 + Math.sin(this.time * 0.6) * 6;

    for (const tree of this.trees) {
      const layer = TREE_LAYERS[tree.layerIndex];
      const sway = Math.sin(this.time * 1.2 + tree.seed * 6.283) * 3 * (1 + state.energy);
      const px = tree.x * w - pan * layer.parallax * w * 12 + windX * (tree.layerIndex + 1) * 0.15;
      const py = tree.y * h;
      const scale = tree.scale;

      ctx.globalAlpha = layer.opacity;
      const foliageColor = tree.colorMix < 0.5 ? foliage[0] : foliage[1];
      ctx.fillStyle = rgbToCss(foliageColor);

      // Trunk
      ctx.fillStyle = rgbToCss(ground[1]);
      ctx.fillRect(px - 3 * scale, py - 10 * scale, 6 * scale, 40 * scale);

      // Canopy: three overlapping soft circles
      ctx.fillStyle = rgbToCss(foliageColor);
      ctx.beginPath();
      ctx.arc(px + sway, py - 30 * scale, 26 * scale, 0, Math.PI * 2);
      ctx.arc(px - 18 * scale + sway, py - 15 * scale, 20 * scale, 0, Math.PI * 2);
      ctx.arc(px + 18 * scale + sway, py - 15 * scale, 20 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawPerson(ctx, w, h, mask) {
    if (!mask || !this.video.videoWidth) return;

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;

    if (this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
      this.maskCanvas.width = mask.width;
      this.maskCanvas.height = mask.height;
    }
    const imgData = this.maskCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const a = Math.max(0, Math.min(1, mask.data[i])) * 255;
      imgData.data[i * 4 + 3] = a;
    }
    this.maskCtx.putImageData(imgData, 0, 0);

    if (this.cutout.width !== vw || this.cutout.height !== vh) {
      this.cutout.width = vw;
      this.cutout.height = vh;
    }
    // Build the masked cutout in the video's own (unmirrored) coordinate
    // space, since that's the space the mask was computed in — mirroring
    // here first and masking second leaves the alpha misaligned with the
    // pixels whenever the face isn't dead-center.
    const cctx = this.cutoutCtx;
    cctx.clearRect(0, 0, vw, vh);
    cctx.drawImage(this.video, 0, 0, vw, vh);

    cctx.globalCompositeOperation = "destination-in";
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(this.maskCanvas, 0, 0, vw, vh);
    cctx.globalCompositeOperation = "source-over";

    // Cover-fit the cutout into the canvas viewport.
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
      // Mirror only at the final composite step, once cutout and mask are
      // already aligned.
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    // Blend into the scene rather than sitting on top of it like a sticker.
    ctx.globalAlpha = PERSON_OPACITY;
    ctx.drawImage(this.cutout, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  _drawParticles(ctx, w, h, dt, state, color, density) {
    const activeCount = Math.round(MAX_PARTICLES * Math.max(0.15, density) * (0.6 + 0.4 * state.energy));
    const css = rgbToCss(color, 1);
    const windX = Math.sin(state.tilt) * 30;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const active = i < activeCount;
      updateParticle(p, dt, this.time, w, h, windX);
      if (!active) continue;

      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = css;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function generateTrees(w, h) {
  const rand = mulberry32(1337);
  const trees = [];
  TREE_LAYERS.forEach((layer, layerIndex) => {
    for (let i = 0; i < layer.count; i++) {
      trees.push({
        x: (i + 0.5) / layer.count + (rand() - 0.5) * 0.06,
        y: layer.minY + rand() * (layer.maxY - layer.minY),
        scale: layer.minScale + rand() * (layer.maxScale - layer.minScale),
        seed: rand(),
        colorMix: rand(),
        layerIndex,
      });
    }
  });
  return trees;
}

function generateParticles(w, h) {
  const rand = mulberry32(99);
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      x: rand() * w,
      y: rand() * h,
      size: 1.5 + rand() * 2.5,
      speed: 10 + rand() * 20,
      phase: rand() * Math.PI * 2,
      freq: 0.5 + rand() * 1.5,
      alpha: 0.4 + rand() * 0.5,
      driftAmp: 10 + rand() * 20,
    });
  }
  return particles;
}

function updateParticle(p, dt, time, w, h, windX) {
  p.y += p.speed * dt * 0.6;
  p.x += Math.sin(time * p.freq + p.phase) * dt * p.driftAmp * 0.5 + windX * dt * 0.3;
  p.alpha = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(time * p.freq * 2 + p.phase));

  if (p.y > h + 10) {
    p.y = -10;
    p.x = Math.random() * w;
  }
  if (p.x > w + 10) p.x = -10;
  if (p.x < -10) p.x = w + 10;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
