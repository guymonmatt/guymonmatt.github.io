// Exponential smoothing so raw per-frame detections don't cause jittery
// biome jumps, plus small ambient signals that aren't tied to the face.

export class Smoother {
  /**
   * @param {number} defaultAlpha - EMA rate for keys not listed in `alphaByKey`.
   * @param {Record<string, number>} alphaByKey - per-key overrides, e.g. slow
   *   for stable "who is this" signals, faster for live expression signals.
   */
  constructor(defaultAlpha = 0.12, alphaByKey = {}) {
    this.defaultAlpha = defaultAlpha;
    this.alphaByKey = alphaByKey;
    this.values = null;
  }

  push(sample) {
    if (!sample) {
      this.values = null;
      return null;
    }
    if (!this.values) {
      this.values = { ...sample };
      return this.values;
    }
    for (const key of Object.keys(sample)) {
      if (typeof sample[key] !== "number") continue;
      const alpha = this.alphaByKey[key] ?? this.defaultAlpha;
      this.values[key] = lerp(this.values[key] ?? sample[key], sample[key], alpha);
    }
    return this.values;
  }
}

/** 0 at midnight, 1 at solar noon-ish (peaks around 2pm, cool at night). */
export function ambientFromClock(date = new Date()) {
  const hours = date.getHours() + date.getMinutes() / 60;
  const dayWarmth = Math.max(0, Math.sin(((hours - 6) / 24) * Math.PI * 2 * -1 + Math.PI / 2));
  return { dayWarmth: clamp01(0.5 * dayWarmth + 0.25) };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
