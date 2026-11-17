// Node-only regression checks against the current index.html (no browser/network/GPU).
// Run from any directory: node C:/Users/amst/blackbird-ar/tools/test_mobile_scene.mjs
// Real THREE objects and extracted application functions; only platform services are fake.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBusLoop } from '../lib/bus-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split('\r\n').join('\n');
const threeSource = fs.readFileSync(path.join(root, 'lib', 'three.module.js'), 'utf8');
const THREE = await import('data:text/javascript;base64,' + Buffer.from(threeSource).toString('base64'));
const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'sprites', 'meta.json'), 'utf8'));

// Same top-level-function extraction strategy as test_wheel_scene.mjs, retaining async.
function functionSource(name, source = html) {
  let start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' exists');
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, name + ' closes at top level');
  return source.slice(start, end + 2);
}
function between(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.notEqual(start, -1, startMarker + ' exists');
  const end = html.indexOf(endMarker, start);
  assert.notEqual(end, -1, endMarker + ' exists');
  return html.slice(start, end);
}
function compile(scope, names, tail) {
  return new Function(...Object.keys(scope), '"use strict";\n'
    + names.map(name => functionSource(name)).join('\n') + '\n' + tail)(...Object.values(scope));
}
function near(actual, expected, tolerance = 1e-12, label = 'value') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} should equal ${expected} (tolerance ${tolerance})`);
}
function nearVector(actual, expected, tolerance = 1e-9, label = 'vector') {
  actual.toArray().forEach((value, index) => near(value, expected[index], tolerance, `${label}[${index}]`));
}
function rigidMatrix(x, y, z, rx = 0, ry = 0, rz = 0, scale = 1) {
  const position = new THREE.Vector3(x, y, z);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(scale, scale, scale));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function namedError(name) {
  return Object.assign(new Error(name), { name });
}
function textures() {
  return Object.fromEntries(Object.keys(meta.rects).map(name => {
    const texture = new THREE.Texture();
    texture.name = name;
    return [name, texture];
  }));
}
function seededMath() {
  const math = Object.create(Math);
  let seed = 0x29;
  math.random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  return math;
}

class FakeTarget {
  listeners = new Map();
  added = [];
  removed = [];
  addEventListener(type, callback, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Map());
    const listeners = this.listeners.get(type);
    if (!listeners.has(callback)) {
      listeners.set(callback, { once: Boolean(options && options.once) });
      this.added.push({ type, callback });
    }
  }
  removeEventListener(type, callback) {
    const matched = this.listeners.get(type)?.delete(callback) || false;
    this.removed.push({ type, callback, matched });
  }
  dispatch(type, fields = {}) {
    const listeners = this.listeners.get(type);
    for (const [callback, options] of [...(listeners || [])]) {
      if (!listeners.has(callback)) continue;
      if (options.once) this.removeEventListener(type, callback);
      callback.call(this, { type, target: this, ...fields });
    }
  }
  count(type) { return this.listeners.get(type)?.size || 0; }
}
function canvasContext() {
  // A call recorder, deliberately NOT a canvas rasterizer or a fake pixel oracle.
  const context = { globalAlpha: 1, fillStyle: null, gradients: [], fills: [], path: [], draws: [] };
  for (const kind of ['Linear', 'Radial']) {
    context['create' + kind + 'Gradient'] = (...args) => {
      const gradient = { kind, args, stops: [], addColorStop(offset, color) {
        assert.ok(Number.isFinite(offset) && offset >= 0 && offset <= 1);
        this.stops.push({ offset, color });
      } };
      context.gradients.push(gradient);
      return gradient;
    };
  }
  context.fillRect = (...rect) => context.fills.push({ rect, style: context.fillStyle,
    alpha: context.globalAlpha });
  context.beginPath = () => { context.path = []; };
  for (const method of ['moveTo', 'quadraticCurveTo']) {
    context[method] = (...args) => context.path.push([method, ...args]);
  }
  context.fill = () => context.fills.push({ path: [...context.path], style: context.fillStyle,
    alpha: context.globalAlpha });
  context.drawImage = (...args) => context.draws.push(args);
  return context;
}
class FakeElement extends FakeTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.textContent = '';
    this.hidden = this.disabled = false;
    this.removeCount = this.playCount = this.pauseCount = 0;
    this.autoplay = this.muted = this.defaultMuted = this.playsInline = false;
    this.paused = true;
    this.readyState = this.videoWidth = this.videoHeight = 0;
    this.currentTime = 0;
    this.srcObject = null;
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name) };
    if (tagName === 'canvas') {
      this.context = canvasContext();
      this.getContext = kind => { assert.equal(kind, '2d'); return this.context; };
    }
  }
  get firstChild() { return this.children[0] || null; }
  // Deliberately do not reflect muted attributes into properties: test both writes.
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  click() { if (!this.hidden && !this.disabled) this.dispatch('click'); }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, reference) {
    if (child.parentNode) {
      const old = child.parentNode.children;
      old.splice(old.indexOf(child), 1);
    }
    const index = reference == null ? this.children.length : this.children.indexOf(reference);
    assert.ok(index >= 0, 'insertBefore reference belongs to its parent');
    this.children.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  remove() {
    this.removeCount += 1;
    if (this.parentNode) {
      const children = this.parentNode.children;
      children.splice(children.indexOf(this), 1);
      this.parentNode = null;
    }
  }
  play() {
    assert.ok(['VIDEO', 'AUDIO'].includes(this.tagName));
    this.playCount += 1;
    queueMicrotask(() => {
      this.paused = false;
      this.readyState = 2;
      if (this.tagName === 'VIDEO') { this.videoWidth = 1280; this.videoHeight = 720; }
      for (const type of ['loadedmetadata', 'loadeddata', 'playing']) this.dispatch(type);
    });
    return Promise.resolve();
  }
  pause() { this.pauseCount += 1; this.paused = true; }
}
function makeDOM() {
  const document = new FakeTarget();
  const window = new FakeTarget();
  document.hidden = false;
  document.created = [];
  document.createElement = tag => {
    const element = new FakeElement(tag);
    document.created.push(element);
    return element;
  };
  document.body = document.createElement('body');
  const elements = {};
  for (const id of ['status', 'scanHint', 'splash', 'vrRoot', 'vrHint', 'vrExit',
    'vrBtn', 'arBtn', 'container', 'cameraResume', 'backgroundMusic', 'musicToggle', 'musicNote']) {
    elements[id] = document.createElement(id === 'backgroundMusic' ? 'audio' : id === 'cameraResume' ? 'button' : 'div');
    elements[id].id = id;
    document.body.appendChild(elements[id]);
  }
  elements.vrRoot.appendChild(elements.vrExit);
  elements.vrRoot.appendChild(elements.vrHint);
  elements.status.classList.add('hidden');
  elements.scanHint.classList.add('hidden');
  elements.cameraResume.hidden = true;
  document.getElementById = id => { assert.ok(elements[id], 'known element ' + id); return elements[id]; };
  return { window, document, elements };
}
function makeRAF() {
  const raf = { now: 0, next: 1, pending: new Map(), cancelled: [] };
  raf.request = callback => {
    const id = raf.next++;
    raf.pending.set(id, callback);
    return id;
  };
  raf.cancel = id => { raf.cancelled.push(id); raf.pending.delete(id); };
  raf.advance = (milliseconds, timestamp = 'clock') => {
    raf.now += milliseconds;
    const pending = [...raf.pending.values()];
    raf.pending.clear();
    const args = timestamp === 'omit' ? [] : [timestamp === 'clock' ? raf.now : timestamp];
    pending.forEach(callback => callback(...args));
  };
  return raf;
}
function makeTimers() {
  let next = 1;
  const pending = new Map();
  const add = (callback, ms, interval) => {
    const id = next++;
    pending.set(id, { callback, ms, interval });
    return id;
  };
  return { pending, setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: id => pending.delete(id), clearInterval: id => pending.delete(id) };
}
class FakeRenderer {
  constructor(document, ratio = 1) {
    this.domElement = document.createElement('canvas');
    this.ratio = ratio;
    this.width = this.height = 0;
    this.ratioChanges = [];
    this.clearColors = [];
    this.sizes = [];
    this.info = { render: { calls: 0 } };
    this.renderCount = this.disposeCount = this.clearCount = 0;
    this.loop = null;
  }
  getPixelRatio() { return this.ratio; }
  setPixelRatio(value) {
    assert.ok(Number.isFinite(value) && value > 0);
    this.ratio = value;
    this.ratioChanges.push(value);
    this.updateSize();
  }
  updateSize() {
    this.domElement.width = Math.floor(this.width * this.ratio);
    this.domElement.height = Math.floor(this.height * this.ratio);
  }
  setSize(width, height) { this.width = width; this.height = height; this.sizes.push([width, height]); this.updateSize(); }
  getDrawingBufferSize(size) { return size.set(this.domElement.width, this.domElement.height); }
  render(scene, camera) {
    assert.equal(this.disposeCount, 0, 'disposed renderer must not render');
    assert.ok(scene.isScene && camera.isCamera);
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    this.renderCount += 1;
    this.info.render.calls = 0;
    scene.traverse(object => {
      if (!object.isMesh || !object.visible) return;
      object.onBeforeRender?.(this, scene, camera, object.geometry, object.material, null);
      this.info.render.calls += 1;
    });
  }
  clear() { this.clearCount += 1; }
  setClearColor(color, alpha) { this.clearColors.push([color, alpha]); }
  setAnimationLoop(callback) { this.loop = callback; }
  dispose() { this.disposeCount += 1; }
}

const artNames = ['spriteMesh', 'sparkleTexture', 'skyPlane', 'createArtScene', 'disposeArtScene'];
function makeArt() {
  const dom = makeDOM();
  return { ...dom, ...compile({ THREE, createBusLoop, document: dom.document, Math: seededMath(),
    UNIT: 1 / 1745, pxX: px => px / 1745 - 0.5,
    pxY: py => (0.5 - py / 1280) * (1280 / 1745) }, artNames,
  'return { skyPlane, createArtScene, disposeArtScene };') };
}
function meshWithMap(group, name) {
  const matches = [];
  group.traverse(object => { if (object.isMesh && object.material.map?.name === name) matches.push(object); });
  assert.equal(matches.length, 1, 'one mesh for texture ' + name);
  return matches[0];
}
function watchResources(group, shared = []) {
  const sets = { geometries: new Set(), materials: new Set(), ownedTextures: new Set(),
    sharedTextures: new Set(shared), instances: new Set() };
  group.traverse(object => {
    if (object.geometry) sets.geometries.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      sets.materials.add(material);
      if (material.map) sets[material.map.userData.artOwned ? 'ownedTextures' : 'sharedTextures'].add(material.map);
    }
    if (object.isInstancedMesh) sets.instances.add(object);
  });
  const counts = Object.fromEntries(Object.entries(sets).map(([kind, set]) => {
    const counts = new Map([...set].map(resource => [resource, 0]));
    set.forEach(resource => resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)));
    return [kind, counts];
  }));
  return { counts, assertReleased() {
    for (const [kind, resources] of Object.entries(counts)) {
      for (const [resource, count] of resources) {
        assert.equal(count, kind === 'sharedTextures' ? 0 : 1, `${kind}: ${resource.uuid} disposal count`);
      }
    }
  }, summary() { return Object.fromEntries(Object.entries(counts).map(([kind, entries]) => [kind, entries.size])); } };
}
function makeMonitor(mobile = true, ratio = 1.5) {
  const dom = makeDOM();
  const renderer = new FakeRenderer(dom.document, ratio);
  renderer.setSize(390, 844);
  renderer.info.render.calls = 14;
  const create = compile({ THREE, document: dom.document, window: dom.window,
    PERF_DEBUG: false, MOBILE_VIEW: mobile }, ['createFrameMonitor'], 'return createFrameMonitor;');
  const monitor = create(renderer, 'AR');
  let now = 0;
  monitor.frame(now);
  return { ...dom, renderer, monitor, feed(dt) {
    assert.equal(2000 % dt, 0, 'test windows must end exactly at the two-second boundary');
    for (let i = 0; i < 2000 / dt; i++) { now += dt; monitor.frame(now); }
  }, reset() { monitor.reset(); monitor.frame(now); } };
}

// Real enterVR/exitVR/startAR; mock platform boundaries and asset-loading promises only.
function makeRuntime(search = '') {
  const dom = makeDOM(), raf = makeRAF(), timers = makeTimers();
  const tex = textures(), renderers = [], mindars = [], mediaCalls = [], fetches = [], clocks = [];
  const urls = { created: [], revoked: [] }, musicCalls = [], musicInit = [];
  const loading = { three: async () => {}, assets: async () => {}, threeCalls: 0, assetCalls: 0 };
  const control = { arError: null, onARStart: () => {} };
  const track = { stops: 0, stop() { this.stops += 1; }, getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  class TestClock {
    constructor() { this.delta = 1 / 60; this.calls = 0; clocks.push(this); }
    getDelta() { this.calls += 1; return this.delta; }
  }
  class TestRenderer extends FakeRenderer {
    constructor(options) { super(dom.document); this.options = options; renderers.push(this); }
  }
  class TestMindAR {
    constructor(options) {
      this.options = options;
      this.container = options.container;
      this.renderer = new TestRenderer({ alpha: true });
      this.renderer.setSize(390, 844);
      this.container.appendChild(this.renderer.domElement);
      this.cssRenderer = { domElement: dom.document.createElement('div') };
      this.container.appendChild(this.cssRenderer.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(55, 390 / 844, 0.1, 100);
      this.resizeCalls = 0;
      dom.window.addEventListener('resize', this.resize.bind(this));
      this.anchor = { group: new THREE.Group() };
      this.anchor.group.visible = false;
      this.anchor.group.matrixAutoUpdate = false;
      this.scene.add(this.anchor.group);
      this.anchorIndices = [];
      this.controller = {
        stops: 0, input: null, inputWidth: 0, inputHeight: 0, dummyInput: null, processInputs: [],
        trackingStates: [{ isTracking: true }],
        async dummyRun(input) { this.dummyInput = input; },
        processVideo(input) { this.input = input; this.processInputs.push(input); },
        stopProcessVideo() { this.stops += 1; }
      };
      mindars.push(this);
    }
    resize() { this.resizeCalls += 1; }
    addAnchor(index) { this.anchorIndices.push(index); return this.anchor; }
    async _startAR() {
      const input = this.video;
      this.controller.inputWidth = input.videoWidth;
      this.controller.inputHeight = input.videoHeight;
      await this.controller.dummyRun(input);
      this.controller.processVideo(input);
      this.resize();
    }
    async start() {
      await this._startVideo();
      await this._startAR();
      control.onARStart(this);
      if (control.arError) throw control.arError;
    }
  }
  const scope = { THREE: { ...THREE, WebGLRenderer: TestRenderer, Clock: TestClock },
    createBusLoop, MindARThree: TestMindAR, document: dom.document, window: dom.window,
    location: { search }, URLSearchParams, Math: seededMath(),
    createBackgroundMusic: (audio, button, note) => {
      musicInit.push({ audio, button, note });
      return { enter: fromGesture => musicCalls.push(['enter', fromGesture]),
        stop: () => musicCalls.push(['stop']) };
    },
    ART_META: meta, ART_TEX: tex, UNIT: 1 / 1745,
    pxX: px => px / 1745 - 0.5, pxY: py => (0.5 - py / 1280) * (1280 / 1745),
    MOBILE_VIEW: true, PERF_DEBUG: false, devicePixelRatio: 4, innerWidth: 390, innerHeight: 844,
    performance: { now: () => raf.now }, requestAnimationFrame: raf.request, cancelAnimationFrame: raf.cancel,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    navigator: { mediaDevices: { getUserMedia: async constraints => { mediaCalls.push(constraints); return stream; } } },
    ensureThree: () => { loading.threeCalls += 1; return loading.three(); },
    ensureMindAR: async () => {}, ensureAudio: () => null,
    loadArtAssets: () => { loading.assetCalls += 1; return loading.assets(); },
    DeviceOrientationEvent: undefined, Blob,
    URL: { createObjectURL(blob) { assert.ok(blob instanceof Blob); urls.created.push(blob); return 'blob:node-test-mind'; },
      revokeObjectURL(url) { urls.revoked.push(url); } },
    fetch: async url => {
      fetches.push(url);
      assert.equal(url, './assets/target.mind', 'only the mocked target fetch is allowed');
      let read = false;
      return { ok: true, headers: { get: () => '3' }, body: { getReader: () => ({ read: async () => {
        if (read) return { done: true };
        read = true;
        return { done: false, value: new Uint8Array([1, 2, 3]) };
      } }) } };
    } };
  const names = [...artNames, 'getRenderPixelRatio', 'dampingFactor', 'requestCameraStream',
    'createCameraPreview', 'createTrackingInput', 'createPoseFollower', 'createFrameMonitor',
    'startAR', 'enterVR', 'exitVR'];
  const runtime = compile(scope, names, `
    ${between('const statusEl =', '/* ── 手机画质')}
    let arBusy = false, vrActive = false, vrState = null, vrRequest = 0, vrBusy = false;
    let yawT = 0, pitchT = 0, lastInteract = 0, gyroBase = null, gyroOff = 0;
    ${between("document.getElementById('vrBtn').addEventListener", '\nlet vrBusy = false;')}
    const dampingInputs = [], realDampingFactor = dampingFactor;
    dampingFactor = dt => { dampingInputs.push(dt); return realDampingFactor(dt); };
    return { enterVR, exitVR, startAR, dampingInputs,
      snapshot: () => ({ arBusy, vrActive, vrState, vrRequest, vrBusy, yawT, pitchT, gyroOff }),
      viewport: (width, height) => { innerWidth = width; innerHeight = height; }
    };
  `);
  return { ...dom, raf, timers, tex, renderers, mindars, mediaCalls, fetches, urls, clocks,
    musicCalls, musicInit, loading, control, track, stream, runtime };
}

const results = [];
async function test(name, run) {
  try {
    const details = await run();
    results.push({ name, passed: true, ...details });
  } catch (error) {
    const stack = String(error.stack || error).split('\n').slice(0, 7)
      .map(line => line.length > 350 ? line.slice(0, 350) + ' [truncated]' : line).join('\n');
    results.push({ name, passed: false, error: stack });
    console.error('FAIL ' + name + '\n' + stack);
  }
}

await test('runtime metadata and asset / music / instancing wiring', () => {
  const version = /const ART_VERSION = '(\d+)';/.exec(html);
  assert.ok(version);
  assert.equal(String(meta.version), version[1]);
  assert.deepEqual(meta.size, [1745, 1280]);
  assert.match(html, new RegExp('<audio id="backgroundMusic" src="\\./assets/audio/bye-bye-blackbird\\.mp3\\?v=' + version[1] + '" preload="none"'));
  assert.match(html, /<span id="musicNote"/);
  assert.match(html, /<button id="musicToggle"/);
  assert.equal((html.match(/const music = createBackgroundMusic\(/g) || []).length, 1);
  assert.match(html, /entryMode = null;[\s\S]*?music = createBackgroundMusic/);
  assert.match(html, /document\.getElementById\('arBtn'\)\.addEventListener\('click',\s*\(\) => \{[\s\S]*?if \(arBusy \|\| vrBusy \|\| entryMode\) return;[\s\S]*?music\.enter\(true\)/);
  assert.match(html, /if \(vrBusy \|\| arBusy \|\| entryMode === 'AR'\) return;/);
  assert.match(html, /music\.enter\(false\)/);
  assert.match(html, /music\.enter\(!auto\)/);
  assert.match(html, /if \(wantsVR\) \{\s*enterVR\(true\);/);
  assert.match(html, /const backToSplash = \(\) => \{\s*entryMode = null;\s*music\.stop\(\);/);
  assert.match(html, /artUrl\('meta\.json'\)/);
  assert.match(html, /artUrl\(n \+ '\.webp'\)/);
  // Only wiring is checked textually; objects, animation, and dispatch execute below.
  assert.match(threeSource, /if \( object\.isInstancedMesh \) \{\s*renderer\.renderInstances\( drawStart, drawCount, object\.count \);/);
  return { version: meta.version, threeRevision: THREE.REVISION };
});

await test('skyPlane AR dimensions, opaque inputs, alpha/depth, and paper-plane offset', () => {
  const art = makeArt();
  const sky = art.skyPlane(meta.skyStops, meta.size);
  near(sky.geometry.parameters.width, 1.12);
  near(sky.geometry.parameters.height, 1.12 * 1280 / 1745);
  assert.deepEqual(sky.material.map.repeat.toArray(), [1.12, 1.12]);
  sky.material.map.offset.toArray().forEach(offset => near(offset, -0.06));
  sky.material.map.updateMatrix();
  for (const uv of [[0, 0], [0.25, 0.4], [0.5, 0.5], [1, 1]]) {
    const expandedUV = new THREE.Vector2((uv[0] - 0.5) / 1.12 + 0.5, (uv[1] - 0.5) / 1.12 + 0.5);
    sky.material.map.transformUv(expandedUV);
    near(expandedUV.x, uv[0]);
    near(expandedUV.y, 1 - uv[1], 1e-12, 'CanvasTexture flipY keeps original paper-area colours');
  }
  assert.equal(sky.name, 'ar-backdrop');
  assert.deepEqual(sky.position.toArray(), [0, 0, -0.01]);
  assert.equal(sky.renderOrder, -100);
  assert.equal(sky.material.transparent, true, 'transparent render queue is intentional');
  assert.equal(sky.material.opacity, 1, 'transparent queue must NOT imply translucent sky');
  assert.equal(sky.material.depthWrite, false);
  assert.equal(sky.material.depthTest, false);
  assert.equal(sky.material.map.isCanvasTexture, true);
  assert.equal(sky.material.map.userData.artOwned, true);
  assert.equal(sky.material.map.encoding, THREE.sRGBEncoding);
  const canvas = sky.material.map.image;
  assert.deepEqual([canvas.width, canvas.height], [8, 512]);
  const context = canvas.context;
  assert.equal(context.gradients.length, 1);
  assert.equal(context.gradients[0].kind, 'Linear');
  assert.deepEqual(context.gradients[0].args, [0, 0, 0, 512]);
  assert.deepEqual(context.gradients[0].stops,
    meta.skyStops.map((color, i) => ({ offset: i / (meta.skyStops.length - 1), color })));
  // All current stops are alpha-implicit opaque #RRGGBB, not rgba or alpha hex.
  for (const color of meta.skyStops) {
    assert.equal(color.length, 7);
    assert.equal(color[0], '#');
    assert.ok([...color.slice(1)].every(ch => '0123456789abcdef'.includes(ch.toLowerCase())));
  }
  assert.equal(context.fills.length, 1);
  assert.deepEqual(context.fills[0].rect, [0, 0, 8, 512]);
  assert.equal(context.fills[0].style, context.gradients[0]);
  assert.equal(context.fills[0].alpha, 1);
  const group = new THREE.Group();
  group.position.z = 0.01;
  group.add(sky);
  group.updateMatrixWorld(true);
  const world = sky.getWorldPosition(new THREE.Vector3());
  near(world.z, 0);
  return { dimensions: [1.12, 1.12 * 1280 / 1745], texture: [8, 512], opacity: sky.material.opacity,
    transparent: sky.material.transparent, worldZ: world.z, opaqueStops: meta.skyStops.length };
});

await test('createArtScene backdrop ordering, AR depth/clipping, and unchanged VR depths', () => {
  const api = makeArt(), tex = textures();
  const ar = api.createArtScene(meta, tex, { withBackdrop: true });
  const backdrop = ar.group.getObjectByName('ar-backdrop');
  const stars = ar.group.getObjectByName('sparkles');
  assert.ok(backdrop && stars);
  assert.equal(ar.group.getObjectByName('vr-sky'), undefined);
  assert.deepEqual(ar.group.scale.toArray(), [1, 1, 1], 'only backdrop geometry grows');
  assert.equal(stars.renderOrder, -10);
  const foreground = [];
  ar.group.traverse(object => {
    if (object.isMesh && object !== backdrop && object !== stars) foreground.push(object);
  });
  assert.equal(foreground.length, 12);
  foreground.forEach(object => assert.ok(object.renderOrder > stars.renderOrder));
  assert.ok(backdrop.renderOrder < stars.renderOrder);

  const busGroup = meshWithMap(ar.group, 'bus').parent;
  const busMesh = meshWithMap(ar.group, 'bus');
  const wheelFaces = busGroup.children.slice(1).map(wheel => wheel.children[1]);
  const signGroup = meshWithMap(ar.group, 'sign').parent;
  const bench = meshWithMap(ar.group, 'bench');
  near(busGroup.position.z, 0.005, 1e-12, 'AR bus local z');
  near(signGroup.position.z, 0.015, 1e-12, 'AR sign local z');
  near(bench.position.z, 0.035, 1e-12, 'AR bench local z');
  const birdDepths = ['bird1', 'bird2', 'bird3', 'bird4', 'bird6']
    .map(name => meshWithMap(ar.group, name).position.z);
  birdDepths.forEach((depth, index) => near(depth, 0.065 + index * 0.001, 1e-12, 'AR bird local z'));
  const starMatrix = new THREE.Matrix4();
  for (let i = 0; i < stars.count; i++) {
    stars.getMatrixAt(i, starMatrix);
    assert.ok(starMatrix.elements[14] >= 0.002 && starMatrix.elements[14] <= 0.005,
      'AR stars stay close to the paper plane');
  }
  const clipPlanes = busMesh.material.clippingPlanes;
  assert.equal(clipPlanes.length, 2);
  nearVector(clipPlanes[0].normal, [1, 0, 0]); near(clipPlanes[0].constant, 0.56);
  nearVector(clipPlanes[1].normal, [-1, 0, 0]); near(clipPlanes[1].constant, 0.56);
  ar.group.position.set(0.2, -0.1, 0.3);
  ar.group.rotation.z = 0.25;
  ar.group.scale.set(1.2, 0.8, 1.4);
  ar.group.updateMatrixWorld(true);
  const expectedWorldPlanes = clipPlanes.map((_, index) => new THREE.Plane(
    new THREE.Vector3(index === 0 ? 1 : -1, 0, 0), 0.56
  ).applyMatrix4(ar.group.matrixWorld));
  busMesh.onBeforeRender();
  clipPlanes.forEach((plane, index) => {
    nearVector(plane.normal, expectedWorldPlanes[index].normal.toArray(), 1e-12, 'world clip normal');
    near(plane.constant, expectedWorldPlanes[index].constant, 1e-12, 'world clip constant');
  });

  const vr = api.createArtScene(meta, tex, { withSky: true });
  const sky = vr.group.getObjectByName('vr-sky');
  assert.ok(sky);
  assert.equal(vr.group.getObjectByName('ar-backdrop'), undefined);
  assert.deepEqual([sky.geometry.parameters.width, sky.geometry.parameters.height], [8, 6.5]);
  assert.deepEqual(sky.position.toArray(), [0, 0.3, -3.6]);
  assert.equal(sky.renderOrder, -100);
  near(meshWithMap(vr.group, 'bus').parent.position.z, -0.04, 1e-12, 'VR bus z unchanged');
  near(meshWithMap(vr.group, 'sign').parent.position.z, 0.012, 1e-12, 'VR sign z unchanged');
  near(meshWithMap(vr.group, 'bench').position.z, 0.02, 1e-12, 'VR bench z unchanged');
  const bare = api.createArtScene(meta, tex);
  assert.equal(bare.group.getObjectByName('ar-backdrop'), undefined);
  assert.equal(bare.group.getObjectByName('vr-sky'), undefined);
  assert.deepEqual(ar.group.scale.toArray(), [1.2, 0.8, 1.4], 'only backdrop geometry grows');
  for (const name of Object.keys(meta.rects).filter(name => !name.startsWith('wheel'))) {
    const foregroundMesh = meshWithMap(ar.group, name), original = meshWithMap(bare.group, name);
    assert.deepEqual(foregroundMesh.geometry.parameters, original.geometry.parameters, name + ' geometry unchanged');
    const expectedPosition = original.position.clone();
    if (name.startsWith('bird')) expectedPosition.z += 0.02;
    if (name === 'bench') expectedPosition.z += 0.015;
    nearVector(foregroundMesh.position, expectedPosition.toArray(), 1e-12,
      name + (name.startsWith('bird') || name === 'bench' ? ' keeps xy and gets the AR depth offset' : ' position unchanged'));
    assert.deepEqual(foregroundMesh.scale.toArray(), [1, 1, 1], name + ' is not enlarged');
  }
  const both = api.createArtScene(meta, tex, { withSky: true, withBackdrop: true });
  assert.ok(both.group.getObjectByName('ar-backdrop'));
  assert.equal(both.group.getObjectByName('vr-sky'), undefined, 'backdrop takes precedence');
  return { order: [backdrop.renderOrder, stars.renderOrder, Math.min(...foreground.map(m => m.renderOrder))],
    foregroundMeshes: foreground.length, arDepths: { bus: 0.005, sign: 0.015, bench: 0.035, birds: birdDepths },
    clipPlanes: clipPlanes.map(plane => ({ normal: plane.normal.toArray(), constant: plane.constant })),
    vrSky: { size: [8, 6.5], position: sky.position.toArray(), busZ: -0.04 } };
});

await test('createArtScene runs the complete eight-second bus loop and continuous wheel travel', () => {
  const art = makeArt().createArtScene(meta, textures());
  const busGroup = meshWithMap(art.group, 'bus').parent;
  const wheelFaces = busGroup.children.slice(1).map(wheel => wheel.children[1]);
  const loop = createBusLoop(meta);
  assert.equal(loop.duration, 8, 'default bus loop is eight seconds');
  assert.equal(busGroup.position.z, -0.04, 'default/VR bus depth is unchanged');
  const start = 1.25;
  art.startDriveIn(start);
  const samples = [];
  for (const elapsed of [0, 0.5, 7.99, 8, 8.25, 16]) {
    const time = start + elapsed, expected = loop.sample(elapsed);
    art.animate(time);
    near(busGroup.position.x, expected.x, 1e-12, `bus position at ${elapsed}s`);
    near(busGroup.position.y, Math.sin(time * 8) * 0.002, 1e-12, `bus bob at ${elapsed}s`);
    wheelFaces.forEach((wheel, index) => near(wheel.rotation.z, expected.angle, 1e-12,
      `wheel ${index} angle at ${elapsed}s`));
    samples.push({ elapsed, x: busGroup.position.x, wheelAngle: wheelFaces[0].rotation.z });
  }
  near(samples[0].x, samples[3].x, 1e-12, 'position wraps after one full loop');
  assert.ok(samples[3].wheelAngle < samples[0].wheelAngle, 'wheel angle accumulates across the position wrap');
  assert.notEqual(samples[4].x, samples[0].x, 'bus does not remain parked at the loop start');
  assert.ok(samples[5].wheelAngle < samples[3].wheelAngle, 'wheels continue through a second loop');
  return { duration: loop.duration, startTime: start, samples, wheelFaces: wheelFaces.length,
    motion: 'position wraps; wheel angle follows unwrapped distance' };
});

await test('24 sparkles share one InstancedMesh and update real matrix/color buffers', () => {
  const api = makeArt();
  const art = api.createArtScene(meta, textures());
  const starMesh = art.group.getObjectByName('sparkles');
  const instances = [], sparkleDrawables = [];
  art.group.traverse(object => {
    if (object.isInstancedMesh) instances.push(object);
    if (object.isMesh && object.material.map === starMesh.material.map) sparkleDrawables.push(object);
  });
  assert.deepEqual(instances, [starMesh]);
  assert.deepEqual(sparkleDrawables, [starMesh]);
  assert.equal(starMesh.count, 24);
  assert.equal(starMesh.children.length, 0);
  assert.equal(starMesh.instanceMatrix.count, 24);
  assert.equal(starMesh.instanceColor.count, 24);
  assert.equal(starMesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
  assert.equal(starMesh.instanceColor.usage, THREE.DynamicDrawUsage);
  assert.equal(starMesh.frustumCulled, false);
  assert.equal(starMesh.material.side, THREE.FrontSide);
  assert.equal(starMesh.material.blending, THREE.AdditiveBlending);
  assert.equal(starMesh.material.map.isCanvasTexture, true);
  assert.equal(starMesh.geometry.groups.length, 0);
  const initial = Array.from(starMesh.instanceMatrix.array);
  const firstMatrices = [], firstColors = [];
  for (const [sample, time] of [0, 0.37, 1.1, 2.8].entries()) {
    const matrixVersion = starMesh.instanceMatrix.version, colorVersion = starMesh.instanceColor.version;
    art.animate(time);
    assert.equal(starMesh.instanceMatrix.version, matrixVersion + 1);
    assert.equal(starMesh.instanceColor.version, colorVersion + 1);
    for (let i = 0; i < 24; i++) {
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
      const rotation = new THREE.Quaternion(), color = new THREE.Color();
      starMesh.getMatrixAt(i, matrix);
      starMesh.getColorAt(i, color);
      assert.ok(matrix.elements.every(Number.isFinite));
      matrix.decompose(position, rotation, scale);
      near(position.x, initial[i * 16 + 12], 1e-6);
      near(position.y, initial[i * 16 + 13], 1e-6);
      near(position.z, initial[i * 16 + 14], 1e-6);
      assert.ok(scale.x >= 0.5 - 1e-6 && scale.x <= 1.8 + 1e-6);
      near(scale.x, scale.y, 1e-6); near(scale.y, scale.z, 1e-6);
      assert.ok(color.r >= 0.35 - 1e-6 && color.r <= 0.95 + 1e-6);
      near(color.r, color.g, 1e-6); near(color.g, color.b, 1e-6);
      if (sample === 0) { firstMatrices[i] = matrix.elements.slice(); firstColors[i] = color.r; }
      if (sample === 3) {
        assert.notDeepEqual(matrix.elements, firstMatrices[i], 'each instance scale must animate');
        assert.notEqual(color.r, firstColors[i], 'each instance color must animate');
      }
    }
  }
  return { instancedMeshes: instances.length, instances: starMesh.count, samples: 4,
    matrixVersion: starMesh.instanceMatrix.version, colorVersion: starMesh.instanceColor.version };
});

await test('real THREE instanced dispatch emits one 24-instance draw on WebGL2 and WebGL1', () => {
  const api = makeArt();
  const star = api.createArtScene(meta, textures()).group.getObjectByName('sparkles');
  const factories = new Function(functionSource('WebGLIndexedBufferRenderer', threeSource) + '\n'
    + functionSource('WebGLInfo', threeSource) + '\nreturn { WebGLIndexedBufferRenderer, WebGLInfo };')();
  const paths = [];
  for (const isWebGL2 of [true, false]) {
    const calls = [];
    const gl = { drawElementsInstanced: (...args) => calls.push(args),
      drawElements: () => assert.fail('sparkles must not use non-instanced drawElements') };
    const extensions = { get: name => {
      assert.equal(name, 'ANGLE_instanced_arrays');
      return { drawElementsInstancedANGLE: (...args) => calls.push(args) };
    } };
    const info = factories.WebGLInfo(gl);
    const dispatcher = new factories.WebGLIndexedBufferRenderer(gl, extensions, info, { isWebGL2 });
    dispatcher.setMode(4);
    dispatcher.setIndex({ type: 5123, bytesPerElement: star.geometry.index.array.BYTES_PER_ELEMENT });
    dispatcher.renderInstances(0, star.geometry.index.count, star.count);
    assert.deepEqual(calls, [[4, 6, 5123, 0, 24]]);
    assert.equal(info.render.calls, 1);
    assert.equal(info.render.triangles, 48);
    dispatcher.renderInstances(0, star.geometry.index.count, 0);
    assert.equal(calls.length, 1, 'zero instances must not draw');
    paths.push({ api: isWebGL2 ? 'WebGL2' : 'ANGLE_instanced_arrays', calls: info.render.calls, instances: 24 });
  }
  return { paths, driver: 'fake GL; real vendored THREE dispatch and WebGLInfo' };
});

await test('getRenderPixelRatio caps high-DPR phones/desktops and rejects invalid DPR', () => {
  const get = compile({}, ['getRenderPixelRatio'], 'return getRenderPixelRatio;');
  const cases = [0.5, 1, 1.25, 1.5, 2, 3, 4, 1000].map(dpr => {
    const mobile = get(dpr, true), desktop = get(dpr, false);
    near(mobile, Math.min(dpr, 1.5)); near(desktop, Math.min(dpr, 2));
    return { dpr, mobile, desktop };
  });
  const invalid = [undefined, null, NaN, Infinity, -Infinity, 0, -1, '3', {}, []];
  invalid.forEach(dpr => { assert.equal(get(dpr, true), 1); assert.equal(get(dpr, false), 1); });
  return { cases, invalidInputs: invalid.length, fallback: 1,
    note: 'valid DPR below 1 is preserved; the adaptive monitor floor is tested separately' };
});

await test('dampingFactor has equal one-second response at 30/60/120Hz and clamps large dt', () => {
  const damping = compile({}, ['dampingFactor'], 'return dampingFactor;');
  const expected = 1 - Math.exp(-5), response = [];
  for (const hz of [30, 60, 120]) {
    let value = 0;
    for (let frame = 0; frame < hz; frame++) value += (1 - value) * damping(1 / hz);
    near(value, expected);
    response.push({ hz, value });
  }
  assert.equal(damping(0), 0);
  assert.equal(damping(-1), 0);
  for (const dt of [0.1, 0.5, 10, Infinity]) near(damping(dt), 1 - Math.exp(-0.5));
  return { response, expected, largeDtBlend: damping(10), clampSeconds: 0.1 };
});

const idealCameraConstraints = { audio: false, video: { facingMode: { ideal: 'environment' },
  width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } };
const fallbackCameraConstraints = { audio: false, video: { facingMode: 'environment' } };
function cameraRequest(implementation) {
  const calls = [];
  const request = compile({ navigator: { mediaDevices: { getUserMedia: async constraints => {
    calls.push(constraints);
    return implementation(calls.length);
  } } } }, ['requestCameraStream'], 'return requestCameraStream;');
  return { calls, request };
}
await test('requestCameraStream succeeds with one ideal 720p30 request and the same stream', async () => {
  const stream = { id: 'single-camera-stream' };
  const camera = cameraRequest(() => stream);
  assert.equal(await camera.request(), stream);
  assert.deepEqual(camera.calls, [idealCameraConstraints]);
  return { requests: camera.calls.length, ideal: '1280x720 at 30fps, environment, no audio' };
});
for (const name of ['OverconstrainedError', 'ConstraintNotSatisfiedError']) {
  await test('requestCameraStream retries ' + name + ' exactly once', async () => {
    const stream = { id: 'fallback-stream' }, error = namedError(name);
    const camera = cameraRequest(attempt => { if (attempt === 1) throw error; return stream; });
    assert.equal(await camera.request(), stream);
    assert.deepEqual(camera.calls, [idealCameraConstraints, fallbackCameraConstraints]);
    return { requests: camera.calls.length, fallbackRequests: 1 };
  });
}
for (const name of ['NotAllowedError', 'NotReadableError']) {
  await test('requestCameraStream never re-prompts on ' + name, async () => {
    const error = namedError(name);
    const camera = cameraRequest(() => { throw error; });
    await assert.rejects(camera.request(), actual => actual === error);
    assert.deepEqual(camera.calls, [idealCameraConstraints]);
    return { requests: camera.calls.length, originalErrorPropagated: true };
  });
}
await test('requestCameraStream propagates fallback failure without a third request', async () => {
  const error = namedError('NotAllowedError');
  const camera = cameraRequest(attempt => { throw attempt === 1 ? namedError('OverconstrainedError') : error; });
  await assert.rejects(camera.request(), actual => actual === error);
  assert.deepEqual(camera.calls, [idealCameraConstraints, fallbackCameraConstraints]);
  return { requests: camera.calls.length, originalFallbackErrorPropagated: true };
});

await test('createFrameMonitor ignores compile warmup, then steps mobile DPR down to 1', () => {
  const h = makeMonitor();
  const ratios = [];
  const window = dt => { h.feed(dt); ratios.push(h.renderer.getPixelRatio()); };
  window(100); // First two seconds can be shader/texture compilation: ignore even 10fps.
  assert.equal(h.monitor.stats.fps, 10);
  assert.deepEqual(h.renderer.ratioChanges, []);
  window(40); assert.deepEqual(h.renderer.ratioChanges, []);
  window(40); assert.deepEqual(h.renderer.ratioChanges, [1.25]);
  window(40); assert.deepEqual(h.renderer.ratioChanges, [1.25]);
  window(40); assert.deepEqual(h.renderer.ratioChanges, [1.25, 1]);
  for (let i = 0; i < 6; i++) window(40);
  assert.deepEqual(h.renderer.ratioChanges, [1.25, 1]);
  assert.ok(ratios.every(ratio => ratio >= 1));
  assert.equal(h.monitor.stats.pixelRatio, 1);
  assert.equal(h.monitor.stats.frameMs, 40);
  assert.equal(h.monitor.stats.fps, 25);
  assert.equal(h.monitor.stats.drawCalls, 14);
  assert.deepEqual(h.monitor.stats.canvas, [390, 844]);
  assert.equal(h.document.created.filter(node => node.tagName === 'OUTPUT').length, 0);
  assert.equal('__blackbirdPerf' in h.window, false);
  h.monitor.dispose();
  return { windowMs: 2000, ratios, changes: h.renderer.ratioChanges, debug: false };
});
await test('createFrameMonitor fast windows never downgrade and break slow streaks', () => {
  const h = makeMonitor();
  h.feed(100); // Ignored compile window.
  for (let i = 0; i < 5; i++) h.feed(10);
  assert.deepEqual(h.renderer.ratioChanges, []);
  h.feed(40); h.feed(10); h.feed(40);
  assert.deepEqual(h.renderer.ratioChanges, [], 'non-consecutive slow windows do not add up');
  h.feed(40);
  assert.deepEqual(h.renderer.ratioChanges, [1.25]);
  h.reset();
  h.feed(100); h.feed(40);
  assert.deepEqual(h.renderer.ratioChanges, [1.25], 'reset starts a fresh warmup and slow streak');
  h.feed(40);
  assert.deepEqual(h.renderer.ratioChanges, [1.25, 1]);
  h.monitor.dispose();
  return { fastWindowFps: 100, fastWindows: 6, resetWarmupIgnored: true, changes: h.renderer.ratioChanges };
});
await test('createFrameMonitor desktop / threshold boundaries and tracking statistics', () => {
  const desktop = makeMonitor(false, 2);
  for (let i = 0; i < 8; i++) desktop.feed(40);
  assert.deepEqual(desktop.renderer.ratioChanges, []);
  assert.equal(desktop.renderer.getPixelRatio(), 2);
  const h = makeMonitor();
  const settings = { width: 1280, height: 720, frameRate: 30 };
  h.monitor.setCamera(settings);
  settings.width = 1;
  assert.deepEqual(h.monitor.stats.camera, { width: 1280, height: 720, frameRate: 30 });
  h.monitor.setTracking(true);
  h.monitor.track(10); h.monitor.track(43); h.monitor.track(76);
  h.feed(40);
  assert.equal(h.monitor.stats.trackingMs, 33);
  for (let i = 0; i < 4; i++) h.feed(25);
  assert.deepEqual(h.renderer.ratioChanges, [], '25ms frames are not >25ms slow frames');
  h.monitor.setTracking(false);
  assert.equal(h.monitor.stats.tracking, false);
  assert.equal(h.monitor.stats.trackingMs, null);
  desktop.monitor.dispose(); h.monitor.dispose();
  return { desktopDpr: 2, thresholdFrameMs: 25, trackingMs: 33, debug: false };
});

await test('disposeArtScene releases unique owned resources, not shared ART_TEX', () => {
  const api = makeArt(), tex = textures();
  const art = api.createArtScene(meta, tex, { withSky: true });
  const sky = art.group.getObjectByName('vr-sky');
  art.group.add(sky.clone()); // Same geometry/material/owned texture reached twice.
  art.group.add(new THREE.Mesh(sky.geometry, [sky.material,
    new THREE.MeshBasicMaterial({ map: sky.material.map })]));
  const unownedCanvas = new THREE.CanvasTexture(api.document.createElement('canvas'));
  art.group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: unownedCanvas })));
  const resources = watchResources(art.group, [...Object.values(tex), unownedCanvas]);
  assert.equal(resources.counts.ownedTextures.size, 2);
  for (const texture of resources.counts.ownedTextures.keys()) assert.equal(texture.isCanvasTexture, true);
  api.disposeArtScene(art.group);
  resources.assertReleased();
  assert.ok(Object.values(tex).every(texture => texture.userData.artOwned !== true));
  return { ...resources.summary(), sharedArtTexturesPreserved: Object.keys(tex).length,
    unownedCanvasPreserved: true, duplicateReferencesDisposedOnce: true };
});

await test('startAR uses native near-pass filtering, a sibling visual root, and one shared camera preview', async () => {
  const h = makeRuntime();
  await h.runtime.startAR();
  assert.equal(h.musicInit.length, 1);
  assert.deepEqual([h.musicInit[0].audio.id, h.musicInit[0].button.id, h.musicInit[0].note.id],
    ['backgroundMusic', 'musicToggle', 'musicNote']);
  assert.deepEqual(h.musicCalls, [['enter', false]], 'successful startAR does not claim a user gesture');
  assert.equal(h.mindars.length, 1);
  const mindar = h.mindars[0];
  assert.deepEqual(mindar.anchorIndices, [0]);
  assert.equal(mindar.options.maxTrack, 1);
  assert.equal(mindar.options.filterMinCF, 1);
  assert.equal(mindar.options.filterBeta, 0);
  assert.equal(mindar.options.missTolerance, undefined, 'native loss tolerance is retained');
  assert.equal(mindar.renderer.localClippingEnabled, true);
  const anchorRoot = mindar.anchor.group;
  const visualRoot = mindar.scene.getObjectByName('ar-visual-root');
  assert.ok(visualRoot);
  assert.equal(anchorRoot.parent, mindar.scene);
  assert.equal(visualRoot.parent, mindar.scene);
  assert.equal(anchorRoot.parent, visualRoot.parent, 'the pose root is a sibling of the raw MindAR anchor');
  assert.equal(anchorRoot.children.length, 0, 'art is not nested under the raw tracking matrix');
  assert.equal(visualRoot.children.length, 1);
  const group = visualRoot.children[0];
  const backdrop = group.getObjectByName('ar-backdrop');
  assert.ok(backdrop);
  assert.equal(group.getObjectByName('vr-sky'), undefined);
  assert.equal(group.position.z, 0.01);
  group.updateWorldMatrix(true, true);
  near(backdrop.getWorldPosition(new THREE.Vector3()).z, 0);

  const previewVideo = h.document.created.find(node => node.tagName === 'VIDEO');
  assert.ok(previewVideo, 'the real DOM camera preview exists');
  assert.equal(h.document.created.filter(node => node.tagName === 'VIDEO').length, 1,
    'MindAR does not create a second DOM camera element');
  assert.equal(previewVideo.srcObject, h.stream);
  assert.equal(previewVideo.parentNode, h.elements.container);
  assert.equal(previewVideo.paused, false);
  assert.deepEqual([previewVideo.videoWidth, previewVideo.videoHeight], [1280, 720]);
  assert.equal(mindar.video.tagName, 'CANVAS', 'MindAR receives the offscreen tracking proxy by default');
  assert.notEqual(mindar.video, previewVideo, 'camera UI assertions use preview.video, not the proxy');
  assert.equal(mindar.controller.input, mindar.video);
  assert.equal(mindar.controller.dummyInput, mindar.video);
  assert.deepEqual(mindar.controller.processInputs, [mindar.video]);
  assert.deepEqual([mindar.controller.inputWidth, mindar.controller.inputHeight], [800, 450]);
  assert.equal(mindar.video.videoWidth, mindar.video.width);
  assert.equal(mindar.video.videoHeight, mindar.video.height);
  assert.equal(mindar.video.context.draws.length, 1, 'initial tracking proxy copy uses drawImage');
  assert.equal(h.mediaCalls.length, 1);
  assert.deepEqual(h.mediaCalls[0], idealCameraConstraints);
  assert.equal(h.track.stops, 0);
  assert.equal(h.raf.pending.size, 0, 'tracking adds no second rAF loop');
  assert.deepEqual(h.fetches, ['./assets/target.mind']);
  assert.equal(h.urls.created.length, 1);
  assert.deepEqual(h.urls.revoked, ['blob:node-test-mind']);
  assert.equal(mindar.renderer.getPixelRatio(), 1.5);
  assert.deepEqual(mindar.renderer.clearColors, [[0, 0]], 'AR clears transparently over the camera');
  assert.equal(String(mindar.renderer.domElement.style.zIndex), '1');
  assert.equal(String(mindar.cssRenderer.domElement.style.zIndex), '2');
  assert.equal(mindar.scene.background, null);
  assert.equal(typeof mindar.renderer.loop, 'function');
  assert.equal(group.visible, false);
  assert.equal(visualRoot.visible, false);
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 0, 'unrecognized anchor is not rendered');
  anchorRoot.visible = true;
  mindar.anchor.onTargetFound();
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 0, 'found alone cannot display a stale pose');
  mindar.anchor.onTargetUpdate();
  assert.equal(group.visible, true);
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 1);
  const beforeHide = mindar.renderer.clearCount;
  h.document.hidden = true; h.document.dispatch('visibilitychange');
  assert.equal(mindar.renderer.loop, null);
  assert.equal(group.visible, false);
  assert.equal(visualRoot.visible, false);
  assert.equal(mindar.renderer.clearCount, beforeHide + 1);
  mindar.anchor.onTargetUpdate();
  assert.equal(group.visible, false, 'background tracking updates cannot reveal the artwork');
  const playsBeforeResume = previewVideo.playCount;
  previewVideo.paused = true; // Simulate a browser suspending camera playback in the background.
  h.document.hidden = false; h.document.dispatch('visibilitychange');
  assert.equal(previewVideo.playCount, playsBeforeResume + 1, 'visible return resumes the actual preview video');
  await Promise.resolve();
  assert.equal(previewVideo.paused, false);
  assert.equal(typeof mindar.renderer.loop, 'function');
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 1, 'resume waits for a new tracking callback');
  mindar.anchor.onTargetUpdate();
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 2);
  const beforeLost = mindar.renderer.clearCount;
  anchorRoot.visible = false;
  mindar.anchor.onTargetLost();
  assert.equal(group.visible, false);
  assert.equal(previewVideo.paused, false, 'losing a target keeps the camera preview playing');
  assert.equal(mindar.renderer.clearCount, beforeLost + 1);
  mindar.anchor.onTargetUpdate();
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 2, 'lost target does not leave artwork floating');
  anchorRoot.visible = true;
  mindar.anchor.onTargetFound();
  mindar.anchor.onTargetUpdate();
  mindar.renderer.loop();
  assert.equal(group.visible, true);
  assert.equal(mindar.renderer.renderCount, 3, 'reacquisition displays the newly reported pose');
  return { anchor: 0, siblings: true, nativeFilters: [1, 0], proxyInput: [800, 450],
    cameraRequests: 1, actualPreview: [1280, 720], hiddenLoopPaused: true,
    targetLostCleared: true, resumeWaitsForTrackingUpdate: true };
});
await test('startAR initialization failure releases scene/renderer and stops its stream', async () => {
  const h = makeRuntime();
  let resources;
  h.control.arError = new Error('mock initialization failure');
  h.control.onARStart = mindar => {
    resources = watchResources(mindar.scene.getObjectByName('ar-visual-root'), Object.values(h.tex));
  };
  await h.runtime.startAR();
  assert.deepEqual(h.musicCalls, [['enter', false], ['stop']], 'AR startup failure stops music immediately');
  assert.ok(resources);
  resources.assertReleased();
  const mindar = h.mindars[0];
  const previewVideo = h.document.created.find(node => node.tagName === 'VIDEO');
  assert.ok(previewVideo);
  assert.equal(h.track.stops, 1);
  assert.equal(mindar.controller.stops, 1);
  assert.equal(mindar.controller.input, mindar.video, 'failed startup stops the controller using its proxy input');
  assert.equal(mindar.renderer.disposeCount, 1);
  assert.equal(mindar.renderer.loop, null);
  for (const node of [mindar.renderer.domElement, mindar.cssRenderer.domElement]) {
    assert.equal(node.parentNode, null);
    assert.equal(node.removeCount, 1);
  }
  assert.equal(previewVideo.parentNode, null);
  assert.equal(previewVideo.removeCount, 1);
  assert.equal(mindar.video.parentNode, null, 'offscreen proxy is not inserted into the DOM');
  assert.equal(mindar.video.removeCount, 0, 'offscreen proxy is disposed without a DOM remove');
  assert.equal(previewVideo.srcObject, null, 'failed startup disposes the real shared preview');
  assert.equal(previewVideo.paused, true);
  for (const type of ['loadedmetadata', 'loadeddata', 'playing', 'error', 'timeupdate']) assert.equal(previewVideo.count(type), 0);
  assert.equal(h.elements.cameraResume.count('click'), 0);
  assert.equal(h.runtime.snapshot().arBusy, false);
  assert.equal(h.elements.status.classList.contains('hidden'), false, 'startup failure remains visible');
  assert.match(h.elements.status.textContent, /mock initialization failure/);
  assert.equal(h.elements.cameraResume.hidden, true);
  assert.deepEqual(h.urls.revoked, ['blob:node-test-mind']);
  return { ...resources.summary(), stoppedTracks: h.track.stops, rendererDisposals: 1 };
});

await test('ARSession forwards bound resize while healthy and no-ops after failure', async () => {
  const h = makeRuntime();
  h.control.arError = new Error('mock initialization failure after start');
  let normalResizeForwarded = false;
  h.control.onARStart = mindar => {
    const before = mindar.resizeCalls;
    h.window.dispatch('resize');
    normalResizeForwarded = mindar.resizeCalls === before + 1;
  };
  await h.runtime.startAR();
  const mindar = h.mindars[0];
  assert.equal(normalResizeForwarded, true, 'healthy subclass forwards to MindARThree.resize');
  assert.equal(mindar.controller.stops, 1);
  assert.equal(mindar.renderer.disposeCount, 1);
  const afterFailure = mindar.resizeCalls;
  assert.equal(h.window.count('resize'), 1, 'vendor anonymous bound listener remains attached');
  h.window.dispatch('resize');
  assert.equal(mindar.resizeCalls, afterFailure,
    'late bound resize reaches the subclass guard without touching disposed renderer state');
  return { forwardedWhileHealthy: normalResizeForwarded, noOpAfterFailure: true,
    retainedBoundListeners: h.window.count('resize'), baseResizeCalls: mindar.resizeCalls };
});

await test('startAR full-input pose follower snaps, smooths, reacquires, and hides stale poses', async () => {
  const h = makeRuntime('?tracking=full');
  await h.runtime.startAR();
  const mindar = h.mindars[0], anchorRoot = mindar.anchor.group;
  const visualRoot = mindar.scene.getObjectByName('ar-visual-root');
  const group = visualRoot.children[0], previewVideo = h.document.created.find(node => node.tagName === 'VIDEO');
  assert.equal(mindar.video, previewVideo, '?tracking=full gives MindAR the actual video without a proxy canvas');
  assert.equal(mindar.controller.input, previewVideo);
  assert.deepEqual([mindar.controller.inputWidth, mindar.controller.inputHeight], [1280, 720]);
  assert.equal(h.document.created.filter(node => node.tagName === 'VIDEO').length, 1);
  assert.equal(h.raf.pending.size, 0, 'full-resolution tracking still adds no rAF loop');

  const first = { position: new THREE.Vector3(0.25, -0.1, 1.4), rotation: new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0.1, -0.2, 0.35)), scale: 1.4 };
  anchorRoot.matrix.copy(rigidMatrix(first.position.x, first.position.y, first.position.z,
    0.1, -0.2, 0.35, first.scale));
  anchorRoot.visible = true;
  mindar.anchor.onTargetFound();
  mindar.anchor.onTargetUpdate();
  assert.equal(visualRoot.visible, true);
  assert.equal(group.visible, true);
  nearVector(visualRoot.position, first.position.toArray(), 1e-9, 'first raw pose snaps position');
  nearVector(visualRoot.quaternion, first.rotation.toArray(), 1e-9, 'first raw pose snaps rotation');
  near(visualRoot.scale.x, first.scale, 1e-9, 'first raw pose snaps uniform scale');
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 1);
  const expectedArtOrigin = new THREE.Vector3(0, 0, 0.01 * first.scale)
    .applyQuaternion(first.rotation).add(first.position);
  nearVector(group.getWorldPosition(new THREE.Vector3()), expectedArtOrigin.toArray(), 1e-9,
    'the art receives the raw pose once plus its paper-plane offset');

  const planeBeforeMove = meshWithMap(group, 'bus').material.clippingPlanes[0].constant;
  const second = new THREE.Vector3(1.05, -0.1, 1.4);
  anchorRoot.matrix.copy(rigidMatrix(second.x, second.y, second.z, 0.1, -0.2, 0.35, first.scale));
  nearVector(visualRoot.position, first.position.toArray(), 1e-9,
    'changing the raw anchor matrix alone does not move the sibling visual root');
  mindar.anchor.onTargetUpdate();
  nearVector(visualRoot.position, first.position.toArray(), 1e-9,
    'a later pose sample updates the target but waits for a render step');
  h.raf.advance(16);
  mindar.renderer.loop();
  assert.ok(visualRoot.position.x > first.position.x && visualRoot.position.x < second.x,
    'the next render advances toward the newly sampled pose');
  assert.ok(meshWithMap(group, 'bus').material.clippingPlanes[0].constant !== planeBeforeMove,
    'render updates world clipping planes with the visual-root transform');
  const currentPosition = visualRoot.position.clone();

  anchorRoot.visible = false;
  mindar.anchor.onTargetLost();
  assert.equal(visualRoot.visible, false);
  assert.equal(group.visible, false);
  anchorRoot.matrix.copy(rigidMatrix(-0.6, 0.3, 2.2, -0.2, 0.15, -0.4, 0.9));
  anchorRoot.visible = true;
  mindar.anchor.onTargetFound();
  mindar.anchor.onTargetUpdate();
  nearVector(visualRoot.position, [-0.6, 0.3, 2.2], 1e-9,
    'reacquisition snaps directly to its first newly accepted pose');
  near(visualRoot.scale.x, 0.9, 1e-9, 'reacquisition also snaps scale');
  assert.equal(visualRoot.visible, true);
  assert.notDeepEqual(visualRoot.position.toArray(), currentPosition.toArray());
  const rendersBeforeStale = mindar.renderer.renderCount;
  h.raf.advance(401);
  mindar.renderer.loop();
  assert.equal(visualRoot.visible, false, 'pose older than 400ms is reset and hidden');
  assert.equal(group.visible, false);
  assert.equal(mindar.renderer.renderCount, rendersBeforeStale, 'stale pose is never rendered');
  assert.equal(h.track.stops, 0, 'pose loss does not stop the shared camera');
  return { trackingInput: 'actual preview video, 1280x720', firstSample: 'snap',
    laterSample: 'target-only until render', reacquisition: 'snap', staleAfterMs: 401,
    rawAndVisualRootsAreSiblings: true, renderCount: mindar.renderer.renderCount };
});

await test('startAR ignores an old pose callback until controller tracking resumes', async () => {
  const h = makeRuntime('?tracking=full');
  await h.runtime.startAR();
  const mindar = h.mindars[0], anchorRoot = mindar.anchor.group;
  const visualRoot = mindar.scene.getObjectByName('ar-visual-root'), group = visualRoot.children[0];
  const tracking = mindar.controller.trackingStates[0];
  assert.ok(tracking);
  assert.equal(tracking.isTracking, true);
  const oldPose = rigidMatrix(0.3, -0.15, 1.7, 0.1, -0.2, 0.25, 1.1);
  anchorRoot.matrix.copy(oldPose);
  anchorRoot.visible = true;
  mindar.anchor.onTargetFound();
  mindar.anchor.onTargetUpdate();
  nearVector(visualRoot.position, [0.3, -0.15, 1.7], 1e-9, 'valid pose is accepted');
  mindar.renderer.loop();
  assert.equal(mindar.renderer.renderCount, 1);

  h.raf.advance(401);
  mindar.renderer.loop();
  assert.equal(visualRoot.visible, false, 'the valid sample becomes stale and hides');
  assert.equal(group.visible, false);
  const renderCount = mindar.renderer.renderCount;
  tracking.isTracking = false;
  mindar.anchor.onTargetUpdate(); // The vendor may report the previous matrix during missTolerance.
  assert.equal(visualRoot.visible, false, 'isTracking=false cannot revive the old matrix');
  assert.equal(group.visible, false);
  assert.equal(mindar.renderer.renderCount, renderCount);

  tracking.isTracking = true;
  const fresh = rigidMatrix(-0.55, 0.28, 2.1, -0.12, 0.18, -0.4, 0.85);
  anchorRoot.matrix.copy(fresh);
  mindar.anchor.onTargetUpdate();
  nearVector(visualRoot.position, [-0.55, 0.28, 2.1], 1e-9,
    'a new sample after tracking resumes snaps from the reset state');
  assert.equal(visualRoot.visible, true);
  assert.equal(group.visible, true);
  assert.equal(h.track.stops, 0, 'miss tolerance does not stop the camera stream');
  return { staleAfterMs: 401, falseTrackingOldSampleIgnored: true, trueTrackingFreshSampleSnaps: true,
    renderCount, controllerTrackingState: tracking.isTracking };
});

await test('enterVR / exitVR three real-art cycles cancel rAF, remove per-scene listeners and dispose', async () => {
  const h = makeRuntime(), cycles = [];
  const originalChildren = [...h.elements.vrRoot.children];
  for (let cycle = 1; cycle <= 3; cycle++) {
    await h.runtime.enterVR(false);
    assert.equal(h.musicCalls.at(-1)?.[0], 'enter');
    assert.equal(h.musicCalls.at(-1)?.[1], true, 'manual VR entry carries a gesture');
    const snapshot = h.runtime.snapshot(), state = snapshot.vrState;
    assert.ok(snapshot.vrActive && snapshot.vrBusy && state);
    assert.equal(h.renderers.length, cycle);
    assert.equal(h.window.count('resize'), 1);
    assert.equal(h.document.count('visibilitychange'), 1);
    assert.equal(h.raf.pending.size, 1);
    assert.ok(state.art.group.getObjectByName('vr-sky'));
    assert.equal(state.art.group.getObjectByName('ar-backdrop'), undefined);
    assert.equal(state.renderer.getPixelRatio(), 1.5);
    assert.equal(state.renderer.domElement.parentNode, h.elements.vrRoot);
    const resources = watchResources(state.art.group, Object.values(h.tex));
    let monitorDisposals = 0;
    const disposeMonitor = state.monitor.dispose.bind(state.monitor);
    state.monitor.dispose = () => { monitorDisposals += 1; disposeMonitor(); };
    const times = [], animate = state.art.animate;
    state.art.animate = time => { times.push({ now: h.raf.now, t: time }); animate(time); };
    await h.runtime.enterVR(false);
    assert.equal(h.renderers.length, cycle, 'busy entry cannot allocate a second renderer');
    h.elements.vrRoot.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    h.elements.vrRoot.dispatch('pointermove', { clientX: 150, clientY: 80 });
    h.window.dispatch('pointerup');
    near(h.runtime.snapshot().yawT, 0.2);
    near(h.runtime.snapshot().pitchT, 0.06);
    h.window.dispatch('deviceorientation', { alpha: 15 });
    h.window.dispatch('deviceorientation', { alpha: 25 });
    assert.ok(h.runtime.snapshot().gyroOff < 0);
    h.raf.advance(1000 / 60); h.raf.advance(1000 / 60);
    assert.equal(state.renderer.renderCount, 2);
    assert.ok(Number.isFinite(state.camera.position.x));
    h.runtime.viewport(844, 390); h.window.dispatch('resize');
    assert.deepEqual(state.renderer.sizes.at(-1), [844, 390]);
    near(state.camera.aspect, 844 / 390);
    const hiddenFrame = state.frame;
    h.document.hidden = true; h.document.dispatch('visibilitychange');
    assert.ok(h.raf.cancelled.includes(hiddenFrame));
    assert.equal(state.frame, 0);
    assert.equal(h.raf.pending.size, 0);
    const beforeHidden = times.at(-1).t;
    h.raf.advance(5000);
    assert.equal(times.at(-1).t, beforeHidden);
    h.document.hidden = false; h.document.dispatch('visibilitychange');
    assert.equal(h.raf.pending.size, 1);
    h.document.dispatch('visibilitychange');
    assert.equal(h.raf.pending.size, 1, 'repeated visible events still leave exactly one frame');
    h.raf.advance(1000 / 60, 'omit');
    near(times.at(-1).t - beforeHidden, 1 / 60, 1e-10, 'resume resets previous timestamp');
    const beforeGap = times.at(-1).t;
    h.raf.advance(5000);
    near(times.at(-1).t - beforeGap, 5, 1e-10, 'visible animation follows elapsed time');
    near(h.runtime.dampingInputs.at(-1), 0.1, 1e-12, 'only camera damping clamps the large dt');
    const pendingFrame = state.frame, staleTick = h.raf.pending.get(pendingFrame);
    const resizeCallback = h.window.added.filter(item => item.type === 'resize').at(-1).callback;
    const visibilityCallback = h.document.added.filter(item => item.type === 'visibilitychange').at(-1).callback;
    const renders = state.renderer.renderCount;
    // Exercise real exit-button wiring for one of the cycles as well.
    if (cycle === 2) h.elements.vrExit.dispatch('click'); else h.runtime.exitVR();
    assert.equal(h.runtime.snapshot().vrState, null);
    assert.equal(h.runtime.snapshot().vrActive, false);
    assert.equal(h.runtime.snapshot().vrBusy, false);
    assert.equal(h.raf.pending.size, 0);
    assert.ok(h.raf.cancelled.includes(pendingFrame));
    assert.equal(h.window.count('resize'), 0);
    assert.equal(h.document.count('visibilitychange'), 0);
    assert.ok(h.window.removed.some(item => item.callback === resizeCallback && item.matched));
    assert.ok(h.document.removed.some(item => item.callback === visibilityCallback && item.matched));
    assert.equal(state.renderer.disposeCount, 1);
    assert.equal(state.renderer.domElement.removeCount, 1);
    assert.equal(state.renderer.domElement.parentNode, null);
    assert.equal(monitorDisposals, 1);
    resources.assertReleased();
    staleTick(h.raf.now + 16);
    resizeCallback(); visibilityCallback(); // Late callbacks cannot revive an exited state.
    assert.equal(state.renderer.renderCount, renders);
    assert.equal(h.raf.pending.size, 0);
    h.runtime.exitVR(); // Idempotent at the lifecycle level: no second resource disposal.
    resources.assertReleased();
    assert.equal(state.renderer.disposeCount, 1);
    assert.deepEqual(h.elements.vrRoot.children, originalChildren);
    assert.equal(h.elements.vrRoot.style.display, 'none');
    assert.equal(h.elements.splash.style.display, 'flex');
    assert.equal(h.elements.status.classList.contains('hidden'), true);
    // Global controls intentionally persist once, not once per entry.
    for (const type of ['pointerup', 'pointercancel', 'deviceorientation']) assert.equal(h.window.count(type), 1);
    for (const type of ['pointerdown', 'pointermove']) assert.equal(h.elements.vrRoot.count(type), 1);
    cycles.push({ cycle, renders, resources: resources.summary(), frameSamples: times });
  }
  return { cycles, persistentGlobalListeners: 'one each; no per-entry accumulation' };
});

await test('VR bus and wheels follow visible loop time at 60Hz and sparse rAF; damping stays clamped', async () => {
  const h = makeRuntime();
  await h.runtime.enterVR(false);
  const state = h.runtime.snapshot().vrState, busGroup = meshWithMap(state.art.group, 'bus').parent;
  const wheelFaces = busGroup.children.slice(1).map(wheel => wheel.children[1]);
  const loop = createBusLoop(meta), animate = state.art.animate, samples = [];
  let t = 0;
  state.art.animate = time => { t = time; animate(time); };
  for (let frame = 1; frame <= 540; frame++) {
    h.raf.advance(1000 / 60);
    const elapsed = Math.max(0, t - 0.9), expected = loop.sample(elapsed);
    near(busGroup.position.x, expected.x, 1e-9, `60Hz bus x at frame ${frame}`);
    wheelFaces.forEach((wheel, index) => near(wheel.rotation.z, expected.angle, 1e-9,
      `60Hz wheel ${index} angle at frame ${frame}`));
    if ([1, 54, 240, 270, 444, 450, 540].includes(frame)) {
      samples.push({ frame, now: h.raf.now, t, busX: busGroup.position.x, wheelAngle: wheelFaces[0].rotation.z });
    }
    assert.equal(h.raf.pending.size, 1);
    if (frame === 270) {
      const paused = { t, x: busGroup.position.x, angle: wheelFaces[0].rotation.z };
      h.document.hidden = true; h.document.dispatch('visibilitychange');
      assert.equal(h.raf.pending.size, 0);
      h.raf.advance(5000);
      near(t, paused.t, 1e-12, 'hidden time is excluded from animation');
      near(busGroup.position.x, paused.x, 1e-12, 'bus position holds while hidden');
      near(wheelFaces[0].rotation.z, paused.angle, 1e-12, 'wheel rotation holds while hidden');
      h.document.hidden = false; h.document.dispatch('visibilitychange');
      assert.equal(h.raf.pending.size, 1, 'visible return schedules one fresh frame');
    }
  }
  near(t, 9, 1e-9);
  const expectedAtNine = loop.sample(Math.max(0, t - 0.9));
  near(busGroup.position.x, expectedAtNine.x, 1e-9);
  near(wheelFaces[0].rotation.z, expectedAtNine.angle, 1e-9);
  near(busGroup.position.z, -0.04, 1e-12, 'VR bus depth remains unchanged');
  assert.notEqual(busGroup.position.x, 0, 'the complete loop does not park after its first pass');
  assert.ok(samples.find(sample => sample.frame === 450).busX !== 0);
  h.runtime.exitVR();

  const slow = makeRuntime();
  await slow.runtime.enterVR(false);
  const slowState = slow.runtime.snapshot().vrState, slowBus = meshWithMap(slowState.art.group, 'bus').parent;
  const slowWheels = slowBus.children.slice(1).map(wheel => wheel.children[1]);
  const slowAnimate = slowState.art.animate;
  let slowT = 0;
  const sparseSamples = [];
  slowState.art.animate = time => { slowT = time; slowAnimate(time); };
  for (let frame = 0; frame < 9; frame++) {
    // Missing and untrustworthy callback arguments must not affect performance.now().
    const timestamp = frame % 2 ? -12345 : 'omit';
    slow.raf.advance(1000, timestamp);
    const expected = loop.sample(Math.max(0, slowT - 0.9));
    near(slowBus.position.x, expected.x, 1e-9, `sparse bus x at callback ${frame + 1}`);
    slowWheels.forEach((wheel, index) => near(wheel.rotation.z, expected.angle, 1e-9,
      `sparse wheel ${index} angle at callback ${frame + 1}`));
    sparseSamples.push({ callback: frame + 1, performanceNow: slow.raf.now,
      callbackTimestamp: timestamp, t: slowT, busX: slowBus.position.x, wheelAngle: slowWheels[0].rotation.z });
  }
  near(slowT, 1 / 60 + 8);
  near(slowBus.position.z, -0.04, 1e-12, 'sparse VR bus depth remains unchanged');
  assert.ok(slow.runtime.dampingInputs.every(dt => dt >= 0 && dt <= 0.1));
  near(slow.runtime.dampingInputs.at(-1), 0.1);
  const sparse = { callbacks: 9, wallClockMs: slow.raf.now, animationSeconds: slowT,
    busX: slowBus.position.x, wheelAngle: slowWheels[0].rotation.z, samples: sparseSamples,
    dampingMaxDt: Math.max(...slow.runtime.dampingInputs) };
  slow.runtime.exitVR();
  return { normal60Hz: samples, sparse,
    boundary: 'AR/VR bus samples use explicit startDriveIn offsets; elapsed visible time drives position and unwrapped wheel angle, camera damping alone clamps at 0.1s' };
});

for (const stage of ['three', 'assets']) {
  for (const settlement of ['resolve', 'reject']) {
    await test(`exitVR cancels pending ${stage} (${settlement}) without resurrection`, async () => {
      const h = makeRuntime(), gate = deferred(), started = deferred();
      h.loading[stage] = () => { started.resolve(); return gate.promise; };
      const entry = h.runtime.enterVR(false);
      await started.promise;
      assert.equal(h.runtime.snapshot().vrBusy, true);
      assert.equal(h.runtime.snapshot().vrState, null);
      h.runtime.exitVR();
      if (settlement === 'resolve') gate.resolve(); else gate.reject(new Error('late ' + stage + ' failure'));
      await entry;
      const snapshot = h.runtime.snapshot();
      assert.equal(snapshot.vrState, null);
      assert.equal(snapshot.vrActive, false);
      assert.equal(snapshot.vrBusy, false);
      assert.equal(h.renderers.length, 0);
      assert.equal(h.raf.pending.size, 0);
      assert.equal(h.window.count('resize'), 0);
      assert.equal(h.document.count('visibilitychange'), 0);
      assert.equal(h.elements.vrRoot.style.display, 'none');
      assert.equal(h.elements.splash.style.display, 'flex');
      assert.equal(h.elements.status.classList.contains('hidden'), true);
      if (stage === 'three') assert.equal(h.loading.assetCalls, 0, 'cancel before assets must not start them');
      return { stage, settlement, rendererAllocations: 0, pendingFrames: 0 };
    });
  }
}
for (const settlement of ['resolve', 'reject']) {
  await test(`stale pending entry (${settlement}) cannot replace or close a newer active VR`, async () => {
    const h = makeRuntime(), gate = deferred(), started = deferred();
    let calls = 0;
    h.loading.assets = () => { calls += 1; if (calls === 1) { started.resolve(); return gate.promise; } return Promise.resolve(); };
    const oldEntry = h.runtime.enterVR(false);
    await started.promise;
    h.runtime.exitVR();
    await h.runtime.enterVR(false);
    const state = h.runtime.snapshot().vrState;
    assert.ok(state);
    if (settlement === 'resolve') gate.resolve(); else gate.reject(new Error('obsolete asset failure'));
    await oldEntry;
    assert.equal(h.runtime.snapshot().vrState, state);
    assert.equal(h.runtime.snapshot().vrActive, true);
    assert.equal(h.runtime.snapshot().vrBusy, true);
    assert.equal(h.renderers.length, 1);
    assert.equal(h.raf.pending.size, 1);
    h.raf.advance(1000 / 60);
    assert.equal(state.renderer.renderCount, 1);
    const resources = watchResources(state.art.group, Object.values(h.tex));
    h.runtime.exitVR();
    resources.assertReleased();
    assert.equal(h.raf.pending.size, 0);
    return { settlement, newerStateSurvived: true, rendererAllocations: 1 };
  });
}

const failed = results.filter(result => !result.passed).length;
console.log(JSON.stringify({ passed: failed === 0, total: results.length,
  passedTests: results.length - failed, failedTests: failed, version: meta.version,
  index: path.join(root, 'index.html'), tests: results,
  boundaries: [
    'No browser, network, real camera, WebGL context, shader compilation, GPU timing, pixels, or visual registration tested.',
    'Canvas is a minimal call recorder. Opacity checks cover actual THREE material/texture, opaque CSS stops, full fill, and globalAlpha, not rendered pixels.',
    'Instancing executes vendored THREE WebGL1/2 dispatch against fake GL plus real buffers; it is not a hardware draw-call capture.',
    'Frame-monitor time, rAF, timers, DOM events, renderer, asset gates and MindAR startup are deterministic mocks; debug is false.',
    'VR cancellation invalidates requests and prevents resurrection; it does not abort the shared asset download itself.',
    'Persistent global pointer/orientation handlers remain once by design; per-scene resize/visibility handlers are removed.',
    'AR preview/proxy input, sibling pose-root sampling/rendering, loss/reacquisition/stale hiding, and startup-failure teardown use deterministic mocks; no successful-session exitAR API or real recognition is exercised.',
    'VR animation uses elapsed performance.now time; first/resumed frame uses 1/60s, hidden time is excluded, and the 8s bus loop continues with unwrapped wheel travel. Camera damping alone clamps at 0.1s.'
  ] }, null, 2));
if (failed) process.exitCode = 1;
