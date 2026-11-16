// Synthetic native-filter evidence only: no camera, recognition, browser, downloads, or library edits.
// Run --scan for provisional candidates; the default regression MUST read explicit index options.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const ui = read('lib/ui-fBadYuor.js'), controller = read('lib/controller-mGt1s8dJ.js');
const three = read('lib/three.module.js'), html = read('index.html');
const nativeSource = ui.split('\n').slice(0, 23).join('\n');
assert.match(nativeSource, /class y/); assert.match(ui, /y as O/);
// Execute only the already-read native class and its two helpers, not the DOM-oriented UI.
const OneEuro = new Function(`${nativeSource}\nreturn y;`)();
const THREE = await import('data:text/javascript;base64,' + Buffer.from(three).toString('base64'));
const defaults = { minCutOff: Number(/VY = ([\de.-]+)/.exec(controller)[1]),
  beta: Number(/zY = ([\de.-]+)/.exec(controller)[1]) };
assert.deepEqual(defaults, { minCutOff: .001, beta: 1000 });
assert.match(controller, /filter\.filter\(Date\.now\(\), a\)/);
assert.match(controller, /filterMinCF = l === null \? VY : l/);
assert.match(controller, /filterBeta = c === null \? zY : c/);
const conversion = /  _glModelViewMatrix\(t, e\) \{[\s\S]*?\n  \}/.exec(controller)?.[0];
assert.ok(conversion, 'extract the actual controller conversion, not a substitute');
const cv = new Function(`return ({${conversion}});`)();
const W = 1024, H = 751, BOARD = 1.12, RAD = Math.PI / 180;
cv.markerDimensions = [[W, H]];
const { Vector3: V, Quaternion: Q, Matrix3: M3, Matrix4: M4, Euler } = THREE;
const post = new M4().compose(new V(W / 2, H / 2, 0), new Q(), new V(W, W, W));
const axis = new V(.35, 1, .2).normalize(), base = new Q().setFromEuler(new Euler(12 * RAD, -18 * RAD, 5 * RAD));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rms = xs => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
const max = xs => Math.max(...xs), round = n => +n.toFixed(6);
function rng(seed) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
function rawGL(p, q) {
  // CV modelview is in target-image pixels, not normalized anchor or screen coordinates.
  const origin = p.clone().sub(new V(W / 2, H / 2, 0).applyQuaternion(q));
  const e = new M4().compose(origin, q, new V(1, 1, 1)).elements;
  return cv._glModelViewMatrix([[e[0], e[4], e[8], e[12]], [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]]], 0);
}
function inspect(a) {
  const matrix = new M4().fromArray(a), anchor = matrix.clone().multiply(post);
  const cols = [0, 1, 2].map(i => new V(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]));
  const lengths = cols.map(c => c.length());
  const shear = max([[0, 1], [0, 2], [1, 2]].map(([i, j]) => Math.abs(cols[i].dot(cols[j]) / lengths[i] / lengths[j])));
  // Polar projection is for measurement ONLY. The application still receives the native elements.
  let polar = new M3().setFromMatrix4(matrix);
  for (let k = 0; k < 5; k++) {
    const inverseT = polar.clone().invert().transpose();
    polar.elements = polar.elements.map((x, i) => (x + inverseT.elements[i]) / 2);
  }
  const q = new Q().setFromRotationMatrix(new M4().setFromMatrix3(polar)).normalize();
  let shapePx = 0;
  for (const x of [-BOARD / 2, BOARD / 2]) for (const y of [-BOARD * H / W / 2, BOARD * H / W / 2]) {
    const local = new V(x * W, y * W, 0);
    const actual = local.clone().applyMatrix3(new M3().setFromMatrix4(matrix));
    shapePx = Math.max(shapePx, actual.distanceTo(local.applyQuaternion(q)));
  }
  return { p: new V().setFromMatrixPosition(anchor), q, shear,
    scale: max(lengths.map(x => Math.abs(x - 1))), shapePx };
}
function pose(kind, t) {
  const p = new V(0, 0, 3 * W), q = base.clone(), s = clamp(t - 2, 0, 2);
  if (kind.startsWith('translate')) p.addScaledVector(new V(1, .3, -.15).normalize(), Number(kind.split(':')[1]) * W * s);
  if (kind.startsWith('rotate')) q.premultiply(new Q().setFromAxisAngle(axis, Number(kind.split(':')[1]) * RAD * s));
  if (kind.startsWith('sweep')) {
    const f = Number(kind.split(':')[1]), z = 2 * Math.PI * f * t;
    p.add(new V(.12 * W * Math.sin(z), .04 * W * Math.cos(z * .8), .025 * W * Math.sin(z * .7)));
    q.premultiply(new Q().setFromEuler(new Euler(4 * RAD * Math.cos(z * .8), 8 * RAD * Math.sin(z), 2 * RAD * Math.sin(z * .7))));
  }
  return { p, q };
}
const cases = [];
for (const fps of [30, 60]) for (const seed of [11, 29, 47]) {
  const specs = [
    ...[[.6, .06], [1.5, .15], [3, .3]].map(([p, r]) => ({ kind: 'static', noise: 'mixed', p, r })),
    ...[.7, 2, 6, 11].map(f => ({ kind: 'static', noise: 'sine', f, p: 3, r: .25 })),
    ...['translate:0.1', 'translate:0.3', 'rotate:15', 'rotate:35', 'sweep:0.25', 'sweep:0.75']
      .flatMap(kind => [0, 1].map(n => ({ kind, noise: n ? 'mixed' : 'none', p: n * 1.5, r: n * .15 })))
  ];
  for (const spec of specs) {
    const gaussian = rng(seed), state = Array(6).fill(0), frames = [];
    const duration = spec.kind === 'static' ? 10 : 7, rho = Math.exp(-2 * Math.PI * 2 / fps);
    for (let i = 0; i <= duration * fps; i++) {
      const t = i / fps, truthPose = pose(spec.kind, t), p = truthPose.p.clone(), q = truthPose.q.clone();
      const noise = state.map((v, j) => {
        state[j] = rho * v + Math.sqrt(1 - rho * rho) * gaussian();
        return spec.noise === 'sine' ? Math.SQRT2 * Math.sin(2 * Math.PI * spec.f * t + j * .81 + seed * .13)
          : spec.noise === 'mixed' ? .8 * gaussian() + .6 * state[j] : 0;
      });
      p.add(new V(...noise.slice(0, 3).map(n => n * spec.p)));
      q.premultiply(new Q().setFromEuler(new Euler(...noise.slice(3).map(n => n * spec.r * RAD))));
      const actual = rawGL(p, q), truth = inspect(rawGL(truthPose.p, truthPose.q));
      frames.push({ t, truth, actual, raw: inspect(actual) });
    }
    cases.push({ ...spec, fps, seed, frames });
  }
}
function measure(config, c) {
  const filter = new OneEuro(config), err = [], angle = [], rawP = [], rawR = [], shear = [], scale = [], shape = [];
  for (const f of c.frames) {
    const a = filter.filter(1700000000000 + Math.round(f.t * 1000), f.actual), o = inspect(a);
    const active = c.kind.startsWith('translate') || c.kind.startsWith('rotate') ? f.t >= 2.6 && f.t <= 3.8 : f.t >= 2;
    if (!active) continue;
    err.push(o.p.distanceTo(f.truth.p)); angle.push(o.q.angleTo(f.truth.q) / RAD);
    rawP.push(f.raw.p.distanceTo(f.truth.p)); rawR.push(f.raw.q.angleTo(f.truth.q) / RAD);
    shear.push(o.shear); scale.push(o.scale); shape.push(o.shapePx);
  }
  const result = { kind: c.kind, noise: c.noise, level: c.p, frequencyHz: c.f, fps: c.fps, seed: c.seed,
    rawPosRmsPx: rms(rawP), posRmsPx: rms(err), posMaxPx: max(err), rawAngleRmsDeg: rms(rawR), angleRmsDeg: rms(angle),
    angleMaxDeg: max(angle), shearMax: max(shear), scaleErrorMax: max(scale), shapeMaxPx: max(shape) };
  result.posRatio = result.rawPosRmsPx > 1e-6 ? result.posRmsPx / result.rawPosRmsPx : null;
  result.angleRatio = result.rawAngleRmsDeg > 1e-6 ? result.angleRmsDeg / result.rawAngleRmsDeg : null;
  if (c.noise === 'none' && c.kind.startsWith('translate')) result.translationLagMs = result.posRmsPx / (Number(c.kind.split(':')[1]) * W) * 1000;
  if (c.noise === 'none' && c.kind.startsWith('rotate')) result.rotationLagMs = result.angleRmsDeg / Number(c.kind.split(':')[1]) * 1000;
  return result;
}
// Minimum evidence gates: per-case/seed bounds, not just a favorable aggregate average.
const limits = { mixedPosRatioMax: .8, mixedAngleRatioMax: .8, highFrequencyRatioMax: .75,
  translationLagMaxMs: 65, rotationLagMaxMs: 70, rotationCenterRmsMaxPx: .02 * W, cleanSweepPosMaxPx: .03 * W,
  cleanSweepAngleRmsMaxDeg: 2, shearMax: .02, scaleErrorMax: .02, boardShapeMaxPx: .02 * W };
