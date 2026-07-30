// Continuous color-reactivity for the psychedelic forest — replaces the
// discrete biome system from the Biome Mirror app with a constantly
// shifting hue driven by live expression, seeded per-person so the
// starting point on the color wheel differs from viewer to viewer.

/**
 * dataPoints: same shape as face.js's detect() output, or null if nobody's
 * in frame. ambient: { dayWarmth } from state.js. time: seconds elapsed
 * (for continuous hue drift). pulses: { blinkPulse, gustPulse } 0..1 decaying
 * values from state.js's Pulse tracker.
 */
export function computePsychedelicState(dataPoints, ambient, time, pulses = {}) {
  const smile = dataPoints?.smile ?? 0.3;
  const size = dataPoints?.size ?? 0.4;
  const browRaise = dataPoints?.browRaise ?? 0.2;
  const dayWarmth = ambient?.dayWarmth ?? 0.5;

  // Faceprint: stable per-person geometry ratios seed a starting hue, so
  // the same expression still looks different on different people.
  const eyeSpacing = dataPoints?.eyeSpacing ?? 0.5;
  const faceAspect = dataPoints?.faceAspect ?? 0.5;
  const noseWidth = dataPoints?.noseWidth ?? 0.5;
  const jawWidth = dataPoints?.jawWidth ?? 0.5;
  const personalHue = mod360(
    eyeSpacing * 137.5 + faceAspect * 231.7 + noseWidth * 97.3 + jawWidth * 181.9
  );

  const energy = clamp01(0.3 + 0.7 * browRaise);
  const density = clamp01(0.35 + 0.65 * size);
  const warmthLift = clamp01(0.5 * smile + 0.3 * dayWarmth);

  // The hue continuously drifts around the wheel starting from your
  // personal seed; smiling/energy speed the drift up.
  const hueSpeed = 6 + smile * 26 + energy * 12;
  const hue = mod360(personalHue + time * hueSpeed);

  const saturation = clamp01(0.55 + 0.35 * smile);
  const lightness = clamp01(0.45 + 0.15 * warmthLift);

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

  return {
    hue,
    saturation,
    lightness,
    energy,
    density,
    personalHue,
    tilt: dataPoints?.tilt ?? 0,
    panX: dataPoints?.x ?? 0.5,
    panY: dataPoints?.y ?? 0.5,
    hasFace: !!dataPoints,
    personal: { skin, hair },
    blinkPulse: pulses.blinkPulse ?? 0,
    gustPulse: pulses.gustPulse ?? 0,
  };
}

function mod360(v) {
  return ((v % 360) + 360) % 360;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
