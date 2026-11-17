// Node-only motion, geometry and animation checks; no graphics context required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBusLoop } from '../lib/bus-motion.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'sprites', 'meta.json'), 'utf8'));
const near = (actual, expected, message, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
function testPureLoop() {
  const fixture = {
    rects: { bus: [260, 100, 1300, 700] },
    wheels: [[125, 650, 155], [1440, 640, 195]],
    wheelFaces: [{ rollingRadius: 40 }, { rollingRadius: 40 }]
  };
  const inputBefore = JSON.stringify(fixture);
  const real = createBusLoop(meta);
  near(real.left, Math.min(meta.rects.bus[0], ...meta.wheels.map(w => w[0] - w[2])) / 1745 - 0.5, 'real left bound');
  near(real.right, Math.max(meta.rects.bus[2], ...meta.wheels.map(w => w[0] + w[2])) / 1745 - 0.5, 'real right bound');
  const loop = createBusLoop(fixture);
  near(loop.left, -30 / 1745 - 0.5, 'left includes wheel protruding past body');
  near(loop.right, 1635 / 1745 - 0.5, 'right includes wheel protruding past body');
  assert.notEqual(Math.abs(loop.left), Math.abs(loop.right), 'bounds are asymmetric');
  near(loop.start, -0.56 - loop.right - 0.02, 'start is wholly left of artwork');
  near(loop.end, 0.56 - loop.left + 0.02, 'end is wholly right of artwork');
  near(loop.span, loop.end - loop.start, 'span');
  near(loop.radius, 40 / 1745, 'rolling radius');
  assert.equal(loop.duration, 8);
  for (const t of [-2, 0]) assert.deepEqual(loop.sample(t), { x: loop.start, angle: 0 });
  let previous = null;
  for (const t of [0.25, 1, 3.5, 7.99, 8.01, 9.75, 15.99, 16.01, 21]) {
    const sample = loop.sample(t), distance = loop.span * t / loop.duration;
    near(sample.x, loop.start + distance % loop.span, `position at ${t}`);
    near(sample.angle, -distance / loop.radius, `unwrapped roll at ${t}`);
    if (previous) {
      assert.ok(sample.angle < previous.sample.angle, 'wheel rotates continuously');
      if (Math.floor(t / loop.duration) === Math.floor(previous.t / loop.duration)) {
        assert.ok(sample.x > previous.sample.x, 'bus moves right at constant speed');
        near(sample.x - previous.sample.x, loop.span * (t - previous.t) / loop.duration,
          'constant horizontal speed');
      } else assert.ok(sample.x < previous.sample.x, 'bus wraps left only at loop boundary');
    }
    previous = { t, sample };
  }
  for (const cycle of [1, 2]) {
    const boundary = loop.sample(cycle * loop.duration).x;
    assert.ok(Math.abs(boundary - loop.start) < 1e-10 || Math.abs(boundary - loop.end) < 1e-10,
      'roundoff at a period may fall on either equivalent boundary');
    const before = loop.sample((cycle - 1e-6) * loop.duration);
    const after = loop.sample((cycle + 1e-6) * loop.duration);
    assert.ok(before.x + loop.left > 0.56, 'whole geometry has exited right before wrap');
    assert.ok(after.x + loop.right < -0.56, 'whole geometry is left after wrap');
    assert.ok(after.angle < before.angle, 'wheel angle does not reset at wrap');
  }
  const saved = loop.sample(3.25);
  loop.sample(200);
  assert.deepEqual(loop.sample(3.25), saved, 'sampling is stateless and order-independent');
  assert.equal(JSON.stringify(fixture), inputBefore, 'metadata is not mutated');
  const custom = createBusLoop(fixture, { duration: 6.5, halfWidth: 0.7, margin: 0 });
  near(custom.start + custom.right, -0.7, 'zero-margin start');
  near(custom.end + custom.left, 0.7, 'zero-margin end');
  assert.equal(custom.duration, 6.5);
  for (const bad of [0, -1, NaN, Infinity, -Infinity, '8', null])
    assert.throws(() => createBusLoop(fixture, { duration: bad }), RangeError);
  for (const bad of [0, -1, NaN, Infinity, '0.56', null])
    assert.throws(() => createBusLoop(fixture, { halfWidth: bad }), RangeError);
  for (const bad of [-1, NaN, Infinity, '0.02', null])
    assert.throws(() => createBusLoop(fixture, { margin: bad }), RangeError);
  for (const bad of [NaN, Infinity, -Infinity, '1', null, undefined])
    assert.throws(() => loop.sample(bad), RangeError);
  for (const badMeta of [null, {}, { ...fixture, rects: { bus: [0, 0, NaN, 1] } },
    { ...fixture, rects: { bus: [0, , 1, 1] } }, { ...fixture, wheels: [[0, , 1]] },
    { ...fixture, wheels: [[0, 0, -1]] }, { ...fixture, wheelFaces: [{ rollingRadius: 0 }] }])
    assert.throws(() => createBusLoop(badMeta), RangeError);
  assert.throws(() => createBusLoop(fixture, null), RangeError);
  assert.throws(() => loop.sample(Number.MAX_VALUE), RangeError);
  return loop;
}
const fixtureLoop = testPureLoop();
console.log('Pure bus-loop tests passed');
if (process.argv.includes('--pure')) process.exit(0);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(root, 'lib', 'three.module.js'), 'utf8');
const THREE = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const textures = Object.fromEntries(Object.keys(meta.rects).map(name => {
  const texture = new THREE.Texture();
  texture.name = name;
  return [name, texture];
}));
function functionSource(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' exists');
  const end = html.indexOf('\n}\n', start);
  assert.notEqual(end, -1, name + ' closes');
  return html.slice(start, end + 2);
}
const build = new Function('THREE', 'meta', 'tex', 'createBusLoop', 'opts', `
  const UNIT = 1 / 1745;
  const pxX = px => px / 1745 - 0.5;
  const pxY = py => (0.5 - py / 1280) * (1280 / 1745);
  const sparkleTexture = () => new THREE.Texture();
  const skyPlane = () => new THREE.Group();
  ${functionSource('spriteMesh')}
  ${functionSource('createArtScene')}
  return createArtScene(meta, tex, opts);
`);
function testScene(opts) {
  const scene = build(THREE, meta, textures, createBusLoop, opts);
  const faces = [], casings = [];
  scene.group.traverse(object => {
    if (!object.isMesh || !/^wheel[01]$/.test(object.material.map?.name || '')) return;
    (object.geometry.type === 'CircleGeometry' ? faces : casings).push(object);
  });
  assert.equal(faces.length, 2);
  assert.equal(casings.length, 2);
  const busGroup = faces[0].parent.parent;
  assert.equal(faces[1].parent.parent, busGroup);
  const centres = faces.map(face => face.parent.position.clone());
  assert.equal(meta.wheelFaces[0].rollingRadius, meta.wheelFaces[1].rollingRadius,
    'both faces currently share one rolling radius');
  for (let i = 0; i < 2; i++) {
    const [wx, wy, wr] = meta.wheels[i];
    near(centres[i].x, wx / 1745 - 0.5, 'axle x');
    near(centres[i].y, (0.5 - wy / 1280) * (1280 / 1745), 'axle y');
    const uv = faces[i].geometry.attributes.uv, position = faces[i].geometry.attributes.position;
    near(uv.getX(0), 0.5, 'face centre u');
    near(uv.getY(0), 0.5, 'face centre v');
    for (let j = 0; j < uv.count; j++) {
      assert.ok(uv.getX(j) >= 0 && uv.getX(j) <= 1 && uv.getY(j) >= 0 && uv.getY(j) <= 1);
      near(uv.getX(j), 0.5 + position.getX(j) / (2 * wr / 1745), 'face u', 1e-6);
      near(uv.getY(j), 0.5 + position.getY(j) / (2 * wr / 1745), 'face v', 1e-6);
    }
  }
  const loop = createBusLoop(meta, { duration: opts.driveDur ?? 8 }), d = loop.duration, t0 = 1;
  scene.startDriveIn(t0);
  const times = [-0.25, 0, 0.1 * d, 0.45 * d, (1 - 1e-6) * d, (1 + 1e-6) * d,
    1.3 * d, (2 - 1e-6) * d, (2 + 1e-6) * d, 2.4 * d, 0.3 * d];
  for (const elapsed of times) {
    scene.animate(t0 + elapsed);
    const expected = loop.sample(elapsed);
    near(busGroup.position.x, expected.x, 'scene bus x', 1e-9);
    for (let i = 0; i < 2; i++) {
      near(faces[i].rotation.z, expected.angle, 'face follows continuous roll', 1e-9);
      assert.equal(casings[i].rotation.z, 0, 'casing does not rotate');
      assert.equal(faces[i].parent.rotation.z, 0, 'axle group does not rotate');
      assert.ok(faces[i].parent.position.distanceTo(centres[i]) < 1e-12, 'axle remains fixed');
      assert.equal(faces[i].position.x, 0);
      assert.equal(faces[i].position.y, 0);
    }
    if (elapsed === (1 - 1e-6) * d || elapsed === (2 - 1e-6) * d) {
      const box = new THREE.Box3().setFromObject(busGroup);
      assert.ok(box.min.x > 0.56, 'actual whole bus geometry exits right before wrap');
    }
    if (elapsed === (1 + 1e-6) * d || elapsed === (2 + 1e-6) * d) {
      const box = new THREE.Box3().setFromObject(busGroup);
      assert.ok(box.max.x < -0.56, 'actual whole bus geometry is left after wrap');
    }
  }
  const body = busGroup.children.find(object => object.isMesh && object.material.map?.name === 'bus');
  assert.ok(body, 'bus body mesh exists');
  scene.group.position.set(1, 2, 3); scene.group.rotation.set(0.2, 0.3, 0.4);
  scene.group.scale.set(1.1, 0.8, 1.2);
  for (const mesh of [body, ...casings, ...faces]) {
    assert.equal(mesh.material.clippingPlanes?.length, 2); mesh.onBeforeRender();
    const point = x => new THREE.Vector3(x, 0, 0).applyMatrix4(scene.group.matrixWorld);
    const [left, right] = mesh.material.clippingPlanes;
    near(left.distanceToPoint(point(-0.56)), 0, 'transformed left clip boundary');
    near(right.distanceToPoint(point(0.56)), 0, 'transformed right clip boundary');
    assert.ok(left.distanceToPoint(point(-0.561)) < 0 && right.distanceToPoint(point(0.561)) < 0);
    assert.ok(left.distanceToPoint(point(0)) > 0 && right.distanceToPoint(point(0)) > 0);
  }
  return { backdrop: !!opts.withBackdrop, duration: d, axleCentres: centres.map(v => [v.x, v.y]) };
}
const scenes = [testScene({}), testScene({ withBackdrop: true }), testScene({ driveDur: 6.5 })];
assert.match(html, /import\s*\{\s*createBusLoop\s*\}\s*from\s*['"]\.\/lib\/bus-motion\.mjs['"]/);
assert.match(html, /artUrl\('meta\.json'\)/);
assert.match(html, /artUrl\(n \+ '\.webp'\)/);
assert.equal(String(meta.version), /ART_VERSION = '(\d+)'/.exec(html)[1]);
console.log(JSON.stringify({ passed: true, scenes, fixtureBounds: [fixtureLoop.left, fixtureLoop.right],
  version: meta.version }, null, 2));
