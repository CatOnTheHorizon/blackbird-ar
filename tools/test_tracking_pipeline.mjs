// Node-only regression of REAL top-level helpers and startAR, with controlled DOM/media/clock adapters.
// Uses checked-in THREE math/scene classes. No camera, audio, network, browser, GPU, or phone acceptance.
// Run anywhere: node C:/Users/amst/blackbird-ar/tools/test_tracking_pipeline.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const threeSource = fs.readFileSync(path.join(root, 'lib/three.module.js'), 'utf8');
const THREE = await import('data:text/javascript;base64,' + Buffer.from(threeSource).toString('base64'));
const { Vector3: V, Quaternion: Q, Matrix3: M3, Matrix4: M4, Euler, Group, Scene, PerspectiveCamera } = THREE;
function extract(name, async = false) {
  const marker = `${async ? 'async ' : ''}function ${name}(`;
  const start = html.indexOf(marker), end = html.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, `actual top-level ${name} must exist`);
  assert.equal(html.indexOf(marker, start + marker.length), -1, `unambiguous ${name}`);
  return html.slice(start, end + 2);
}
const inputSource = extract('createTrackingInput'), poseSource = extract('createPoseFollower'), entrySource = extract('startAR', true);
const createPoseFollower = new Function('THREE', `${poseSource}\nreturn createPoseFollower;`)(THREE);
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const results = [], observations = {};
async function test(name, run) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) {
    const detail = String(error.stack || error).split('\n').slice(0, 8).join('\n');
    results.push({ name, passed: false, error: detail }); console.error('FAIL ' + name + '\n' + detail);
  }
}
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
function matrixNear(a, b, tolerance = 1e-8) { a.elements.forEach((v, i) => near(v, b.elements[i], tolerance)); }
function quaternionNear(a, b, tolerance = 1e-7) { assert.ok(a.angleTo(b) <= tolerance, `quaternion angle ${a.angleTo(b)} > ${tolerance}`); }
function matrix(p = new V(), q = new Q(), scale = 1024) {
  return new M4().compose(p, q, typeof scale === 'number' ? new V(scale, scale, scale) : scale);
}
class Element {
  constructor(tag = 'div') {
    Object.assign(this, { tagName: tag.toUpperCase(), style: {}, hidden: false, textContent: '', parentNode: null,
      children: [], removeCalls: 0, listeners: new Map() });
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() { this.removeCalls++; this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type) { for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, target: this }); }
}
function mediaEnvironment({ width = 1920, height = 1080, rvfc = true, context = 'ok', drawError = false } = {}) {
  const canvases = [], failures = [], callbacks = new Map(), cancelled = [], requested = [];
  const track = { stops: 0, constraints: 0, clones: 0, stop() { this.stops++; },
    getSettings() { return { width, height, frameRate: 30 }; },
    applyConstraints() { this.constraints++; assert.fail('tracking may not change camera constraints'); },
    clone() { this.clones++; assert.fail('tracking may not clone a camera track'); } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track], clone() { assert.fail('tracking may not clone the stream'); } };
  let source = stream, next = 1;
  const video = new Element('video');
  Object.assign(video, { videoWidth: width, videoHeight: height, width, height, readyState: 2,
    paused: false, currentTime: 10, assignments: [], playCalls: 0, pauseCalls: 0,
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); }, pause() { this.pauseCalls++; this.paused = true; } });
  video.style.cssText = 'position:absolute;object-fit:cover;transform:none;';
  Object.defineProperty(video, 'srcObject', { get: () => source, set(value) { video.assignments.push(value); source = value; } });
  if (rvfc) {
    video.requestVideoFrameCallback = fn => { const id = next++; callbacks.set(id, fn); requested.push(id); return id; };
    video.cancelVideoFrameCallback = id => { cancelled.push(id); callbacks.delete(id); };
  }
  const document = new Element('document');
  document.hidden = false;
  const h = { video, stream, track, document, canvases, callbacks, cancelled, requested, failures, throwOnDraw: drawError,
    rafCalls: 0, mediaRequests: 0, drawAttempts: 0, now: 0 };
  document.createElement = tag => {
    assert.equal(tag, 'canvas', 'tracking input must not create a second video');
    const canvas = new Element('canvas');
    Object.assign(canvas, { width: 0, height: 0, draws: [], getContextCalls: [] });
    canvas.getContext = (...args) => {
      canvas.getContextCalls.push(args);
      assert.deepEqual(args, ['2d', { alpha: false }]);
      if (context === 'throw') throw new Error('2D context unavailable');
      if (context === 'null') return null;
      return { drawImage(...drawArgs) {
        h.drawAttempts++;
        if (h.throwOnDraw) throw new Error('controlled draw failure');
        canvas.draws.push(drawArgs);
      } };
    };
    canvases.push(canvas); return canvas;
  };
  const navigator = { mediaDevices: { getUserMedia() { h.mediaRequests++; assert.fail('tracking must reuse the existing stream'); } } };
  const forbiddenRAF = () => { h.rafCalls++; assert.fail('tracking helper must not create an extra rAF loop'); };
  h.createInput = new Function('document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame',
    inputSource + '\nreturn createTrackingInput;')(document, navigator, forbiddenRAF, forbiddenRAF);
  h.fire = (time = video.currentTime) => {
    video.currentTime = time;
    const first = callbacks.entries().next().value;
    assert.ok(first, 'a scheduled video-frame callback must exist');
    callbacks.delete(first[0]); first[1](h.now, { mediaTime: time, presentedFrames: requested.length });
  };
  h.assertCameraUntouched = () => {
    assert.equal(video.srcObject, stream); assert.deepEqual(video.assignments, []);
    assert.equal(video.videoWidth, width); assert.equal(video.videoHeight, height);
    assert.equal(video.width, width); assert.equal(video.height, height);
    assert.equal(video.style.cssText, 'position:absolute;object-fit:cover;transform:none;');
    assert.equal(video.playCalls, 0); assert.equal(video.pauseCalls, 0);
    assert.equal(track.stops, 0); assert.equal(track.constraints, 0); assert.equal(track.clones, 0);
    assert.equal(h.mediaRequests, 0); assert.equal(h.rafCalls, 0);
  };
  return h;
}
function makeInput(config = {}, options = {}) {
  const h = mediaEnvironment(config);
  h.input = h.createInput(h.video, { onFailure: error => h.failures.push(error), ...options });
  return h;
}
const sizes = [
  [3840, 2160, 800, 450], [1920, 1080, 800, 450], [1280, 720, 800, 450],
  [1920, 1440, 800, 600], [1080, 1920, 450, 800], [720, 1280, 450, 800],
  [3024, 4032, 600, 800], [4032, 3024, 800, 600], [2560, 1080, 768, 324]
];
for (const [width, height, outWidth, outHeight] of sizes) {
  await test(`input exact ratio and full-frame draw ${width}x${height} -> ${outWidth}x${outHeight}`, () => {
    const h = makeInput({ width, height }), s = h.input;
    assert.equal(s.scaled, true); assert.notEqual(s.input, h.video); assert.equal(h.canvases.length, 1);
    assert.equal(s.width, outWidth); assert.equal(s.height, outHeight);
    assert.equal(s.input.width, outWidth); assert.equal(s.input.height, outHeight);
    assert.equal(s.input.videoWidth, outWidth); assert.equal(s.input.videoHeight, outHeight);
    assert.equal(s.width * height, s.height * width, 'no integer-rounding aspect drift');
    assert.ok(Math.max(s.width, s.height) <= 800); assert.equal(s.input.parentNode, null);
    assert.deepEqual(s.input.draws, [[h.video, 0, 0, outWidth, outHeight]], 'five-argument full-frame draw, no crop or mirror');
    assert.equal(h.callbacks.size, 1); h.assertCameraUntouched(); s.dispose(); s.dispose();
    assert.equal(h.callbacks.size, 0); assert.equal(h.cancelled.length, 1); h.assertCameraUntouched();
  });
}
await test('input custom bound preserves ratio even when exact long edge cannot equal the bound', () => {
  const h = makeInput({ width: 1600, height: 900 }, { maxEdge: 799 });
  assert.equal(h.input.width, 784); assert.equal(h.input.height, 441);
  assert.equal(h.input.width * 900, h.input.height * 1600); h.input.dispose(); h.assertCameraUntouched();
});
for (const [width, height, maxEdge, reason] of [
  [640, 480, 800, 'small original'], [800, 450, 800, 'already at bound'],
  [1920, 1920, 800, 'square'], [1080, 1080, 800, 'square'],
  [1001, 563, 800, 'coprime exact-ratio fallback'], [8192, 1000, 800, 'reduced-ratio unit exceeds bound'],
  [1920, 1080, 0, 'explicit full'], [1920, 1080, -1, 'disabled scaling']
]) {
  await test(`input safe original-video fallback: ${reason}`, () => {
    const h = makeInput({ width, height }, { maxEdge });
    assert.equal(h.input.input, h.video); assert.equal(h.input.scaled, false);
    assert.equal(h.input.width, width); assert.equal(h.input.height, height);
    assert.equal(h.canvases.length, 0); assert.equal(h.callbacks.size, 0); assert.equal(h.drawAttempts, 0);
    h.video.currentTime += 1; h.input.refresh(); assert.equal(h.drawAttempts, 0);
    assert.equal(h.failures.length, 0); h.input.dispose(); h.input.dispose(); h.assertCameraUntouched();
  });
}
for (const config of [{ context: 'null' }, { context: 'throw' }, { drawError: true }]) {
  await test('input initial failure safely falls back, without a fatal callback: ' + JSON.stringify(config), () => {
    const h = makeInput(config);
    assert.equal(h.input.input, h.video); assert.equal(h.input.scaled, false);
    assert.equal(h.callbacks.size, 0); assert.equal(h.failures.length, 0);
    const attempts = h.drawAttempts; h.video.currentTime += 1; h.input.refresh(); assert.equal(h.drawAttempts, attempts);
    h.input.dispose(); h.assertCameraUntouched();
  });
}
await test('rVFC auto-refresh and manual refresh never redraw the same currentTime', () => {
  const h = makeInput(), c = h.input.input;
  h.input.refresh(); h.fire(); h.input.refresh(); assert.equal(c.draws.length, 1);
  h.video.currentTime += 1 / 30; h.input.refresh(); h.fire(); h.input.refresh(); assert.equal(c.draws.length, 2);
  h.fire(h.video.currentTime + 1 / 30); assert.equal(c.draws.length, 3); assert.equal(h.callbacks.size, 1);
  assert.ok(c.draws.every(args => args.length === 5 && args[0] === h.video && args[1] === 0 && args[2] === 0));
  h.input.dispose(); h.assertCameraUntouched();
});
await test('old browser uses caller refresh only; no rVFC and no additional rAF', () => {
  const h = makeInput({ rvfc: false }), c = h.input.input;
  assert.equal(h.callbacks.size, 0); h.input.refresh(); assert.equal(c.draws.length, 1);
  h.video.currentTime += 1 / 30; h.input.refresh(); h.input.refresh(); assert.equal(c.draws.length, 2);
  h.input.dispose(); h.assertCameraUntouched();
});
for (const state of ['paused', 'hidden', 'not-ready']) {
  await test(`input ${state} suppresses refresh; resume draws only the latest frame`, () => {
    const h = makeInput(), c = h.input.input;
    if (state === 'paused') h.video.paused = true;
    if (state === 'hidden') h.document.hidden = true;
    if (state === 'not-ready') h.video.readyState = 1;
    h.video.currentTime += 1; h.input.refresh(); h.fire(); assert.equal(c.draws.length, 1); assert.equal(h.callbacks.size, 1);
    h.video.paused = false; h.document.hidden = false; h.video.readyState = 2;
    h.input.refresh(); h.fire(); assert.equal(c.draws.length, 2); assert.equal(h.failures.length, 0);
    h.input.dispose(); h.assertCameraUntouched();
  });
}
await test('same-ratio metadata change remains a full-frame scaled input', () => {
  const h = makeInput(), c = h.input.input;
  h.video.videoWidth = 3840; h.video.videoHeight = 2160; h.fire(h.video.currentTime + 1);
  assert.equal(h.failures.length, 0); assert.deepEqual(c.draws.at(-1), [h.video, 0, 0, 800, 450]);
  assert.equal(h.input.width, 800); h.input.dispose(); assert.equal(h.track.stops, 0);
});
for (const scaled of [true, false]) {
  await test(`runtime aspect change reports once and stops refresh (${scaled ? 'scaled' : 'full'})`, () => {
    const h = makeInput({}, scaled ? {} : { maxEdge: 0 }), attempts = h.drawAttempts;
    h.video.videoWidth = 1080; h.video.videoHeight = 1920; h.video.currentTime += 1;
    if (scaled) h.fire(); else h.input.refresh();
    assert.equal(h.failures.length, 1); assert.match(h.failures[0].message, /比例|aspect/i);
    assert.equal(h.callbacks.size, 0); h.input.refresh(); h.input.refresh(); assert.equal(h.failures.length, 1);
    assert.equal(h.drawAttempts, attempts); h.input.dispose(); assert.equal(h.track.stops, 0);
  });
}
await test('runtime draw exception reports once, stops rVFC, and cannot silently continue a stale canvas', () => {
  const h = makeInput(), c = h.input.input;
  h.throwOnDraw = true; h.fire(h.video.currentTime + 1);
  assert.equal(h.failures.length, 1); assert.match(h.failures[0].message, /controlled draw failure/);
  assert.equal(h.callbacks.size, 0); h.throwOnDraw = false; h.video.currentTime += 1; h.input.refresh();
  assert.equal(c.draws.length, 1); assert.equal(h.failures.length, 1); h.input.dispose(); h.assertCameraUntouched();
});
await test('dispose is idempotent, cancels rVFC, and ignores queued late callbacks and refresh', () => {
  const h = makeInput(), c = h.input.input, old = [...h.callbacks.values()][0];
  h.input.dispose(); h.input.dispose(); assert.equal(h.cancelled.length, 1); assert.equal(h.callbacks.size, 0);
  h.video.currentTime += 1; old(1000, { mediaTime: h.video.currentTime }); h.input.refresh();
  assert.equal(c.draws.length, 1); assert.equal(h.callbacks.size, 0); assert.equal(h.failures.length, 0); h.assertCameraUntouched();
});
await test('separate input instances own separate canvases and callback lifetimes', () => {
  const a = makeInput(), b = makeInput({ width: 1080, height: 1920 });
  assert.notEqual(a.input.input, b.input.input); a.input.dispose(); assert.equal(a.callbacks.size, 0); assert.equal(b.callbacks.size, 1);
  b.fire(b.video.currentTime + 1); assert.equal(b.input.input.draws.length, 2); b.input.dispose();
  a.assertCameraUntouched(); b.assertCameraUntouched();
});
function makePose() { const visual = new Group(), follower = createPoseFollower(visual); return { visual, follower }; }
function assertRigid(visual, expectedScale) {
  near(visual.quaternion.length(), 1, 1e-12); near(visual.scale.x, expectedScale, 1e-9);
  near(visual.scale.y, expectedScale, 1e-9); near(visual.scale.z, expectedScale, 1e-9);
  visual.updateMatrix();
  const e = visual.matrix.elements, cols = [0, 1, 2].map(i => new V(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]).normalize());
  near(cols[0].dot(cols[1]), 0, 1e-12); near(cols[0].dot(cols[2]), 0, 1e-12); near(cols[1].dot(cols[2]), 0, 1e-12);
  assert.ok(new M3().setFromMatrix4(visual.matrix).determinant() > 0);
}
for (const scale of [.001, 1, 2.75, 1024]) {
  await test(`pose first sample snaps position, rotation, and preserves positive scale ${scale}`, () => {
    const { visual, follower } = makePose(), p = new V(10, -12, -3000), q = new Q().setFromEuler(new Euler(.3, -.2, .1));
    assert.equal(visual.visible, false); assert.equal(follower.update(1 / 60, 0), false);
    assert.equal(follower.sample(matrix(p, q, scale), 100), true); assert.equal(visual.visible, true);
    assert.ok(visual.position.distanceTo(p) < 1e-10); quaternionNear(visual.quaternion, q); assertRigid(visual, scale);
    matrixNear(visual.matrix, matrix(p, q, scale));
  });
}
await test('pose Gram-Schmidt removes input shear instead of preserving an affine deformation', () => {
  const { visual, follower } = makePose(), q = new Q().setFromEuler(new Euler(.2, -.4, .1)), s = 1024;
  const clean = matrix(new V(3, 4, -3000), q, s), sheared = clean.clone(), e = sheared.elements;
  for (let i = 0; i < 3; i++) e[4 + i] += .08 * e[i];
  assert.equal(follower.sample(sheared, 0), true);
  const expectedScale = s * (2 + Math.sqrt(1 + .08 ** 2)) / 3;
  assertRigid(visual, expectedScale); quaternionNear(visual.quaternion, q); assert.ok(visual.position.distanceTo(new V(3, 4, -3000)) < 1e-10);
  observations.acceptedShear = { injectedXY: .08, inputColumnRatio: Math.sqrt(1 + .08 ** 2), outputUniformScale: visual.scale.x };
});
await test('near-uniform input tolerance yields strictly uniform visual scale', () => {
  const { visual, follower } = makePose();
  assert.equal(follower.sample(matrix(new V(), new Q(), new V(1024, 1034, 1014)), 0), true);
  assertRigid(visual, 1024);
});
const invalidMatrices = [
  ...[NaN, Infinity, -Infinity].flatMap(value => Array.from({ length: 16 }, (_, index) => ({ name: `${String(value)} element[${index}]`, mutate: m => { m.elements[index] = value; } }))),
  ...[3, 7, 11].map(index => ({ name: `non-affine element[${index}]`, mutate: m => { m.elements[index] = .1; } })),
  { name: 'non-unit homogeneous w', mutate: m => { m.elements[15] = .8; } },
  { name: 'zero scale axis', mutate: m => { for (let i = 0; i < 3; i++) m.elements[i] = 0; } },
  { name: 'tiny singular scale', mutate: m => m.makeScale(1e-9, 1e-9, 1e-9) },
  { name: 'non-uniform scale', mutate: m => m.makeScale(1024, 1024, 2048) },
  { name: 'left-handed reflection', mutate: m => m.makeScale(-1024, 1024, 1024) },
  { name: 'negative uniform scale', mutate: m => m.makeScale(-1024, -1024, -1024) },
  { name: 'parallel x and y', mutate: m => { for (let i = 0; i < 3; i++) m.elements[4 + i] = m.elements[i]; } },
  { name: 'z in xy plane', mutate: m => { for (let i = 0; i < 3; i++) m.elements[8 + i] = m.elements[i]; } },
  { name: 'finite values with overflowing column norm', mutate: m => m.makeScale(1e200, 1e200, 1e200) }
];
for (const spec of invalidMatrices) {
  await test('pose rejects invalid matrix and resets: ' + spec.name, () => {
    const { visual, follower } = makePose(), m = matrix();
    assert.equal(follower.sample(m, 0), true); spec.mutate(m);
    assert.equal(follower.sample(m, 33), false); assert.equal(visual.visible, false); assert.equal(follower.update(1 / 60, 34), false);
    const p = new V(70, -50, -2000), q = new Q().setFromEuler(new Euler(-.3, .5, -.2));
    assert.equal(follower.sample(matrix(p, q, 700), 1000), true);
    assert.ok(visual.position.distanceTo(p) < 1e-9); quaternionNear(visual.quaternion, q); assertRigid(visual, 700);
  });
}
for (const now of [NaN, Infinity, -Infinity]) {
  await test('pose rejects nonfinite sample time ' + String(now), () => {
    const { visual, follower } = makePose(); follower.sample(matrix(), 0);
    assert.equal(follower.sample(matrix(), now), false); assert.equal(visual.visible, false);
  });
}
await test('pose sample sets a goal without a visible jump; render lerp/slerp stays continuous and normalized', () => {
  const { visual, follower } = makePose(), a = new V(0, 0, -3000), b = new V(120, -30, -2980);
  const qa = new Q(), qb = new Q().setFromEuler(new Euler(.3, -.4, .2));
  follower.sample(matrix(a, qa), 0); follower.sample(matrix(b, qb), 33);
  assert.ok(visual.position.distanceTo(a) < 1e-10); quaternionNear(visual.quaternion, qa);
  let priorP = visual.position.clone(), priorQ = visual.quaternion.clone();
  for (let i = 1; i <= 12; i++) {
    assert.equal(follower.update(1 / 60, 33 + i * 1000 / 60), true);
    assert.ok(visual.position.distanceTo(b) <= priorP.distanceTo(b) + 1e-9);
    assert.ok(visual.quaternion.angleTo(qb) <= priorQ.angleTo(qb) + 1e-7);
    const fraction = visual.position.clone().sub(a).dot(b.clone().sub(a)) / a.distanceToSquared(b);
    assert.ok(fraction > 0 && fraction < 1); assertRigid(visual, 1024);
    priorP.copy(visual.position); priorQ.copy(visual.quaternion);
  }
});
await test('pose uses render dt: 30 and 60 render partitions converge to the same held goal', () => {
  const a = makePose(), b = makePose(), goal = matrix(new V(30, 20, -2990), new Q().setFromEuler(new Euler(.15, -.2, .12)));
  for (const h of [a, b]) { h.follower.sample(matrix(), 0); h.follower.sample(goal, 10); }
  for (let i = 1; i <= 9; i++) a.follower.update(1 / 30, 10 + i * 1000 / 30);
  for (let i = 1; i <= 18; i++) b.follower.update(1 / 60, 10 + i * 1000 / 60);
  assert.ok(a.visual.position.distanceTo(b.visual.position) < 1e-9); quaternionNear(a.visual.quaternion, b.visual.quaternion);
  a.visual.updateMatrix(); b.visual.updateMatrix(); matrixNear(a.visual.matrix, b.visual.matrix);
});
await test('pose zero/negative dt does not advance; a long frame clamps to 100ms', () => {
  const a = makePose(), b = makePose(), goal = matrix(new V(200, 0, 0), new Q().setFromAxisAngle(new V(0, 1, 0), .3));
  for (const h of [a, b]) { h.follower.sample(matrix(), 0); h.follower.sample(goal, 10); }
  a.follower.update(0, 10); a.follower.update(-1, 10); near(a.visual.position.length(), 0);
  a.follower.update(1, 100); b.follower.update(.1, 100);
  assert.ok(a.visual.position.distanceTo(b.visual.position) < 1e-9); quaternionNear(a.visual.quaternion, b.visual.quaternion);
});
await test('pose rotation crosses ±180 degrees by the short continuous arc', () => {
  const { visual, follower } = makePose(), axis = new V(0, 0, 1);
  const a = new Q().setFromAxisAngle(axis, 179 * Math.PI / 180), b = new Q().setFromAxisAngle(axis, -179 * Math.PI / 180);
  follower.sample(matrix(new V(), a), 0); follower.sample(matrix(new V(), b), 33); follower.update(1 / 60, 34);
  assert.ok(visual.quaternion.angleTo(a) > 1e-5); assert.ok(visual.quaternion.angleTo(a) < 2 * Math.PI / 180);
  assert.ok(visual.quaternion.angleTo(b) < a.angleTo(b)); assertRigid(visual, 1024);
});
await test('pose changing scale remains positive uniform and is not multiplied twice', () => {
  const { visual, follower } = makePose();
  follower.sample(matrix(new V(1, 2, 3), new Q(), 1024), 0);
  follower.sample(matrix(new V(1, 2, 3), new Q(), 2048), 33); follower.update(1 / 60, 34);
  assertRigid(visual, 2048); near(new V(1, 0, 0).applyMatrix4(visual.matrix).distanceTo(visual.position), 2048);
});
await test('pose explicit reset hides until reacquisition, which snaps rather than interpolating stale state', () => {
  const { visual, follower } = makePose(); follower.sample(matrix(new V(1, 2, 3)), 0);
  follower.sample(matrix(new V(80, 90, 100)), 33); follower.update(1 / 60, 34); follower.reset(); follower.reset();
  assert.equal(visual.visible, false); assert.equal(follower.update(1 / 60, 35), false);
  const target = matrix(new V(-300, 200, -2800), new Q().setFromEuler(new Euler(.5, .6, -.7)), 777);
  assert.equal(follower.sample(target, 5000), true); visual.updateMatrix(); matrixNear(visual.matrix, target); assertRigid(visual, 777);
});
await test('pose stale threshold is 400ms; render updates do not pretend to be fresh samples', () => {
  const { visual, follower } = makePose(); follower.sample(matrix(), 0);
  for (let i = 1; i <= 24; i++) assert.equal(follower.update(1 / 60, i * 1000 / 60), true);
  assert.equal(visual.visible, true); assert.equal(follower.update(1 / 60, 400.001), false);
  assert.equal(visual.visible, false); assert.equal(follower.update(1 / 60, 500), false);
  const fresh = matrix(new V(500, 20, -2000), new Q().setFromEuler(new Euler(.1, .2, .3)), 900);
  assert.equal(follower.sample(fresh, 1000), true); visual.updateMatrix(); matrixNear(visual.matrix, fresh);
});
await test('pose sample after a >400ms gap snaps even if no render update observed the timeout', () => {
  const { visual, follower } = makePose();
  follower.sample(matrix(new V(0, 0, -3000)), 100);
  follower.sample(matrix(new V(120, 30, -2900)), 133); follower.update(1 / 60, 149);
  const fresh = matrix(new V(-600, 220, -2200), new Q().setFromEuler(new Euler(.7, -.4, .3)), 780);
  assert.equal(follower.sample(fresh, 534), true, '401ms since last sample; no intervening timeout update');
  visual.updateMatrix(); matrixNear(visual.matrix, fresh); assert.equal(visual.visible, true);
  assert.equal(follower.update(1 / 60, 550), true); visual.updateMatrix(); matrixNear(visual.matrix, fresh); assertRigid(visual, 780);
});
await test('pose sample exactly 400ms after the last sample remains continuous rather than falsely reacquiring', () => {
  const { visual, follower } = makePose(), a = new V(0, 0, -3000), b = new V(200, 40, -2800);
  const qb = new Q().setFromEuler(new Euler(.4, -.2, .1));
  follower.sample(matrix(a), 0); assert.equal(follower.sample(matrix(b, qb), 400), true);
  assert.ok(visual.position.distanceTo(a) < 1e-10); quaternionNear(visual.quaternion, new Q());
  assert.equal(follower.update(1 / 60, 400), true);
  assert.ok(visual.position.distanceTo(a) > 0); assert.ok(visual.position.distanceTo(b) > 0); assertRigid(visual, 1024);
});
await test('pose backwards sample timestamp resets and snaps instead of following a stale goal', () => {
  const { visual, follower } = makePose();
  follower.sample(matrix(new V(5, 10, -3000)), 1000);
  follower.sample(matrix(new V(200, 10, -2800)), 1033); follower.update(1 / 60, 1049);
  const fresh = matrix(new V(-350, -200, -2300), new Q().setFromEuler(new Euler(-.3, .8, -.2)), 690);
  assert.equal(follower.sample(fresh, 10), true); visual.updateMatrix(); matrixNear(visual.matrix, fresh); assertRigid(visual, 690);
  assert.equal(follower.update(1 / 60, 26), true); visual.updateMatrix(); matrixNear(visual.matrix, fresh);
});
function fakeTimers() {
  let next = 1;
  const jobs = new Map();
  return { jobs, setTimeout(fn, ms) { const id = next++; jobs.set(id, { fn, ms }); return id; },
    setInterval(fn, ms) { const id = next++; jobs.set(id, { fn, ms, interval: true }); return id; },
    clearTimeout(id) { jobs.delete(id); }, clearInterval(id) { jobs.delete(id); } };
}
async function makeAR({ search = '', ...config } = {}) {
  const h = mediaEnvironment(config), timers = fakeTimers(), container = new Element(), status = new Element(), hint = new Element();
  const music = { enters: [], stops: 0, enter(value) { this.enters.push(value); }, stop() { this.stops++; } };
  const art = { group: new Group(), drives: [], animations: [], startDriveIn(t) { this.drives.push(t); }, animate(t) { this.animations.push(t); } };
  const preview = { video: h.video, ready: Promise.resolve(h.video), resumes: 0, disposals: 0,
    resume() { this.resumes++; if (h.video.paused) { h.video.paused = false; h.video.playCalls++; } },
    dispose() { this.disposals++; h.video.pause(); h.video.srcObject = null; h.video.remove(); } };
  const monitor = { cameras: [], inputs: [], tracking: [], tracks: [], frames: [], resets: 0, disposals: 0,
    setCamera(x) { this.cameras.push(x); }, setInput(x) { this.inputs.push(x); }, setTracking(x) { this.tracking.push(x); },
    track(x) { this.tracks.push(x); }, frame(...args) { this.frames.push(args); }, reset() { this.resets++; }, dispose() { this.disposals++; } };
  Object.assign(h, { timers, container, status, hint, music, art, preview, monitor, cameraRequests: 0, fetches: [], artDisposals: 0 });
  h.document.getElementById = id => ({ container, status, hint })[id] || null;
  class FakeMindARThree {
    constructor(options) {
      h.engine = this; this.options = options; this.scene = new Scene(); this.camera = new PerspectiveCamera();
      this.controller = { stops: 0, stopProcessVideo() { this.stops++; } };
      this.renderer = { domElement: new Element('canvas'), loop: null, frames: [], clears: 0, disposals: 0,
        setClearColor() {}, setPixelRatio(x) { this.pixelRatio = x; }, setAnimationLoop(fn) { this.loop = fn; },
        clear() { this.clears++; }, dispose() { this.disposals++; },
        render(scene, camera) { scene.updateMatrixWorld(true); this.frames.push({ scene, camera, now: h.now }); } };
      this.cssRenderer = { domElement: new Element() };
    }
    addAnchor(index) {
      assert.equal(index, 0); const group = new Group(); group.matrixAutoUpdate = false; group.visible = false;
      this.scene.add(group); h.anchor = { group, visible: false }; return h.anchor;
    }
    async _startVideo() { assert.fail('real startAR must replace native second-camera acquisition'); }
    async _startAR() {
      this.startInput = this.video; this.startDimensions = [this.video.videoWidth, this.video.videoHeight];
      this.dummyInput = this.video; this.processInput = this.video;
    }
    async start() { await this._startVideo(); await this._startAR(); }
  }
  class Clock {
    constructor() { this.previous = h.now; }
    getDelta() { const dt = (h.now - this.previous) / 1000; this.previous = h.now; return dt; }
  }
  const bindings = { THREE: { ...THREE, Clock }, document: h.document, music, splash: new Element(), statusEl: status, hintEl: hint,
    ...timers, backToSplash() { h.backCalls = (h.backCalls || 0) + 1; }, ensureMindAR: async () => {},
    requestCameraStream: async () => { h.cameraRequests++; return h.stream; },
    createCameraPreview: (stream, element, onFailure) => { assert.equal(stream, h.stream); element.appendChild(h.video); h.previewFailure = onFailure; return preview; },
    loadArtAssets: async () => {}, fetch: async url => {
      h.fetches.push(url); assert.equal(url, './assets/target.mind', 'fetch is fake and limited to local target data');
      let done = false;
      return { ok: true, headers: { get: () => '3' }, body: { getReader: () => ({ read: async () => {
        if (done) return { done: true }; done = true; return { done: false, value: new Uint8Array([1, 2, 3]) };
      } }) } };
    }, URL: { createObjectURL: () => 'blob:fake-target', revokeObjectURL: value => { h.revoked = value; } }, Blob, URLSearchParams,
    MindARThree: FakeMindARThree, devicePixelRatio: 3, MOBILE_VIEW: true, getRenderPixelRatio: () => 1.5,
    createFrameMonitor: () => monitor,
    createTrackingInput: (...args) => { h.input = h.createInput(...args); return h.input; },
    createPoseFollower: group => { h.visual = group; h.pose = createPoseFollower(group); return h.pose; },
    createArtScene: (meta, textures, options) => { h.artOptions = options; return art; }, ART_META: {}, ART_TEX: {},
    disposeArtScene: group => { assert.equal(group, art.group); h.artDisposals++; },
    location: { search }, performance: { now: () => h.now } };
  h.runtime = new Function(...Object.keys(bindings), `let arBusy = false, vrBusy = false, entryMode = null;\n${entrySource}\nreturn { startAR, state: () => ({ arBusy, entryMode }) };`)(...Object.values(bindings));
  await h.runtime.startAR();
  assert.ok(h.engine, 'actual entry reaches MindAR construction');
  h.sample = (m, now = h.now) => {
    h.now = now; h.anchor.visible = true; h.anchor.group.visible = true; h.anchor.group.matrix.copy(m);
    h.anchor.onTargetUpdate();
  };
  h.frame = (now = h.now + 1000 / 60, advanceMedia = true) => {
    h.now = now; if (advanceMedia) h.video.currentTime += 1 / 30;
    assert.equal(typeof h.engine.renderer.loop, 'function', 'visible AR has the existing render loop'); h.engine.renderer.loop();
  };
  h.visibility = hidden => { h.document.hidden = hidden; h.document.dispatch('visibilitychange'); };
  h.close = () => { if (h.preview.disposals === 0) h.previewFailure(new Error('controlled fake session cleanup')); };
  return h;
}
function assertFailedClosed(h) {
  assert.equal(h.engine.renderer.loop, null); assert.equal(h.engine.controller.stops, 1);
  assert.equal(h.engine.renderer.disposals, 1); assert.equal(h.preview.disposals, 1); assert.equal(h.track.stops, 1);
  assert.equal(h.artDisposals, 1); assert.equal(h.monitor.disposals, 1); assert.equal(h.callbacks.size, 0);
  assert.equal(h.visual.visible, false); assert.equal(h.document.listeners.get('visibilitychange')?.size || 0, 0);
  assert.equal(h.video.srcObject, null); assert.equal(h.runtime.state().arBusy, false);
}
await test('actual startAR routes scaled input while preserving the one original preview stream', async () => {
  const h = await makeAR();
  assert.equal(h.cameraRequests, 1); assert.deepEqual(h.fetches, ['./assets/target.mind']);
  assert.equal(h.engine.options.filterMinCF, 1); assert.equal(h.engine.options.filterBeta, 0);
  assert.equal(h.engine.video, h.input.input); assert.notEqual(h.engine.video, h.preview.video);
  assert.deepEqual(h.engine.startDimensions, [800, 450]); assert.equal(h.engine.dummyInput, h.input.input); assert.equal(h.engine.processInput, h.input.input);
  assert.equal(h.monitor.inputs[0], h.input); assert.deepEqual(h.monitor.cameras[0], { width: 1920, height: 1080, frameRate: 30 });
  assert.equal(h.preview.video.srcObject, h.stream); assert.equal(h.cameraRequests, 1); assert.equal(h.track.constraints, 0); assert.equal(h.rafCalls, 0);
  assert.equal(h.video.videoWidth, 1920); assert.equal(h.video.videoHeight, 1080); assert.equal(h.video.width, 1920); assert.equal(h.video.height, 1080);
  assert.equal(h.input.input.parentNode, null); assert.equal(h.revoked, 'blob:fake-target'); h.close(); assertFailedClosed(h);
});
await test('actual ?tracking=full uses original video and creates no sampling canvas or callback', async () => {
  const h = await makeAR({ search: '?tracking=full' });
  assert.equal(h.input.scaled, false); assert.equal(h.engine.video, h.preview.video); assert.deepEqual(h.engine.startDimensions, [1920, 1080]);
  assert.equal(h.canvases.length, 0); assert.equal(h.callbacks.size, 0); assert.equal(h.cameraRequests, 1); h.close(); assertFailedClosed(h);
});
await test('actual visual root and anchor are scene siblings; world transform is applied exactly once', async () => {
  const h = await makeAR(), q = new Q().setFromEuler(new Euler(.2, -.3, .1));
  assert.equal(h.visual.parent, h.engine.scene); assert.equal(h.anchor.group.parent, h.engine.scene);
  assert.equal(h.art.group.parent, h.visual); assert.equal(h.anchor.group.children.includes(h.art.group), false);
  const target = matrix(new V(17, -22, -3100), q, 1024); h.sample(target, 0); h.frame(1000 / 60);
  h.art.group.updateMatrix(); h.engine.scene.updateMatrixWorld(true);
  const expectedWorld = target.clone().multiply(h.art.group.matrix); matrixNear(h.visual.matrixWorld, target); matrixNear(h.art.group.matrixWorld, expectedWorld);
  const doubled = target.clone().multiply(expectedWorld);
  assert.ok(new V().setFromMatrixPosition(doubled).distanceTo(new V().setFromMatrixPosition(expectedWorld)) > 1000);
  assert.equal(h.engine.renderer.frames.length, 1); assert.equal(h.art.drives.length, 1); h.close(); assertFailedClosed(h);
});
await test('actual renderAR refreshes on old browsers even before target visibility, without adding rAF', async () => {
  const h = await makeAR({ rvfc: false }), c = h.input.input;
  assert.equal(h.callbacks.size, 0); assert.equal(c.draws.length, 1); h.frame(1000 / 60);
  assert.equal(c.draws.length, 2); assert.equal(h.engine.renderer.frames.length, 0);
  h.frame(1000 / 30, false); assert.equal(c.draws.length, 2); assert.equal(h.rafCalls, 0); h.close(); assertFailedClosed(h);
});
await test('actual rVFC + renderAR share currentTime deduplication', async () => {
  const h = await makeAR(), c = h.input.input;
  h.fire(h.video.currentTime + 1 / 30); assert.equal(c.draws.length, 2); h.frame(1000 / 60, false); assert.equal(c.draws.length, 2);
  h.frame(1000 / 30); assert.equal(c.draws.length, 3); h.fire(); assert.equal(c.draws.length, 3); h.close(); assertFailedClosed(h);
});
await test('actual paused/hidden state hides and resets visual pose without stopping the camera', async () => {
  const h = await makeAR(); h.sample(matrix(new V(10, 20, -3000)), 0); h.frame(16);
  assert.equal(h.visual.visible, true); const count = h.input.input.draws.length;
  h.video.paused = true; h.frame(32); assert.equal(h.visual.visible, false); assert.equal(h.art.group.visible, false);
  assert.equal(h.input.input.draws.length, count); assert.equal(h.track.stops, 0);
  h.visibility(true); assert.equal(h.engine.renderer.loop, null); h.fire(h.video.currentTime + 1);
  assert.equal(h.input.input.draws.length, count); assert.equal(h.visual.visible, false);
  h.visibility(false); assert.equal(typeof h.engine.renderer.loop, 'function'); assert.equal(h.video.paused, false);
  const fresh = matrix(new V(100, 200, -2500), new Q().setFromEuler(new Euler(.2, .1, -.3)), 800);
  h.sample(fresh, 1000); h.frame(1016); matrixNear(h.visual.matrix, fresh); assert.equal(h.track.stops, 0); h.close(); assertFailedClosed(h);
});
await test('actual target-lost and invalid matrix hide/reset; reacquisition snaps a fresh transform', async () => {
  const h = await makeAR(); h.sample(matrix(new V(10, 0, -3000)), 0); h.frame(16);
  h.anchor.onTargetLost(); assert.equal(h.visual.visible, false); assert.equal(h.art.group.visible, false);
  const invalid = matrix(); invalid.elements[0] = NaN; h.sample(invalid, 40);
  assert.equal(h.visual.visible, false); assert.equal(h.art.group.visible, false);
  const fresh = matrix(new V(-200, 15, -2400), new Q().setFromEuler(new Euler(-.3, .2, .6)), 650);
  h.sample(fresh, 100); h.frame(116); matrixNear(h.visual.matrix, fresh); assertRigid(h.visual, 650); h.close(); assertFailedClosed(h);
});
await test('actual render timeout hides after 400ms without samples, then allows snap reacquisition', async () => {
  const h = await makeAR(); h.sample(matrix(new V(50, 60, -3000)), 0); h.frame(400);
  assert.equal(h.visual.visible, true); h.frame(401); assert.equal(h.visual.visible, false); assert.equal(h.art.group.visible, false);
  const fresh = matrix(new V(-500, 10, -2000), new Q().setFromEuler(new Euler(.4, -.2, .1)), 750);
  h.sample(fresh, 1000); h.frame(1016); matrixNear(h.visual.matrix, fresh); h.close(); assertFailedClosed(h);
});
await test('actual vendor missTolerance stale matrices with isTracking=false neither extend freshness nor revive a hidden pose', async () => {
  const h = await makeAR(), old = matrix(new V(50, 60, -3000));
  h.engine.controller.trackingStates = [{ isTracking: true }];
  h.sample(old, 0); h.frame(16); assert.equal(h.visual.visible, true);
  const validSamples = h.monitor.tracks.length;
  // Native controller marks isTracking=false BEFORE emitting its retained matrix;
  // anchor visibility can remain true throughout missTolerance, so it is not a freshness signal.
  h.engine.controller.trackingStates[0].isTracking = false;
  for (const now of [100, 250, 399]) {
    h.sample(old, now);
    assert.equal(h.anchor.group.visible, true); assert.equal(h.monitor.tracks.length, validSamples,
      'retained native matrix must not count as a fresh tracking sample');
  }
  h.frame(400); assert.equal(h.visual.visible, true, '400ms boundary still uses the last genuinely tracking sample');
  h.frame(401); assert.equal(h.visual.visible, false); assert.equal(h.art.group.visible, false);
  const rendered = h.engine.renderer.frames.length;
  for (const now of [420, 500, 800]) {
    h.sample(old, now); assert.equal(h.visual.visible, false); assert.equal(h.art.group.visible, false);
    assert.equal(h.monitor.tracks.length, validSamples); h.frame(now + 1);
    assert.equal(h.engine.renderer.frames.length, rendered, 'stale missTolerance updates must not restart rendering');
  }
  const fresh = matrix(new V(-500, 10, -2200), new Q().setFromEuler(new Euler(.2, -.3, .1)), 740);
  h.engine.controller.trackingStates[0].isTracking = true; h.sample(fresh, 1000); h.frame(1016);
  matrixNear(h.visual.matrix, fresh); assert.equal(h.visual.visible, true); assert.equal(h.monitor.tracks.length, validSamples + 1);
  h.close(); assertFailedClosed(h);
});
await test('actual tracking-state guard keeps undefined compatibility rather than requiring isTracking=true', async () => {
  const h = await makeAR(); h.engine.controller.trackingStates = [{}];
  const first = matrix(new V(15, 25, -3000)); h.sample(first, 0); h.frame(16);
  assert.equal(h.visual.visible, true); matrixNear(h.visual.matrix, first); assert.equal(h.monitor.tracks.length, 1);
  h.anchor.onTargetLost(); delete h.engine.controller.trackingStates;
  const fresh = matrix(new V(-100, 20, -2600), new Q().setFromEuler(new Euler(.1, .2, -.1)), 850);
  h.sample(fresh, 500); h.frame(516); assert.equal(h.visual.visible, true); matrixNear(h.visual.matrix, fresh);
  assert.equal(h.monitor.tracks.length, 2); h.close(); assertFailedClosed(h);
});
await test('actual sample arriving before the first post-gap render snaps rather than chasing an expired pose', async () => {
  const h = await makeAR(); h.sample(matrix(new V(0, 0, -3000)), 0); h.frame(16);
  h.sample(matrix(new V(150, 20, -2900)), 33); h.frame(49);
  const fresh = matrix(new V(-400, 250, -2100), new Q().setFromEuler(new Euler(.5, -.6, .2)), 710);
  h.sample(fresh, 500); h.visual.updateMatrix(); matrixNear(h.visual.matrix, fresh);
  h.frame(516); matrixNear(h.visual.matrix, fresh); assert.equal(h.art.group.visible, true);
  h.close(); assertFailedClosed(h);
});
for (const failure of ['aspect', 'draw']) {
  await test(`actual runtime ${failure} error fails closed, cleans callback/renderer/stream once, and ignores stale work`, async () => {
    const h = await makeAR(), oldFrame = [...h.callbacks.values()][0], oldLoop = h.engine.renderer.loop;
    if (failure === 'aspect') { h.video.videoWidth = 1080; h.video.videoHeight = 1920; }
    else h.throwOnDraw = true;
    h.frame(16); assertFailedClosed(h); assert.match(h.status.textContent, failure === 'aspect' ? /比例/ : /controlled draw failure/);
    h.now = 1000; h.video.currentTime += 1; oldFrame(1000, { mediaTime: h.video.currentTime }); oldLoop();
    h.anchor.onTargetFound(); h.anchor.onTargetUpdate(); h.anchor.onTargetLost(); h.close(); assertFailedClosed(h);
    assert.equal(h.engine.renderer.frames.length, 0); assert.equal(h.cameraRequests, 1);
  });
}
for (const config of [{ context: 'null' }, { drawError: true }]) {
  await test('actual initial sampling fallback preserves the original stream and starts AR: ' + JSON.stringify(config), async () => {
    const h = await makeAR(config);
    assert.equal(h.input.scaled, false); assert.equal(h.engine.video, h.video); assert.deepEqual(h.engine.startDimensions, [1920, 1080]);
    assert.equal(h.preview.disposals, 0); assert.equal(h.track.stops, 0); assert.equal(h.callbacks.size, 0); h.close(); assertFailedClosed(h);
  });
}
const failed = results.filter(r => !r.passed).length;
console.log(JSON.stringify({ passed: failed === 0, total: results.length, passedTests: results.length - failed, failedTests: failed,
  source: { index: path.join(root, 'index.html'), threeRevision: THREE.REVISION,
    inputHash: hash(inputSource), poseHash: hash(poseSource), startARHash: hash(entrySource), htmlHash: hash(html) },
  tests: results, observations,
  boundaries: [
    'All helper and startAR bodies are extracted from index.html and executed verbatim, not copied or rewritten algorithms.',
    'Actual checked-in THREE math and scene graph; fake DOM, decoded media state, rVFC delivery, stream, clock, timers, renderer and MindAR startup adapter.',
    'MindAR recognition/GPU is NOT executed by this file. Its real native OneEuro/conversion are separately exercised in test_tracking_filter.mjs.',
    'Vendor workers and native anonymous resize listeners are retained; stop/late-stop and the failed-session resize guard do not claim worker termination or listener removal. Full worker lifecycle is not tested here.',
    'Initial sampling occurs after a valid preview frame; paused/hidden suppression is asserted for subsequent refresh, not constructor initialization.',
    'Canvas checks assert dimensions and drawImage arguments, not browser rasterized pixels, camera framing, recognition speed, or screen-pixel precision.',
    'No actual camera, audio, MP3 inspection, WeChat access, network transmission, phone FPS, iOS/Android acceptance, or measured device-improvement claim.'
  ] }, null, 2));
if (failed) process.exitCode = 1;
