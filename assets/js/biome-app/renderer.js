import { blendPalette, blendColor, lerpRgb, rgbToCss } from "./color.js";

const TREE_LAYERS = [
  { count: 6, minY: 0.61, maxY: 0.71, minScale: 0.3, maxScale: 0.55, opacity: 0.5, parallax: 0.01 },
  { count: 5, minY: 0.7, maxY: 0.84, minScale: 0.6, maxScale: 1.0, opacity: 0.75, parallax: 0.025 },
  { count: 4, minY: 0.83, maxY: 0.99, minScale: 1.05, maxScale: 1.7, opacity: 1.0, parallax: 0.05 },
];

const MAX_PARTICLES = 70;
const TOP_K = 3;
const PERSON_OPACITY = 0.65;
const BARK_BASE = { r: 150, g: 114, b: 92 };
const ROUGH_CDN = "https://cdn.jsdelivr.net/npm/roughjs@4.6.6/+esm";

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
    this.bushes = [];
    this.horizonPoints = [];
    this.particles = [];
    this.time = 0;
    this.lastTs = null;
    this.mirror = true;

    // Genuinely hand-sketched rendering (wobbly lines, hachure fills) via
    // roughjs, loaded from a CDN like the MediaPipe models. If it fails to
    // load for any reason, _drawTrees falls back to the hand-rolled sketch
    // look that was already in place, so a network hiccup never breaks
    // the scene — it just looks slightly less textured.
    this.rc = null;
    this._loadRough();

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  async _loadRough() {
    try {
      const mod = await import(ROUGH_CDN);
      const rough = mod.default || mod;
      this.rc = rough.canvas(this.canvas);
    } catch {
      this.rc = null;
    }
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
    this.bushes = generateBushes(this.width, this.height);
    this.horizonPoints = generateHorizonPoints();
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

    // The whole scene visibly leans with your head tilt — a much more
    // immediate, obvious "this is reacting to you" cue than just biasing
    // wind direction. Clamped so an extreme tilt doesn't get disorienting.
    const tiltAngle = Math.max(-0.16, Math.min(0.16, (state.tilt || 0) * 0.45));

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(tiltAngle);
    ctx.translate(-w / 2, -h / 2);

    this._drawSky(ctx, w, h, sky);
    this._drawTrees(ctx, w, h, state, ground, foliage);
    this._drawPerson(ctx, w, h, mask);
    this._drawParticles(ctx, w, h, dt, state, particleColor, particleDensity);

    ctx.restore();

    // Blink pulse: a brief soft flash rather than a steady value, so the
    // moment of blinking itself is visible instead of only ever showing up
    // as smoothed-away noise.
    if (state.blinkPulse > 0.01) {
      ctx.globalAlpha = state.blinkPulse * 0.18;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
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
    const gust = state.gustPulse || 0;
    const windX = Math.sin(state.tilt) * 40 + Math.sin(this.time * 0.6) * 6 + gust * 70;
    const trunkColor = rgbToCss(lerpRgb(BARK_BASE, ground[1], 0.25));

    this._drawHorizon(ctx, w, h, ground);

    ctx.lineCap = "round";

    for (const tree of this.trees) {
      const layer = TREE_LAYERS[tree.layerIndex];
      const sway = Math.sin(this.time * 1.2 + tree.seed * 6.283) * 3 * (1 + state.energy + gust * 2);
      const px = tree.x * w - pan * layer.parallax * w * 12 + windX * (tree.layerIndex + 1) * 0.15;
      const py = tree.y * h;
      const scale = tree.scale;

      const trunkHeight = 46 * scale;
      const bend = tree.trunkBend * scale;
      const jitter = tree.trunkJitter * scale;
      const topX = px + bend * 0.6 + sway * 0.4;
      const topY = py - trunkHeight;
      const midX = px + bend * 0.35 + jitter + sway * 0.15;
      const midY = py - trunkHeight * 0.55;
      const branchOriginY = topY + trunkHeight * 0.15;

      if (this.rc) {
        this._drawTreeRough(ctx, tree, layer, foliage, trunkColor, scale, {
          px, py, topX, topY, midX, midY, branchOriginY, sway,
        });
      } else {
        this._drawTreeFallback(ctx, tree, layer, foliage, trunkColor, scale, jitter, {
          px, py, topX, topY, midX, midY, branchOriginY, sway,
        });
      }
    }

    this._drawBushes(ctx, w, h, foliage);
    ctx.globalAlpha = 1;
  }

  /** A soft, slightly wavering horizon instead of a hard rectangle edge —
   * reads as a drawn line rather than a flat-shaded boundary. */
  _drawHorizon(ctx, w, h, ground) {
    const y = h * 0.6;
    const points = this.horizonPoints.map((p) => [p.xFrac * w, y + p.yJitter]);
    const color = rgbToCss(lerpRgb(ground[0], { r: 0, g: 0, b: 0 }, 0.22));

    ctx.globalAlpha = 0.8;
    if (this.rc) {
      this.rc.linearPath(points, {
        stroke: color,
        strokeWidth: 1.4,
        roughness: 2,
        bowing: 2,
        seed: 555,
      });
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      points.forEach(([x, py], i) => (i === 0 ? ctx.moveTo(x, py) : ctx.lineTo(x, py)));
      ctx.stroke();
    }
  }

  /** Small foreground foliage clumps along the ground, using the same
   * hachure-clump technique as tree canopies but with no trunk. */
  _drawBushes(ctx, w, h, foliage) {
    for (const bush of this.bushes) {
      const bx = bush.x * w;
      const by = h * bush.y;
      ctx.globalAlpha = 0.9;
      for (const clump of bush.clumps) {
        const cx = bx + clump.cx * bush.scale;
        const cy = by + clump.cy * bush.scale;
        const tone = clump.tone < 0.5 ? foliage[0] : foliage[1];

        if (this.rc) {
          const points = clump.points.map((p) => [
            cx + p.dx * bush.scale,
            cy + p.dy * bush.scale,
          ]);
          this.rc.polygon(points, {
            fill: rgbToCss(tone),
            fillStyle: "hachure",
            fillWeight: 0.5,
            hachureGap: 2,
            hachureAngle: clump.hachureAngle,
            stroke: "none",
            roughness: 1.2,
            seed: clump.seed,
          });
        } else {
          ctx.fillStyle = rgbToCss(tone, 0.75);
          ctx.beginPath();
          ctx.ellipse(cx, cy, 9 * bush.scale, 6 * bush.scale, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /** Genuinely hand-sketched rendering via roughjs: wobbly linear paths for
   * the trunk/branches and hachure-filled polygons for foliage clumps. */
  _drawTreeRough(ctx, tree, layer, foliage, trunkColor, scale, pts) {
    const { px, py, topX, topY, midX, midY, branchOriginY } = pts;
    ctx.globalAlpha = layer.opacity;
    const opts = {
      stroke: trunkColor,
      strokeWidth: Math.max(0.8, 2.2 * scale),
      roughness: 2.2,
      bowing: 1.5,
      seed: tree.trunkSeed,
    };
    this.rc.linearPath(
      [
        [px, py],
        [midX, midY],
        [topX, topY],
      ],
      opts
    );

    const branchOpts = { ...opts, strokeWidth: Math.max(0.6, 1.1 * scale) };
    [tree.branchAngle1, tree.branchAngle2].forEach((angle, i) => {
      const len = 20 * scale;
      const kinkX = topX + Math.sin(angle) * len * 0.55;
      const kinkY = branchOriginY - Math.cos(angle) * len * 0.5;
      const endX = topX + Math.sin(angle) * len;
      const endY = branchOriginY - Math.cos(angle) * len * 0.85;
      this.rc.linearPath(
        [
          [topX, branchOriginY],
          [kinkX, kinkY],
          [endX, endY],
        ],
        { ...branchOpts, seed: tree.branchSeeds[i] }
      );
    });

    for (const clump of tree.canopyClumps) {
      const cx = topX + clump.cx * scale + pts.sway * 0.6;
      const cy = topY + clump.cy * scale;
      const points = clump.points.map((p) => [cx + p.dx * scale, cy + p.dy * scale]);
      // No outline stroke — a bold outline around every small blob is what
      // reads as a crayon/cartoon sticker. Letting the hachure fill alone
      // define the silhouette, with fine, tightly-spaced lines, reads as
      // pencil shading instead.
      this.rc.polygon(points, {
        fill: rgbToCss(clump.tone < 0.5 ? foliage[0] : foliage[1]),
        fillStyle: "hachure",
        fillWeight: Math.max(0.4, 0.55 * scale),
        hachureGap: Math.max(1.4, 2.4 * scale),
        hachureAngle: clump.hachureAngle,
        stroke: "none",
        roughness: 1.2,
        seed: clump.seed,
      });
    }
  }

  /** Hand-rolled sketch look used if roughjs hasn't loaded (e.g. offline). */
  _drawTreeFallback(ctx, tree, layer, foliage, trunkColor, scale, jitter, pts) {
    const { px, py, topX, topY, midX, midY, branchOriginY, sway } = pts;
    ctx.strokeStyle = trunkColor;

    ctx.globalAlpha = layer.opacity;
    ctx.lineWidth = Math.max(1, 2.6 * scale);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(midX, midY);
    ctx.lineTo(topX, topY);
    ctx.stroke();

    ctx.globalAlpha = layer.opacity * 0.4;
    ctx.lineWidth = Math.max(0.6, 1.2 * scale);
    ctx.beginPath();
    ctx.moveTo(px + 1.5 * scale, py);
    ctx.lineTo(midX - 1.5 * scale, midY - 1 * scale);
    ctx.lineTo(topX + 1 * scale, topY);
    ctx.stroke();

    ctx.globalAlpha = layer.opacity;
    ctx.lineWidth = Math.max(0.5, 1 * scale);
    for (const angle of [tree.branchAngle1, tree.branchAngle2]) {
      const len = 20 * scale;
      const kinkX = topX + Math.sin(angle) * len * 0.55;
      const kinkY = branchOriginY - Math.cos(angle) * len * 0.5 + jitter * 0.3;
      const endX = topX + Math.sin(angle) * len;
      const endY = branchOriginY - Math.cos(angle) * len * 0.85;
      ctx.beginPath();
      ctx.moveTo(topX, branchOriginY);
      ctx.lineTo(kinkX, kinkY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    for (const stroke of tree.canopyDabs) {
      ctx.globalAlpha = layer.opacity * stroke.alpha;
      ctx.strokeStyle = rgbToCss(stroke.tone < 0.5 ? foliage[0] : foliage[1]);
      ctx.lineWidth = Math.max(0.6, 1.3 * scale);
      const cx = topX + stroke.dx * scale + sway * 0.6;
      const cy = topY + stroke.dy * scale;
      const hx = (Math.cos(stroke.angle) * stroke.length * scale) / 2;
      const hy = (Math.sin(stroke.angle) * stroke.length * scale) / 2;
      ctx.beginPath();
      ctx.moveTo(cx - hx, cy - hy);
      ctx.lineTo(cx + hx, cy + hy);
      ctx.stroke();
    }
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
      imgData.data[i * 4 + 3] = maskAlphaCurve(mask.data[i]) * 255;
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
    const gust = state.gustPulse || 0;
    const activeCount = Math.round(
      MAX_PARTICLES * Math.min(1, Math.max(0.15, density) * (0.6 + 0.4 * state.energy) + gust * 0.5)
    );
    const css = rgbToCss(color, 1);
    const windX = Math.sin(state.tilt) * 30 + gust * 90;

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
      // Foliage as several small clumps (like the reference illustration's
      // fluffy leaf clusters along branches) rather than one round mass.
      // Distant/back-layer trees get fewer, simpler clumps.
      const clumpCount = 2 + layerIndex + Math.floor(rand() * 2);
      const canopyDabs = [];
      const canopyClumps = [];
      for (let c = 0; c < clumpCount; c++) {
        const clumpAngle = (rand() - 0.5) * 1.7;
        const clumpDist = 12 + rand() * 30;
        const cx = Math.sin(clumpAngle) * clumpDist;
        const cy = -8 - rand() * 30 - clumpDist * 0.3;
        const tone = rand();

        // Fallback-only: scribbled hatch strokes around the clump center.
        const strokesInClump = 4 + Math.floor(rand() * 5);
        for (let d = 0; d < strokesInClump; d++) {
          canopyDabs.push({
            dx: cx + (rand() - 0.5) * 14,
            dy: cy + (rand() - 0.5) * 12,
            angle: rand() * Math.PI * 2,
            length: 5 + rand() * 7,
            tone,
            alpha: 0.5 + rand() * 0.4,
          });
        }

        // roughjs-only: an irregular rounded polygon outline roughjs fills
        // with a genuine hachure sketch texture.
        canopyClumps.push({
          cx,
          cy,
          points: makeClumpPolygon(rand, 9 + rand() * 6),
          tone,
          seed: 1 + Math.floor(rand() * 99999),
          hachureAngle: -60 + rand() * 60,
        });
      }

      trees.push({
        x: (i + 0.5) / layer.count + (rand() - 0.5) * 0.16,
        y: layer.minY + rand() * (layer.maxY - layer.minY),
        scale: layer.minScale + rand() * (layer.maxScale - layer.minScale),
        seed: rand(),
        layerIndex,
        trunkBend: (rand() - 0.5) * 10,
        trunkJitter: (rand() - 0.5) * 14,
        trunkSeed: 1 + Math.floor(rand() * 99999),
        branchAngle1: 0.35 + rand() * 0.3,
        branchAngle2: -(0.35 + rand() * 0.3),
        branchSeeds: [1 + Math.floor(rand() * 99999), 1 + Math.floor(rand() * 99999)],
        canopyDabs,
        canopyClumps,
      });
    }
  });
  return trees;
}

function makeClumpPolygon(rand, baseR) {
  const vertexCount = 7 + Math.floor(rand() * 3);
  const points = [];
  for (let v = 0; v < vertexCount; v++) {
    const angle = (v / vertexCount) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    const r = baseR * (0.7 + rand() * 0.6);
    points.push({ dx: Math.cos(angle) * r, dy: Math.sin(angle) * r * 0.85 });
  }
  return points;
}

const BUSH_COUNT = 10;

function generateBushes(w, h) {
  const rand = mulberry32(4242);
  const bushes = [];
  for (let i = 0; i < BUSH_COUNT; i++) {
    const scale = 0.6 + rand() * 0.9;
    const clumpCount = 1 + Math.floor(rand() * 2);
    const clumps = [];
    for (let c = 0; c < clumpCount; c++) {
      const cx = (rand() - 0.5) * 22;
      const cy = (rand() - 0.5) * 8;
      clumps.push({
        cx,
        cy,
        points: makeClumpPolygon(rand, 7 + rand() * 5),
        tone: rand(),
        seed: 1 + Math.floor(rand() * 99999),
        hachureAngle: -60 + rand() * 60,
      });
    }
    bushes.push({
      x: (i + 0.5) / BUSH_COUNT + (rand() - 0.5) * 0.08,
      y: 0.61 + rand() * 0.14,
      scale,
      clumps,
    });
  }
  return bushes;
}

const HORIZON_POINT_COUNT = 12;

function generateHorizonPoints() {
  const rand = mulberry32(777);
  const points = [];
  for (let i = 0; i <= HORIZON_POINT_COUNT; i++) {
    points.push({
      xFrac: i / HORIZON_POINT_COUNT,
      yJitter: (rand() - 0.5) * 14,
    });
  }
  return points;
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

// Segmentation confidence is noisy at shadows, hairlines, and collar edges.
// Mapping it to alpha 1:1 lets those soft spots fade toward background —
// this pushes mid-confidence pixels solidly toward "person" instead, so a
// shadowed neck doesn't turn into a see-through hole.
const MASK_LO = 0.25;
const MASK_HI = 0.6;

function maskAlphaCurve(v) {
  const t = Math.max(0, Math.min(1, (v - MASK_LO) / (MASK_HI - MASK_LO)));
  return t * t * (3 - 2 * t); // smoothstep
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