function run(config) {
  const rows = cases.map(c => measure(config, c));
  const worst = (f, key) => max(rows.filter(f).map(r => r[key]));
  const summary = { ...config,
    mixedPosRatio: worst(r => r.kind === 'static' && r.noise === 'mixed', 'posRatio'),
    mixedAngleRatio: worst(r => r.kind === 'static' && r.noise === 'mixed', 'angleRatio'),
    highFreqPosRatio: worst(r => r.frequencyHz >= 6, 'posRatio'),
    highFreqAngleRatio: worst(r => r.frequencyHz >= 6, 'angleRatio'),
    translationLagMs: worst(r => r.translationLagMs != null, 'translationLagMs'),
    rotationLagMs: worst(r => r.rotationLagMs != null, 'rotationLagMs'),
    rotationCenterRmsPx: worst(r => r.kind.startsWith('rotate'), 'posRmsPx'),
    sweepPosMaxPx: worst(r => r.kind.startsWith('sweep') && r.noise === 'none', 'posMaxPx'),
    sweepAngleRmsDeg: worst(r => r.kind.startsWith('sweep') && r.noise === 'none', 'angleRmsDeg'),
    shearMax: worst(() => true, 'shearMax'), scaleErrorMax: worst(() => true, 'scaleErrorMax'),
    boardShapeMaxPx: worst(() => true, 'shapeMaxPx') };
  const failures = [];
  for (const [field, bound] of [['mixedPosRatio', limits.mixedPosRatioMax], ['mixedAngleRatio', limits.mixedAngleRatioMax],
    ['highFreqPosRatio', limits.highFrequencyRatioMax], ['highFreqAngleRatio', limits.highFrequencyRatioMax],
    ['translationLagMs', limits.translationLagMaxMs], ['rotationLagMs', limits.rotationLagMaxMs],
    ['rotationCenterRmsPx', limits.rotationCenterRmsMaxPx], ['sweepPosMaxPx', limits.cleanSweepPosMaxPx], ['sweepAngleRmsDeg', limits.cleanSweepAngleRmsMaxDeg],
    ['shearMax', limits.shearMax], ['scaleErrorMax', limits.scaleErrorMax], ['boardShapeMaxPx', limits.boardShapeMaxPx]]) {
    if (!Number.isFinite(summary[field]) || summary[field] > bound) failures.push(`${field}: ${summary[field]} > ${bound}`);
  }
  return { summary, failures, rows };
}
const options = /new MindARThree\(\{([\s\S]*?)\}\)/.exec(html)?.[1];
assert.ok(options, 'find actual MindARThree constructor');
const explicit = { minCutOff: Number(/filterMinCF\s*:\s*([\de.-]+)/.exec(options)?.[1]),
  beta: Number(/filterBeta\s*:\s*([\de.-]+)/.exec(options)?.[1]) };
