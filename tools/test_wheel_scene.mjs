// Node-only geometry/animation checks; no browser or graphics context required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(root, 'lib', 'three.module.js'), 'utf8');
const THREE = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'sprites', 'meta.json'), 'utf8'));
const textures = Object.fromEntries(Object.keys(meta.rects).map(name => {
  const texture = new THREE.Texture();
  texture.name = name;
  return [name, texture];
}));

function functionSource(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' exists');
  let end = html.indexOf('\n}\n', start);
  assert.notEqual(end, -1, name + ' closes');
  return html.slice(start, end + 2);
}

const build = new Function('THREE', 'meta', 'tex', `
  const UNIT = 1 / 1745;
  const pxX = px => px / 1745 - 0.5;
  const pxY = py => (0.5 - py / 1280) * (1280 / 1745);
  const sparkleTexture = () => new THREE.Texture();
  ${functionSource('spriteMesh')}
  ${functionSource('createArtScene')}
  return createArtScene(meta, tex, { withSky: false, driveFromX: -1.35, driveDur: 6.5 });
`);
const scene = build(THREE, meta, textures);
const faces = [], casings = [];
scene.group.traverse(object => {
  if (!object.isMesh || !/^wheel[01]$/.test(object.material.map?.name || '')) return;
  (object.geometry.type === 'CircleGeometry' ? faces : casings).push(object);
});
assert.equal(faces.length, 2);
assert.equal(casings.length, 2);
const centres = faces.map(face => face.parent.position.clone());
for (let i = 0; i < 2; i++) {
  const [wx, wy] = meta.wheels[i];
  assert.ok(Math.abs(centres[i].x - (wx / 1745 - 0.5)) < 1e-12);
  assert.ok(Math.abs(centres[i].y - ((0.5 - wy / 1280) * (1280 / 1745))) < 1e-12);
  const uv = faces[i].geometry.attributes.uv;
  assert.equal(uv.getX(0), 0.5);
  assert.equal(uv.getY(0), 0.5);
  for (let j = 0; j < uv.count; j++) {
    assert.ok(uv.getX(j) >= 0 && uv.getX(j) <= 1);
    assert.ok(uv.getY(j) >= 0 && uv.getY(j) <= 1);
  }
}
scene.startDriveIn(1);
const samples = [];
for (const t of [1, 2, 4.25, 6, 7.5, 12, 30]) {
  scene.animate(t);
  for (let i = 0; i < 2; i++) {
    assert.equal(casings[i].rotation.z, 0, 'tire casing must not orbit');
    assert.ok(faces[i].parent.position.distanceTo(centres[i]) < 1e-12, 'axle must remain fixed');
    assert.ok(faces[i].position.x === 0 && faces[i].position.y === 0, 'face rotates at axle');
  }
  assert.equal(faces[0].rotation.z, faces[1].rotation.z);
  samples.push({ time: t, angle: faces[0].rotation.z });
}
assert.ok(samples[1].angle < samples[0].angle);
assert.ok(samples[3].angle < samples[2].angle);
assert.equal(samples[4].angle, samples[5].angle, 'wheels stop when bus stops');
assert.equal(samples[5].angle, samples[6].angle, 'wheels stay stopped');
const distance = -samples[4].angle * meta.wheelFaces[0].rollingRadius / 1745;
assert.ok(Math.abs(distance - 1.35) < 1e-12, 'rolling angle matches travel distance');
assert.match(html, /artUrl\('meta\.json'\)/);
assert.match(html, /artUrl\(n \+ '\.webp'\)/);
assert.equal(String(meta.version), /ART_VERSION = '(\d+)'/.exec(html)[1]);
console.log(JSON.stringify({ passed: true, fixedCasings: casings.length,
  rotatingFaces: faces.length, axleCentres: centres.map(v => [v.x, v.y]),
  samples, travelDistance: distance, version: meta.version }, null, 2));
