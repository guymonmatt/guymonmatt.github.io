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
    sky: ["#1c2a38", "#48627a", "#c7d3d8"],
    ground: ["#cdd6d2", "#a3aead"],
    foliage: ["#8b9993", "#6b7c78"],
    particle: { type: "snow", color: "#eef2f0", baseDensity: 0.6 },
  },
  {
    id: "alpine",
    name: "Alpine Meadow",
    warmth: 0.3,
    density: 0.4,
    sky: ["#28374c", "#5a7189", "#c9d6d6"],
    ground: ["#748a5e", "#546b4b"],
    foliage: ["#8a9e6a", "#a99a80"],
    particle: { type: "petal", color: "#c9b3a8", baseDensity: 0.35 },
  },
  {
    id: "redwood",
    name: "Redwood Forest",
    warmth: 0.35,
    density: 0.9,
    sky: ["#141f1a", "#2c3d34", "#57685c"],
    ground: ["#3c2f24", "#2a2118"],
    foliage: ["#33513f", "#243c30"],
    particle: { type: "fog", color: "#b6c4bb", baseDensity: 0.4 },
  },
  {
    id: "rainforest",
    name: "Rainforest",
    warmth: 0.55,
    density: 1.0,
    sky: ["#10201a", "#1f3a2d", "#375648"],
    ground: ["#39432c", "#272f1e"],
    foliage: ["#3d7355", "#679270"],
    particle: { type: "firefly", color: "#d9dd9a", baseDensity: 0.5 },
  },
  {
    id: "bamboo",
    name: "Bamboo Grove",
    warmth: 0.5,
    density: 0.7,
    sky: ["#1a2822", "#33473c", "#7c9a89"],
    ground: ["#4c5942", "#38452a"],
    foliage: ["#6a8c6e", "#93a880"],
    particle: { type: "leaf", color: "#c4d2a8", baseDensity: 0.3 },
  },
  {
    id: "savanna",
    name: "Savanna",
    warmth: 0.75,
    density: 0.35,
    sky: ["#33270f", "#8a6435", "#dbb375"],
    ground: ["#b8925a", "#8f6f3c"],
    foliage: ["#7c6e36", "#6b5a2e"],
    particle: { type: "pollen", color: "#e3cd93", baseDensity: 0.35 },
  },
  {
    id: "desert",
    name: "Desert",
    warmth: 0.9,
    density: 0.05,
    sky: ["#2c1e13", "#805636", "#d9ac74"],
    ground: ["#c99f64", "#a97d47"],
    foliage: ["#7c6640", "#5f4e33"],
    particle: { type: "sand", color: "#dcc094", baseDensity: 0.45 },
  },
  {
    id: "autumn",
    name: "Autumn Woodland",
    warmth: 0.7,
    density: 0.6,
    sky: ["#241611", "#6e4128", "#c1875a"],
    ground: ["#5e3f28", "#402c1c"],
    foliage: ["#9c5030", "#b3763c"],
    particle: { type: "leaf", color: "#c98f4a", baseDensity: 0.55 },
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
