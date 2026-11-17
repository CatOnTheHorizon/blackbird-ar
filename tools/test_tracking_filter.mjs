// Node-only synthetic evidence: real vendor conversion/filter + extracted application follower.
// Default: current native + actual createPoseFollower, compared with raw and frozen v31 native.
// --mode=legacy-v31 retains the original 114-case/native-only gates; --scan is diagnostic only.
// --details includes every measured row. This is NOT a camera, recognition, or phone acceptance test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const ui = read('lib/ui-fBadYuor.js'), controller = read('lib/controller-mGt1s8dJ.js');
const three = read('lib/three.module.js'), html = read('index.html');
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`), end = html.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, `extract actual top-level ${name}`);
  return html.slice(start, end + 2);
}
const nativeSource = ui.split('\n').slice(0, 23).join('\n');
assert.match(nativeSource, /class y/); assert.match(ui, /y as O/);
const OneEuro = new Function(`${nativeSource}\nreturn y;`)();
const THREE = await import('data:text/javascript;base64,' + Buffer.from(three).toString('base64'));
const followerSource = extractFunction('createPoseFollower');
const createPoseFollower = new Function('THREE', `${followerSource}\nreturn createPoseFollower;`)(THREE);
const defaults = { minCutOff: Number(/VY = ([\de.-]+)/.exec(controller)[1]),
  beta: Number(/zY = ([\de.-]+)/.exec(controller)[1]) };
assert.deepEqual(defaults, { minCutOff: .001, beta: 1000 });
assert.match(controller, /filter\.filter\(Date\.now\(\), a\)/);
assert.match(controller, /filterMinCF = l === null \? VY : l/);
assert.match(controller, /filterBeta = c === null \? zY : c/);
const conversion = /  _glModelViewMatrix\(t, e\) \{[\s\S]*?\n  \}/.exec(controller)?.[0];
assert.ok(conversion, 'extract actual controller conversion, not a substitute');
const cv = new Function(`return ({${conversion}});`)();
const W = 1024, H = 751, BOARD = 1.12, RAD = Math.PI / 180;
cv.markerDimensions = [[W, H]];
const { Vector3: V, Quaternion: Q, Matrix3: M3, Matrix4: M4, Euler, Group } = THREE;
// Matches the checked-in MindAR postMatrix (target centering + target-width scale).
const post = new M4().compose(new V(W / 2, H / 2, 0), new Q(), new V(W, W, W));
const axis = new V(.35, 1, .2).normalize(), base = new Q().setFromEuler(new Euler(12 * RAD, -18 * RAD, 5 * RAD));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rms = xs => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
const max = xs => Math.max(...xs);
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const corners = [-1, 1].flatMap(x => [-1, 1].map(y => new V(x * BOARD / 2, y * BOARD * H / W / 2, 0)));
function rng(seed) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + .5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
function rawGL(p, q) {
  // CV modelview is in target-image pixels, not normalized-anchor or screen coordinates.
  const origin = p.clone().sub(new V(W / 2, H / 2, 0).applyQuaternion(q));
  const e = new M4().compose(origin, q, new V(1, 1, 1)).elements;
  return cv._glModelViewMatrix([[e[0], e[4], e[8], e[12]], [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]]], 0);
}
function inspectAnchor(matrix) {
  const a = matrix.elements;
  const cols = [0, 1, 2].map(i => new V(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]).multiplyScalar(1 / W));
  const lengths = cols.map(c => c.length());
  const shear = max([[0, 1], [0, 2], [1, 2]].map(([i, j]) => Math.abs(cols[i].dot(cols[j]) / lengths[i] / lengths[j])));
  // Polar projection is measurement ONLY, including for old non-rigid native matrices.
  // The current application is executed verbatim and uses its own actual Gram-Schmidt.
  let polar = new M3().setFromMatrix4(matrix).multiplyScalar(1 / W);
  for (let k = 0; k < 5; k++) {
    const inverseT = polar.clone().invert().transpose();
    polar.elements = polar.elements.map((x, i) => (x + inverseT.elements[i]) / 2);
  }
  const q = new Q().setFromRotationMatrix(new M4().setFromMatrix3(polar)).normalize();
  const linear = new M3().setFromMatrix4(matrix);
  const shapePx = max(corners.map(local => local.clone().applyMatrix3(linear)
    .distanceTo(local.clone().multiplyScalar(W).applyQuaternion(q))));
  return { p: new V().setFromMatrixPosition(matrix), q, shear,
    scale: max(lengths.map(x => Math.abs(x - 1))), uniformError: max(lengths) / Math.min(...lengths) - 1,
    shapePx, determinant: linear.determinant() / W ** 3,
    corners: corners.map(local => local.clone().applyMatrix4(matrix)) };
}
function inspect(a) { return inspectAnchor(new M4().fromArray(a).multiply(post)); }
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
function truthAt(kind, t) { const p = pose(kind, t); return inspect(rawGL(p.p, p.q)); }
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
assert.equal(cases.length, 114, 'preserve all original tracking scenarios');
const active = (c, t) => c.kind.startsWith('translate') || c.kind.startsWith('rotate')
  ? t >= 2.6 - 1e-9 && t <= 3.8 + 1e-9 : t >= 2 - 1e-9;
function collector(c, renderFps = null) {
  const err = [], angle = [], rawP = [], rawR = [], shear = [], scale = [], shape = [], corner = [], cornerMax = [], uniform = [];
  return {
    add(o, truth, raw) {
      err.push(o.p.distanceTo(truth.p)); angle.push(o.q.angleTo(truth.q) / RAD);
      rawP.push(raw.p.distanceTo(truth.p)); rawR.push(raw.q.angleTo(truth.q) / RAD);
      shear.push(o.shear); scale.push(o.scale); shape.push(o.shapePx); uniform.push(o.uniformError);
      const ce = o.corners.map((p, i) => p.distanceTo(truth.corners[i]));
      corner.push(...ce); cornerMax.push(max(ce));
      assert.ok([o.p.x, o.p.y, o.p.z, o.q.x, o.q.y, o.q.z, o.q.w, o.determinant, ...ce].every(Number.isFinite), 'finite measured pose');
      assert.ok(o.determinant > 0, 'right-handed measured pose');
    },
    result() {
      assert.ok(err.length, 'nonempty active measurement window');
      const result = { kind: c.kind, noise: c.noise, level: c.p, frequencyHz: c.f, fps: c.fps, renderFps, seed: c.seed,
        rawPosRmsPx: rms(rawP), posRmsPx: rms(err), posMaxPx: max(err), rawAngleRmsDeg: rms(rawR), angleRmsDeg: rms(angle),
        angleMaxDeg: max(angle), shearMax: max(shear), scaleErrorMax: max(scale), uniformErrorMax: max(uniform), shapeMaxPx: max(shape),
        cornerRmsPx: rms(corner), cornerMaxPx: max(cornerMax) };
      result.posRatio = result.rawPosRmsPx > 1e-6 ? result.posRmsPx / result.rawPosRmsPx : null;
      result.angleRatio = result.rawAngleRmsDeg > 1e-6 ? result.angleRmsDeg / result.rawAngleRmsDeg : null;
      if (c.noise === 'none' && c.kind.startsWith('translate')) result.translationLagMs = result.posRmsPx / (Number(c.kind.split(':')[1]) * W) * 1000;
      if (c.noise === 'none' && c.kind.startsWith('rotate')) result.rotationLagMs = result.angleRmsDeg / Number(c.kind.split(':')[1]) * 1000;
      return result;
    }
  };
}
function measureNative(config, c) {
  const filter = new OneEuro(config), metrics = collector(c);
  for (const f of c.frames) {
    const o = inspect(filter.filter(1700000000000 + Math.round(f.t * 1000), f.actual));
    if (active(c, f.t)) metrics.add(o, f.truth, f.raw);
  }
  return metrics.result();
}
// These are the unchanged v31 minimum gates, not tuned down to accommodate a new pipeline.
const limits = { mixedPosRatioMax: .8, mixedAngleRatioMax: .8, highFrequencyRatioMax: .75,
  translationLagMaxMs: 65, rotationLagMaxMs: 70, rotationCenterRmsMaxPx: .02 * W, cleanSweepPosMaxPx: .03 * W,
  cleanSweepAngleRmsMaxDeg: 2, shearMax: .02, scaleErrorMax: .02, boardShapeMaxPx: .02 * W };
function summarize(rows) {
  const worst = (f, key) => max(rows.filter(f).map(r => r[key]));
  return {
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
    uniformErrorMax: worst(() => true, 'uniformErrorMax'), boardShapeMaxPx: worst(() => true, 'shapeMaxPx'),
    staticCornerRmsMaxPx: worst(r => r.kind === 'static', 'cornerRmsPx'),
    cleanSweepCornerRmsMaxPx: worst(r => r.kind.startsWith('sweep') && r.noise === 'none', 'cornerRmsPx'),
    cleanSweepCornerMaxPx: worst(r => r.kind.startsWith('sweep') && r.noise === 'none', 'cornerMaxPx')
  };
}
function check(summary) {
  const failures = [];
  for (const [field, bound] of [['mixedPosRatio', limits.mixedPosRatioMax], ['mixedAngleRatio', limits.mixedAngleRatioMax],
    ['highFreqPosRatio', limits.highFrequencyRatioMax], ['highFreqAngleRatio', limits.highFrequencyRatioMax],
    ['translationLagMs', limits.translationLagMaxMs], ['rotationLagMs', limits.rotationLagMaxMs],
    ['rotationCenterRmsPx', limits.rotationCenterRmsMaxPx], ['sweepPosMaxPx', limits.cleanSweepPosMaxPx], ['sweepAngleRmsDeg', limits.cleanSweepAngleRmsMaxDeg],
    ['shearMax', limits.shearMax], ['scaleErrorMax', limits.scaleErrorMax], ['boardShapeMaxPx', limits.boardShapeMaxPx]]) {
    if (!Number.isFinite(summary[field]) || summary[field] > bound) failures.push(`${field}: ${summary[field]} > ${bound}`);
  }
  return failures;
}
function runNative(config) {
  const rows = cases.map(c => measureNative(config, c)), summary = summarize(rows);
  return { config, summary, failures: check(summary), rows };
}
const v31Config = Object.freeze({ minCutOff: .0035, beta: .025 });
assert.match(html, /class\s+ARSession\s+extends\s+MindARThree\s*\{/, 'actual ARSession must extend the vendor MindARThree');
const options = /new\s+ARSession\s*\(\{([\s\S]*?)\}\)/.exec(html)?.[1];
assert.ok(options, 'find actual ARSession (extends MindARThree) constructor');
const explicit = { minCutOff: Number(/filterMinCF\s*:\s*([\de.-]+)/.exec(options)?.[1]),
  beta: Number(/filterBeta\s*:\s*([\de.-]+)/.exec(options)?.[1]) };
assert.ok(Number.isFinite(explicit.minCutOff) && Number.isFinite(explicit.beta), 'index must explicitly set finite native filter parameters');
const mode = process.argv.includes('--scan') ? 'legacy-scan' : process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'pipeline';
assert.ok(['pipeline', 'legacy-v31', 'legacy-scan'].includes(mode), 'supported --mode=pipeline|legacy-v31|legacy-scan');
const baseline = runNative(defaults), beta100 = runNative({ ...defaults, beta: 100 }), legacy = runNative(v31Config);
assert.ok(baseline.failures.length && beta100.failures.length, 'unchanged minimum gates must still reject ineffective native baselines');
const metadata = {
  syntheticOnly: true, mode, units: 'ms; position/corners=target-image px in camera coordinates (NOT screen px); rotation=degrees',
  target: { width: W, height: H, cameraDepth: 3 * W, boardWidth: BOARD * W }, trackingFps: [30, 60],
  renderFps: mode === 'pipeline' ? [30, 60] : null,
  seeds: [11, 29, 47], originalTrackingCases: cases.length,
  source: { index: path.join(root, 'index.html'), filter: 'lib/ui-fBadYuor.js:1-23 extracted verbatim',
    controller: '_glModelViewMatrix extracted verbatim; native target-centering and width-scaling postMatrix',
    follower: 'actual top-level createPoseFollower extracted verbatim, real THREE.Group/Vector3/Quaternion/Matrix4',
    threeRevision: THREE.REVISION, filterHash: hash(nativeSource), conversionHash: hash(conversion), followerHash: hash(followerSource), htmlHash: hash(html) },
  unchangedV31Limits: limits, explicitIndex: explicit,
  legacyV31NativeOnly: { config: v31Config, summary: legacy.summary, failures: legacy.failures },
  ineffectiveNativeDiagnostics: { default: baseline.summary, beta100: beta100.summary },
  boundaries: [
    'No camera, recognition, browser, GPU, network, phone render performance, or measured device-improvement evidence.',
    'The input-canvas scaling itself is checked in test_tracking_pipeline.mjs, not modeled as recognition speed/accuracy here.',
    'Lag is steady-motion pose RMS error / speed, not end-to-end latency. Startup warmup is excluded.',
    'Rendering uses sample-before-render when timestamps coincide and holds the last sample otherwise; continuous ground truth is used at each render.',
    'Raw and v31 render comparisons therefore include sample-and-hold error at 30 tracking / 60 render; the original v31 native-only gates use sample times.',
    'Old native matrices are not rigid; measurement-only polar projection supplies their rotation metric. Shear, scale and board deformation are separately reported.',
    'Current followers execute actual Gram-Schmidt + quaternion smoothing; no test-side copy of their smoothing algorithm is used.',
    'Seeded independent Gaussian + 2Hz correlated noise, or 0.7/2/6/11Hz sine; ramps and 0.25/0.75Hz smooth sweeps are synthetic.',
    'Slow drift, rolling shutter, target-recognition outliers, illumination and real scheduling are not modeled. Loss/reset/reacquisition and invalid matrices have separate fake-clock helper tests.'
  ]
};
if (mode !== 'pipeline') {
  const scans = mode === 'legacy-scan' ? [.0025, .003, .0035, .004]
    .flatMap(minCutOff => [.01, .025, .05, .1].map(beta => runNative({ minCutOff, beta }))) : [];
  console.log(JSON.stringify({ ...metadata, diagnosticOnly: mode === 'legacy-scan',
    scan: scans.map(({ config, summary, failures }) => ({ config, summary, failures })),
    ...(process.argv.includes('--details') ? { legacyRows: legacy.rows } : {}) }, null, 2));
  assert.deepEqual(legacy.failures, [], 'frozen v31 native-only baseline must retain its original gates');
  console.log(`PASS: ${mode} synthetic historical evidence only; NOT current v33 acceptance`);
} else {
  const currentNative = runNative(explicit);
  const measures = { raw: [], legacyV31: [], currentNativeOnly: [], currentPipeline: [] };
  function measureRendered(c, renderFps) {
    const native = new OneEuro(explicit), old = new OneEuro(v31Config), visual = new Group(), follower = createPoseFollower(visual);
    const metrics = Object.fromEntries(Object.keys(measures).map(k => [k, collector(c, renderFps)]));
    let next = 0, lastRaw, lastOld, lastNative, previousRender = 0;
    const duration = c.frames.at(-1).t;
    for (let i = 0; i <= Math.round(duration * renderFps); i++) {
      const t = i / renderFps;
      while (next < c.frames.length && c.frames[next].t <= t + 1e-9) {
        const f = c.frames[next++], stamp = 1700000000000 + Math.round(f.t * 1000);
        lastRaw = f.raw;
        lastOld = inspect(old.filter(stamp, f.actual));
        const nativeElements = native.filter(stamp, f.actual);
        lastNative = inspect(nativeElements);
        assert.equal(follower.sample(new M4().fromArray(nativeElements).multiply(post), f.t * 1000), true,
          `actual follower must accept finite native pose: ${c.kind}/${c.fps}/${c.seed}`);
      }
      assert.equal(follower.update(t - previousRender, t * 1000), true, 'rendered follower remains live');
      previousRender = t;
      visual.updateMatrix();
      const output = inspectAnchor(visual.matrix);
      assert.ok(Math.abs(visual.quaternion.length() - 1) < 1e-12, 'actual follower quaternion remains normalized');
      if (!active(c, t)) continue;
      const truth = truthAt(c.kind, t);
      for (const [key, value] of Object.entries({ raw: lastRaw, legacyV31: lastOld, currentNativeOnly: lastNative, currentPipeline: output })) {
        metrics[key].add(value, truth, lastRaw);
      }
    }
    for (const key of Object.keys(measures)) measures[key].push(metrics[key].result());
  }
  for (const c of cases) for (const renderFps of [30, 60]) measureRendered(c, renderFps);
  assert.equal(measures.currentPipeline.length, 228, 'all 114 tracking scenarios at both render rates');
  const comparisons = Object.fromEntries(Object.entries(measures).map(([key, rows]) => [key, {
    summary: summarize(rows), byCadence: [30, 60].flatMap(fps => [30, 60].map(renderFps => ({ trackingFps: fps, renderFps,
      summary: summarize(rows.filter(r => r.fps === fps && r.renderFps === renderFps)) })))
  }]));
  const summary = comparisons.currentPipeline.summary, failures = check(summary);
  // Additional rigid-output gates, in addition to (not replacing) every original v31 gate.
  const rigidLimits = { shearMax: 1e-10, uniformErrorMax: 1e-10, scaleErrorMax: 1e-4, boardShapeMaxPx: .0002 * W };
  for (const [key, bound] of Object.entries(rigidLimits)) {
    if (!Number.isFinite(summary[key]) || summary[key] > bound) failures.push(`rigid ${key}: ${summary[key]} > ${bound}`);
  }
  if (explicit.minCutOff !== 1 || explicit.beta !== 0) failures.push('v33 native must explicitly use finite near-pass filterMinCF:1, filterBeta:0');
  const differencesFromV31 = Object.fromEntries(Object.keys(summary).map(k => [k, summary[k] - comparisons.legacyV31.summary[k]]));
  console.log(JSON.stringify({ ...metadata, renderedScenarioPairs: measures.currentPipeline.length,
    currentNativeOnlyDiagnostic: { config: explicit, summary: currentNative.summary,
      oldImprovementGateFailuresExpectedForNearPass: currentNative.failures,
      acceptance: 'DIAGNOSTIC ONLY: native near-pass is not claimed to pass old noise-improvement gates' },
    comparisons, currentRegression: { summary, rigidLimits, failures, deltaFromV31WorstCases: differencesFromV31,
      deltaNote: 'Difference of per-metric worst cases, not paired significance or a universal improvement claim.' },
    ...(process.argv.includes('--details') ? { rows: measures, legacyNativeOnlyRows: legacy.rows } : {}) }, null, 2));
  assert.deepEqual(legacy.failures, [], 'frozen v31 native-only baseline must retain its original gates');
  assert.deepEqual(failures, [], 'current native + actual pose follower must meet unchanged minimum and rigid-output gates');
  console.log('PASS: synthetic current native + actual createPoseFollower regression; NOT a real-device acceptance test');
}
