export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToCss({ r, g, b }, a = 1) {
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})`;
}

export function lerpRgb(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/**
 * Blends a set of same-length hex-color arrays (one per biome) weighted by
 * `blend`, returning a single array of CSS rgb strings of the same length.
 */
export function blendPalette(blend, field) {
  const stopCount = blend[0].biome[field].length;
  const stops = [];
  for (let i = 0; i < stopCount; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const { biome, weight } of blend) {
      const c = hexToRgb(biome[field][i]);
      r += c.r * weight;
      g += c.g * weight;
      b += c.b * weight;
    }
    stops.push({ r, g, b });
  }
  return stops;
}

export function blendColor(blend, hexPicker) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const { biome, weight } of blend) {
    const c = hexToRgb(hexPicker(biome));
    r += c.r * weight;
    g += c.g * weight;
    b += c.b * weight;
  }
  return { r, g, b };
}