const scan = process.argv.includes('--scan');
const candidates = scan ? [.0025, .003, .0035, .004].flatMap(minCutOff => [.01, .025, .05, .1].map(beta => ({ minCutOff, beta }))) : [];
const baseline = run(defaults), beta100 = run({ ...defaults, beta: 100 });
assert.ok(baseline.failures.length && beta100.failures.length, 'minimum gates must reject both ineffective baselines');
const scans = candidates.map(c => run(c));
const details = rows => rows.filter(r => r.seed === 11).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])));
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
console.log(JSON.stringify({ syntheticOnly: true, units: 'ms; position=target-image px in camera coordinates (not screen px); rotation=degrees',
  target: { width: W, height: H, cameraDepth: 3 * W, boardWidth: BOARD * W }, fps: [30, 60], seeds: [11, 29, 47], cases: cases.length,
  source: { filter: 'lib/ui-fBadYuor.js:1-23 extracted verbatim; no DOM evaluation or vendor edits',
    controller: '_glModelViewMatrix extracted verbatim; postMatrix follows native target centering and width scaling',
    threeRevision: THREE.REVISION, filterHash: hash(nativeSource), conversionHash: hash(conversion), htmlHash: hash(html) },
  limits, explicitIndex: Number.isFinite(explicit.minCutOff) && Number.isFinite(explicit.beta) ? explicit : null,
  baseline: baseline.summary, beta100: beta100.summary,
  scan: scans.map(r => ({ ...r.summary, failures: r.failures })),
  limitations: ['No real-camera or recognition evidence; cannot claim measured device improvement.',
    'Lag is steady-motion pose RMS error / speed, not measured end-to-end latency. Startup warmup is excluded.',
    'Slow drift below the cutoff can pass. No target loss/reacquisition, outliers, rolling shutter, or illumination model.',
    'Native elementwise smoothing is not rigid: rotation metric uses measurement-only polar projection; shear, scale and 1.12-board deformation are reported separately.',
    'Noise is seeded independent Gaussian + 2Hz correlated noise, or 0.7/2/6/11Hz sine; movement includes continuous ramps and 0.25/0.75Hz smooth sweeps.'] }, null, 2));
if (scan) {
  const provisional = scans.find(r => r.summary.minCutOff === .0035 && r.summary.beta === .025);
  console.log(JSON.stringify({ provisional: provisional.summary, failures: provisional.failures, details: details(provisional.rows) }, null, 2));
} else {
  assert.ok(Number.isFinite(explicit.minCutOff) && Number.isFinite(explicit.beta), 'index must explicitly set filterMinCF/filterBeta; use --scan before the main agent writes them');
  const current = run(explicit);
  console.log(JSON.stringify({ current: current.summary, failures: current.failures, details: details(current.rows) }, null, 2));
  assert.deepEqual(current.failures, [], 'native index filter must meet independent minimum evidence thresholds');
  console.log('PASS: synthetic native-filter regression (not a real-device acceptance test)');
}
