// Bus geometry and motion are expressed in target-image-width units.
const WIDTH = 1745;
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function createBusLoop(meta, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new RangeError('options must be an object');
  }
  const { duration = 8, halfWidth = 0.56, margin = 0.02 } = options;
  if (!finite(duration) || duration <= 0 || !finite(halfWidth) || halfWidth <= 0 ||
      !finite(margin) || margin < 0) {
    throw new RangeError('duration and halfWidth must be positive; margin must be nonnegative');
  }
  const rect = meta?.rects?.bus;
  const wheels = meta?.wheels;
  const rollingRadius = meta?.wheelFaces?.[0]?.rollingRadius;
  if (!Array.isArray(rect) || rect.length !== 4 || ![rect[0], rect[1], rect[2], rect[3]].every(finite) ||
      rect[0] >= rect[2] || rect[1] >= rect[3] ||
      !Array.isArray(wheels) || !wheels.length || !finite(rollingRadius) || rollingRadius <= 0) {
    throw new RangeError('invalid bus geometry or rolling radius');
  }
  let minX = rect[0], maxX = rect[2];
  for (const wheel of wheels) {
    if (!Array.isArray(wheel) || wheel.length !== 3 ||
        ![wheel[0], wheel[1], wheel[2]].every(finite) || wheel[2] <= 0) {
      throw new RangeError('invalid wheel geometry');
    }
    minX = Math.min(minX, wheel[0] - wheel[2]);
    maxX = Math.max(maxX, wheel[0] + wheel[2]);
  }
  const left = minX / WIDTH - 0.5, right = maxX / WIDTH - 0.5;
  const radius = rollingRadius / WIDTH;
  const start = -halfWidth - right - margin, end = halfWidth - left + margin;
  const span = end - start, speed = span / duration;
  if (![left, right, radius, start, end, span, speed].every(finite) ||
      radius <= 0 || span <= 0 || speed <= 0) {
    throw new RangeError('bus loop is outside the supported numeric range');
  }
  function sample(elapsed) {
    if (!finite(elapsed)) throw new RangeError('elapsed time must be finite');
    if (elapsed <= 0) return { x: start, angle: 0 };
    const distance = speed * elapsed;
    const x = start + distance % span, angle = -distance / radius;
    if (![distance, x, angle].every(finite)) throw new RangeError('elapsed time is too large');
    return { x, angle };
  }
  return { start, end, span, left, right, radius, duration, sample };
}
