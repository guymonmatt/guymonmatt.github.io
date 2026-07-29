// Biome definitions and the scoring function that maps smoothed data points
// (from face.js + ambient signals) onto a weighted blend of biomes.
//
// Each biome sits at a point in a (warmth, density) plane. Rather than
// snapping hard between biomes, we compute inverse-distance weights across
// all of them so the scene continuously morphs as the input signals drift.

export const BIOMES = [
  {
    id: "tundra",
    name: "Arctic Tundra",
    warmth: 0.05,
    density: 0.15,
    sky: ["#0d1b2a", "#3a5a78", "#c9dbe8"],
    ground: ["#dce8ef", "#a9bfcb"],
    foliage: ["#8fa9b3", "#5c7a86"],
    particle: { type: "snow", color: "#ffffff", baseDensity: 0.6 },
  },
  {
    id: "alpine",
    name: "Alpine Meadow",
    warmth: 0.3,
    density: 0.4,
    sky: ["#1b2b4b", "#4d6d9a", "#cfe0ee"],
    ground: ["#6f8f5b", "#4c6b3f"],
    foliage: ["#8fb56a", "#c98fd6"],
    particle: { type: "petal", color: "#e6a8e0", baseDensity: 0.35 },
  },
  {
    id: "redwood",
    name: "Redwood Forest",
    warmth: 0.35,
    density: 0.9,
    sky: ["#0c1712", "#1f3329", "#4b6a52"],
    ground: ["#3c2a1e", "#2a1d15"],
    foliage: ["#1f4d33", "#123322"],
    particle: { type: "fog", color: "#bcd4c4", baseDensity: 0.4 },
  },
  {
    id: "rainforest",
    name: "Rainforest",
    warmth: 0.55,
    density: 1.0,
    sky: ["#04140f", "#0e2e22", "#1f4d34"],
    ground: ["#2b3a1e", "#1c2814"],
    foliage: ["#1e7a4a", "#8fd96b"],
    particle: { type: "firefly", color: "#e8ff9e", baseDensity: 0.5 },
  },
  {
    id: "bamboo",
    name: "Bamboo Grove",
    warmth: 0.5,
    density: 0.7,
    sky: ["#12241d", "#254a3a", "#79b89a"],
    ground: ["#4a5a3a", "#33421f"],
    foliage: ["#5fa06a", "#8fc98a"],
    particle: { type: "leaf", color: "#cdeab0", baseDensity: 0.3 },
  },
  {
    id: "savanna",
    name: "Savanna",
    warmth: 0.75,
    density: 0.35,
    sky: ["#3a2a12", "#a86a2e", "#f2c069"],
    ground: ["#c99a4a", "#9c7331"],
    foliage: ["#8a7a2e", "#6b5c22"],
    particle: { type: "pollen", color: "#f4e19c", baseDensity: 0.35 },
  },
  {
    id: "desert",
    name: "Desert",
    warmth: 0.9,
    density: 0.05,
    sky: ["#2c1810", "#8a4a24", "#f3b969"],
    ground: ["#d9a154", "#b97c3a"],
    foliage: ["#8a7040", "#6b5730"],
    particle: { type: "sand", color: "#e8c98a", baseDensity: 0.45 },
  },
  {
    id: "autumn",
    name: "Autumn Woodland",
    warmth: 0.7,
    density: 0.6,
    sky: ["#26140f", "#7a3a24", "#e08a3e"],
    ground: ["#6b4326", "#4a2d18"],
    foliage: ["#c1552c", "#e0912f"],
    particle: { type: "leaf", color: "#e0912f", baseDensity: 0.55 },
  },
];

/**
 * dataPoints: { size, smile, tilt, blink, browRaise, x, y } from face.js
 * (all 0..1 except tilt which is radians), or null when no face is present.
 * ambient: { dayWarmth } 0..1, derived from the device clock.
 */
export function computeBiomeBlend(dataPoints, ambient) {
  const smile = dataPoints?.smile ?? 0.3;
  const size = dataPoints?.size ?? 0.4;
  const browRaise = dataPoints?.browRaise ?? 0.2;
  const dayWarmth = ambient?.dayWarmth ?? 0.5;

  // Faceprint: stable per-person geometry ratios (defaults land at the
  // midpoint, i.e. contribute no bias, when nobody's in frame yet).
  const eyeSpacing = dataPoints?.eyeSpacing ?? 0.5;
  const faceAspect = dataPoints?.faceAspect ?? 0.5;
  const noseWidth = dataPoints?.noseWidth ?? 0.5;
  const jawWidth = dataPoints?.jawWidth ?? 0.5;
  const faceWarmthBias = clamp01(0.5 * eyeSpacing + 0.5 * noseWidth);
  const faceDensityBias = clamp01(0.5 * faceAspect + 0.5 * jawWidth);

  // Live expression carries the most weight so the scene still visibly
  // reacts to you; the faceprint bias shifts where that reaction centers,
  // so two people with the same expression land in different places.
  const warmth = clamp01(0.45 * smile + 0.3 * dayWarmth + 0.25 * faceWarmthBias);
  const density = clamp01(0.6 * size + 0.4 * faceDensityBias);
  const energy = clamp01(0.5 + 0.5 * browRaise);

  const skin = {
    r: dataPoints?.skinR ?? 200,
    g: dataPoints?.skinG ?? 190,
    b: dataPoints?.skinB ?? 170,
  };
  const hair = {
    r: dataPoints?.hairR ?? 90,
    g: dataPoints?.hairG ?? 70,
    b: dataPoints?.hairB ?? 60,
  };

  const weighted = BIOMES.map((biome) => {
    const dw = biome.warmth - warmth;
    const dd = biome.density - density;
    const distSq = dw * dw + dd * dd;
    const weight = 1 / (distSq + 0.02);
    return { biome, weight };
  });

  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  const blend = weighted
    .map((w) => ({ biome: w.biome, weight: w.weight / total }))
    .sort((a, b) => b.weight - a.weight);

  return {
    blend,
    top: blend[0].biome,
    warmth,
    density,
    energy,
    tilt: dataPoints?.tilt ?? 0,
    panX: dataPoints?.x ?? 0.5,
    panY: dataPoints?.y ?? 0.5,
    hasFace: !!dataPoints,
    personal: { skin, hair },
  };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
