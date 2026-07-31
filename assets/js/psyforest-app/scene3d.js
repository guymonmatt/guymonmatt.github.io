// A 3D psychedelic forest rendered with Three.js (MIT-licensed, loaded from
// CDN like the MediaPipe models). Trees and "flowers" are simple low-poly
// shapes with emissive materials driven by the live color state from
// psychedelic.js — the geometry stays simple and lets color/glow/motion
// carry the visual weight.

const THREE_VERSION = "0.160.0";
const THREE_URL = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;
const ADDON_BASE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm`;

const TREE_COUNT = 30;
const FLOWER_COUNT = 44;
const FOREST_RADIUS = 60;
const CLEARING_RADIUS = 6;

export class Forest3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this.time = 0;
    this.THREE = null;
    this.composer = null;
    this.bloomPass = null;

    this._init();
  }

  async _init() {
    try {
      const THREE = await import(THREE_URL);
      this.THREE = THREE;

      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer = renderer;

      const scene = new THREE.Scene();
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 300);
      camera.position.set(0, 2.4, 0);
      this.camera = camera;

      // A persistent, mutated-in-place color rather than reassigning fresh
      // Color instances every frame. Set directly on scene.background (not
      // just the renderer's clear color) so the canvas can never fall back
      // to its native default white if a render pass leaves any pixel
      // untouched.
      this.bgColor = new THREE.Color(0x0a0212);
      scene.background = this.bgColor;

      this.fog = new THREE.FogExp2(0x0a0212, 0.028);
      scene.fog = this.fog;

      this.ambientLight = new THREE.AmbientLight(0x554466, 1.1);
      scene.add(this.ambientLight);

      this.followLight = new THREE.PointLight(0xffffff, 1.4, 30, 2);
      this.followLight.position.set(0, 3, 0);
      scene.add(this.followLight);

      this._buildGround(THREE);
      this._buildTrees(THREE);
      this._buildFlowers(THREE);

      this.resize();
      window.addEventListener("resize", () => this.resize());

      await this._loadComposer(THREE);

      this.ready = true;
    } catch (err) {
      this.ready = false;
      this.loadError = err;
    }
  }

  async _loadComposer(THREE) {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import(`${ADDON_BASE}/postprocessing/EffectComposer.js`),
        import(`${ADDON_BASE}/postprocessing/RenderPass.js`),
        import(`${ADDON_BASE}/postprocessing/UnrealBloomPass.js`),
      ]);

      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.9,
        0.6,
        0.15
      );
      composer.addPass(bloom);
      this.composer = composer;
      this.bloomPass = bloom;
    } catch {
      // Bloom is a nice-to-have; plain rendering still looks fine without it.
      this.composer = null;
      this.bloomPass = null;
    }
  }

  _buildGround(THREE) {
    const geo = new THREE.PlaneGeometry(400, 400);
    const mat = new THREE.MeshStandardMaterial({ color: 0x120a1c, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.groundMat = mat;
  }

  _buildTrees(THREE) {
    const rand = mulberry32(2024);
    this.trees = [];
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1830, roughness: 0.9 });

    for (let i = 0; i < TREE_COUNT; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = CLEARING_RADIUS + rand() * (FOREST_RADIUS - CLEARING_RADIUS);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = 3 + rand() * 5;
      const lean = (rand() - 0.5) * 0.12;

      // Trunk: tapered, and slightly bent (two segments) rather than a
      // perfectly straight cylinder — a straight pole is a big part of why
      // this read as "a stick."
      const trunkGroup = new THREE.Group();
      const lowerGeo = new THREE.CylinderGeometry(0.16, 0.24, height * 0.6, 6);
      const lower = new THREE.Mesh(lowerGeo, trunkMat);
      lower.position.y = (height * 0.6) / 2;
      lower.rotation.z = lean * 0.4;
      trunkGroup.add(lower);

      const upperGeo = new THREE.CylinderGeometry(0.08, 0.17, height * 0.42, 6);
      const upper = new THREE.Mesh(upperGeo, trunkMat);
      upper.position.set(Math.sin(lean) * height * 0.3, height * 0.6 + (height * 0.42) / 2, 0);
      upper.rotation.z = lean;
      trunkGroup.add(upper);

      // A couple of short branches forking off partway up, breaking up the
      // single-pole silhouette further.
      for (const branchSide of [-1, 1]) {
        const branchGeo = new THREE.CylinderGeometry(0.03, 0.07, height * 0.28, 5);
        const branch = new THREE.Mesh(branchGeo, trunkMat);
        branch.position.set(
          Math.sin(lean) * height * 0.55 + branchSide * 0.15,
          height * 0.72,
          branchSide * 0.1
        );
        branch.rotation.z = branchSide * (0.7 + rand() * 0.3);
        trunkGroup.add(branch);
      }

      trunkGroup.position.set(x, 0, z);
      this.scene.add(trunkGroup);

      const canopyAnchorX = x + Math.sin(lean) * height * 0.75;
      const canopyBaseY = height + 0.3;

      // Canopy as a small cluster of offset, non-uniformly-scaled blobs
      // instead of one perfect sphere — reads as a mass of foliage rather
      // than a ball. All blobs share one material so per-frame color
      // updates stay cheap regardless of cluster size.
      const canopyMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.6,
        roughness: 0.6,
        flatShading: true,
      });
      const canopyGroup = new THREE.Group();
      const clumpCount = 3 + Math.floor(rand() * 2);
      for (let c = 0; c < clumpCount; c++) {
        const blobGeo = new THREE.IcosahedronGeometry(0.55 + rand() * 0.55, 0);
        const blob = new THREE.Mesh(blobGeo, canopyMat);
        const a = rand() * Math.PI * 2;
        const d = rand() * 0.85;
        blob.position.set(Math.cos(a) * d, (rand() - 0.35) * 0.7, Math.sin(a) * d);
        blob.scale.set(0.85 + rand() * 0.4, 0.6 + rand() * 0.35, 0.85 + rand() * 0.4);
        blob.rotation.y = rand() * Math.PI;
        canopyGroup.add(blob);
      }
      canopyGroup.position.set(canopyAnchorX, canopyBaseY, z);
      this.scene.add(canopyGroup);

      this.trees.push({
        canopyGroup,
        canopyMat,
        hueOffset: rand() * 360,
        swaySeed: rand() * Math.PI * 2,
        baseY: canopyBaseY,
      });
    }
  }

  _buildFlowers(THREE) {
    const rand = mulberry32(777);
    this.flowers = [];

    for (let i = 0; i < FLOWER_COUNT; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 1.5 + rand() * (FOREST_RADIUS - 2);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const baseY = 0.3 + rand() * 0.25;

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 1.1,
        roughness: 0.35,
        side: THREE.DoubleSide,
      });

      // A center bud plus a fan of petals around it, instead of a single
      // floating gem — reads as a flower rather than an orb.
      const flowerGroup = new THREE.Group();
      const centerGeo = new THREE.OctahedronGeometry(0.09 + rand() * 0.03, 0);
      flowerGroup.add(new THREE.Mesh(centerGeo, mat));

      const petalCount = 4 + Math.floor(rand() * 3);
      const petalGeo = new THREE.ConeGeometry(0.09 + rand() * 0.04, 0.32 + rand() * 0.18, 4);
      for (let p = 0; p < petalCount; p++) {
        const petal = new THREE.Mesh(petalGeo, mat);
        const petalAngle = (p / petalCount) * Math.PI * 2;
        const r = 0.16;
        petal.position.set(Math.cos(petalAngle) * r, 0.04, Math.sin(petalAngle) * r);
        petal.rotation.y = -petalAngle;
        petal.rotation.z = -Math.PI / 2 + 0.35;
        flowerGroup.add(petal);
      }

      flowerGroup.position.set(x, baseY, z);
      this.scene.add(flowerGroup);

      this.flowers.push({
        flowerGroup,
        mat,
        hueOffset: rand() * 360,
        phase: rand() * Math.PI * 2,
        freq: 0.6 + rand() * 1.2,
        baseY,
        baseScale: 0.85 + rand() * 0.7,
      });
    }
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }

  /** state comes from computePsychedelicState(); dt is seconds since last frame. */
  draw(state, dt) {
    if (!this.ready) return;
    this.time += dt;

    const gust = state.gustPulse || 0;
    const blink = state.blinkPulse || 0;

    // Slow autonomous drift around the forest, plus head tilt/position
    // nudging the view directly — the camera is always moving, but you
    // can visibly steer it.
    const orbitRadius = 9 + Math.sin(this.time * 0.05) * 2;
    const orbitAngle = this.time * 0.06 + (state.panX - 0.5) * 1.2;
    this.camera.position.x = Math.cos(orbitAngle) * orbitRadius;
    this.camera.position.z = Math.sin(orbitAngle) * orbitRadius;
    this.camera.position.y = 2.2 + (0.5 - state.panY) * 1.5;
    this.camera.lookAt(0, 2 + state.energy * 1.5, 0);
    // Add the head-tilt roll as a proper rotation around the camera's own
    // view axis (quaternion composition via rotateZ), not by overwriting
    // the Euler .z component lookAt() just computed — directly assigning
    // rotation.z after lookAt() recombines Euler angles in a way that goes
    // degenerate at certain orbit angles and can flip the view upside down.
    this.camera.rotateZ(Math.max(-0.2, Math.min(0.2, state.tilt * 0.6)));

    this.followLight.position.copy(this.camera.position);
    this.followLight.intensity = 1.2 + state.energy * 1.5 + blink * 3;

    this.bgColor.setHSL(state.hue / 360, state.saturation * 0.5, 0.06);
    this.fog.color.copy(this.bgColor);
    this.renderer.setClearColor(this.bgColor, 1);
    this.ambientLight.color.setHSL(((state.hue + 40) % 360) / 360, state.saturation * 0.6, 0.35);
    this.groundMat.color.setHSL(state.hue / 360, state.saturation * 0.4, 0.05);

    for (const tree of this.trees) {
      const hue = (state.hue + tree.hueOffset) % 360;
      tree.canopyMat.color.setHSL(hue / 360, state.saturation, 0.5);
      tree.canopyMat.emissive.setHSL(hue / 360, state.saturation, 0.35 + state.energy * 0.25);
      tree.canopyMat.emissiveIntensity = 0.5 + state.energy * 0.6 + gust * 0.8;
      const sway = Math.sin(this.time * 0.8 + tree.swaySeed) * (0.05 + gust * 0.3);
      tree.canopyGroup.position.y = tree.baseY + Math.sin(this.time * 0.5 + tree.swaySeed) * 0.15;
      tree.canopyGroup.rotation.z = sway;
    }

    for (const f of this.flowers) {
      const hue = (state.hue + f.hueOffset) % 360;
      f.mat.color.setHSL(hue / 360, Math.min(1, state.saturation + 0.2), 0.55);
      f.mat.emissive.setHSL(hue / 360, 1, 0.5);
      f.mat.emissiveIntensity = (0.8 + state.energy * 1.2 + blink * 2) * state.density;
      const pulse = Math.sin(this.time * f.freq + f.phase) * 0.5 + 0.5;
      const scale = f.baseScale * (0.6 + pulse * 0.6 + gust * 0.5) * (0.5 + state.density * 0.7);
      f.flowerGroup.scale.setScalar(scale);
      f.flowerGroup.position.y = f.baseY + pulse * 0.2;
      f.flowerGroup.rotation.y = this.time * (0.3 + f.freq * 0.2);
    }

    if (this.bloomPass) {
      this.bloomPass.strength = 0.7 + state.energy * 0.9 + blink * 1.2;
    }

    if (this.composer) {
      try {
        this.composer.render();
      } catch {
        // Self-heal: if the bloom pipeline breaks at runtime, stop trying
        // it every frame and fall back to a plain render instead of
        // leaving the canvas broken/blank.
        this.composer = null;
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
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
