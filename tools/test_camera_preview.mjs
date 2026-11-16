// Node-only checks of the real helper; fake media/DOM/clock, NOT browser acceptance.
// Run anywhere: node C:/Users/amst/blackbird-ar/tools/test_camera_preview.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replaceAll('\r\n', '\n');
const start = html.indexOf('function createCameraPreview('), end = html.indexOf('\n}\n', start);
assert.ok(start >= 0 && end > start, 'real top-level createCameraPreview exists');
const source = html.slice(start, end + 2), events = ['loadedmetadata', 'loadeddata', 'playing', 'error', 'timeupdate'];
const namedError = name => Object.assign(new Error(name), { name });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let clicking = false; // Records synchronous fake click dispatch, not browser user activation.
class Element {
  constructor(tag) {
    Object.assign(this, { tagName: tag.toUpperCase(), style: {}, attributes: new Map(), listeners: new Map(),
      children: [], parentNode: null, hidden: false, disabled: false, removeCount: 0, textContent: '' });
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  addEventListener(type, fn, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Map());
    this.listeners.get(type).set(fn, Boolean(options?.once));
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type) {
    for (const [fn, once] of [...(this.listeners.get(type) || [])]) {
      if (!this.listeners.get(type)?.has(fn)) continue;
      if (once) this.removeEventListener(type, fn);
      fn.call(this, { type, target: this });
    }
  }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); } // No muted-property reflection.
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() { this.removeCount++; if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  click() {
    if (this.hidden || this.disabled) return;
    clicking = true; try { this.dispatch('click'); } finally { clicking = false; }
  }
}
class Media extends Element { // Minimal fake audio/video; real background-music tests stay separate.
  constructor(tag, plans = [], trace = []) {
    super(tag);
    Object.assign(this, { plans: [...plans], trace, assignments: [], paused: true, readyState: 0,
      videoWidth: 0, videoHeight: 0, muted: false, defaultMuted: false, autoplay: false,
      playsInline: false, error: null, playCalls: 0, pauseCalls: 0, _srcObject: null });
  }
  addEventListener(type, fn, options) { this.trace.push('listen:' + type); super.addEventListener(type, fn, options); }
  set srcObject(value) { this.assignments.push(value); this.trace.push(value ? 'src' : 'clear'); this._srcObject = value; }
  get srcObject() { return this._srcObject; }
  frame(fields = {}) { Object.assign(this, { paused: false, readyState: 2, videoWidth: 1280, videoHeight: 720 }, fields); }
  play() {
    this.playCalls++; this.trace.push('play');
    assert.ok(this.parentNode, 'video must be mounted before play');
    if (this.plans.length) return this.plans.shift()(this);
    this.frame(); for (const type of ['loadedmetadata', 'loadeddata', 'playing']) this.dispatch(type);
    return Promise.resolve();
  }
  pause() { this.pauseCalls++; this.paused = true; }
}
function clock() {
  let now = 0, next = 1;
  const jobs = new Map();
  return { jobs, setTimeout(fn, ms) { const id = next++; jobs.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => jobs.delete(id), advance(ms) {
      const target = now + ms;
      for (;;) {
        const first = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
        if (!first || first[1].at > target) break;
        now = first[1].at; jobs.delete(first[0]); first[1].fn();
      }
      now = target;
    } };
}
function make(plans = []) {
  const time = clock(), trace = [], video = new Media('video', plans, trace), audio = new Media('audio');
  const container = new Element('div'), button = new Element('button'), status = new Element('div'), failures = [];
  button.id = 'cameraResume'; button.hidden = true; status.classList.add('hidden');
  const document = { hidden: false, getElementById: id => ({ cameraResume: button, status, backgroundMusic: audio })[id] || null,
    createElement: tag => { assert.equal(tag, 'video', 'preview creates only its one video'); return video; } };
  const navigator = { mediaDevices: { getUserMedia: () => assert.fail('preview must not request another stream') } };
  const create = new Function('document', 'navigator', 'setTimeout', 'clearTimeout', source + '\nreturn createCameraPreview;')
    (document, navigator, time.setTimeout, time.clearTimeout);
  const track = { stops: 0, stop() { this.stops++; } }, stream = { getTracks: () => [track] };
  const preview = create(stream, container, error => failures.push(error));
  const h = { time, trace, video, audio, container, button, document, preview, stream, track, failures, state: 'pending' };
  preview.ready.then(value => { h.state = 'fulfilled'; h.value = value; }, error => { h.state = 'rejected'; h.error = error; });
  return h;
}
async function ready(h) { await flush(); assert.equal(h.state, 'fulfilled', h.error?.message || 'first frame should be ready'); }
function clean(h) {
  h.preview.dispose(); h.preview.dispose();
  assert.equal(h.video.srcObject, null); assert.equal(h.video.parentNode, null);
  assert.equal(h.video.paused, true); assert.equal(h.video.pauseCalls, 1); assert.equal(h.video.removeCount, 1);
  assert.equal(h.video.count(), 0); assert.equal(h.button.count(), 0); assert.equal(h.time.jobs.size, 0);
  assert.equal(h.button.hidden, true); assert.equal(h.audio.playCalls, 0); assert.equal(h.track.stops, 0);
}
const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { const detail = String(error.stack || error).split('\n').slice(0, 7).join('\n');
    results.push({ name, passed: false, error: detail }); console.error('FAIL ' + name + '\n' + detail); }
}
await test('mounts and configures one video; listens before srcObject and play', async () => {
  const h = make();
  assert.equal(h.preview.video, h.video); assert.equal(h.video.parentNode, h.container);
  for (const name of ['autoplay', 'muted', 'defaultMuted', 'playsInline']) assert.equal(h.video[name], true, name);
  for (const name of ['autoplay', 'muted', 'playsinline', 'webkit-playsinline']) assert.ok(h.video.hasAttribute(name), name);
  assert.match(String(h.video.style.zIndex ?? h.video.style.cssText), /(?:^0$|z-index:\s*0(?:;|$))/);
  for (const type of events) assert.ok(h.trace.indexOf('listen:' + type) >= 0 && h.trace.indexOf('listen:' + type) < h.trace.indexOf('src'), type);
  assert.ok(h.trace.indexOf('src') < h.trace.indexOf('play'));
  assert.deepEqual(h.video.assignments, [h.stream]); await ready(h);
  assert.equal(h.time.jobs.size, 0); assert.equal(h.failures.length, 0); clean(h);
});
await test('metadata alone is not a first frame', async () => {
  const h = make([() => Promise.resolve()]);
  h.video.frame({ readyState: 1 }); h.video.dispatch('loadedmetadata'); await flush();
  assert.equal(h.state, 'pending'); h.video.readyState = 2; h.video.dispatch('loadeddata');
  await ready(h); clean(h);
});
await test('frame events cannot resolve ready before play promise succeeds', async () => {
  const gate = deferred(), h = make([() => gate.promise]);
  h.video.frame(); for (const type of ['loadedmetadata', 'loadeddata', 'playing', 'timeupdate']) h.video.dispatch(type);
  await flush(); assert.equal(h.state, 'pending'); gate.resolve(); await ready(h); clean(h);
});
for (const fields of [{ readyState: 1 }, { paused: true }, { videoWidth: 0 }, { videoHeight: 0 }]) {
  await test('ready requires valid frame state ' + JSON.stringify(fields), async () => {
    const h = make([video => { video.frame(fields); return Promise.resolve(); }]);
    for (const type of ['loadedmetadata', 'loadeddata', 'playing', 'timeupdate']) h.video.dispatch(type);
    await flush(); assert.equal(h.state, 'pending'); h.video.frame(); h.video.dispatch('timeupdate');
    await ready(h); clean(h);
  });
}
await test('NotAllowedError stays pending; DOM click retries play on the same stream', async () => {
  const gate = deferred(), h = make([() => Promise.reject(namedError('NotAllowedError')),
    video => { assert.equal(clicking, true, 'play is synchronous in the button listener'); video.frame(); return gate.promise; }]);
  await flush(); assert.equal(h.state, 'pending'); assert.equal(h.button.hidden, false); assert.equal(h.button.disabled, false);
  h.button.click(); assert.equal(h.video.playCalls, 2); await flush(); assert.equal(h.state, 'pending');
  gate.resolve(); await ready(h); assert.equal(h.button.hidden, true);
  assert.deepEqual(h.video.assignments, [h.stream]); assert.equal(h.failures.length, 0); clean(h);
});
await test('repeated policy denial leaves the retry button usable', async () => {
  const deny = () => Promise.reject(namedError('NotAllowedError')), h = make([deny, deny]);
  await flush(); h.button.click(); await flush(); assert.equal(h.state, 'pending');
  assert.equal(h.button.hidden, false); assert.equal(h.button.disabled, false);
  h.button.click(); await ready(h); assert.equal(h.video.playCalls, 3); clean(h);
});
for (const kind of ['reject', 'throw', 'media']) {
  await test('initial ' + kind + ' failure rejects ready, not onFailure', async () => {
    const error = namedError('NotSupportedError'), gate = deferred();
    const h = make([() => { if (kind === 'throw') throw error; return kind === 'reject' ? Promise.reject(error) : gate.promise; }]);
    if (kind === 'media') { h.video.error = { code: 3, message: 'decode failure' }; h.video.dispatch('error'); }
    await flush(); assert.equal(h.state, 'rejected'); assert.ok(h.error instanceof Error);
    if (kind !== 'media') assert.ok(h.error.message.includes(error.message), 'play error remains diagnosable');
    assert.equal(h.failures.length, 0); clean(h); gate.resolve(); await flush(); assert.equal(h.state, 'rejected');
  });
}
for (const policy of [false, true]) {
  await test(policy ? 'policy manual wait is exempt; clicking starts a fresh 20-second first-frame timeout' : '20-second first-frame timeout', async () => {
    const h = make(policy ? [() => Promise.reject(namedError('NotAllowedError')), () => Promise.resolve()] : [() => Promise.resolve()]);
    await flush();
    if (policy) {
      h.time.advance(60000); await flush(); assert.equal(h.state, 'pending'); assert.equal(h.button.hidden, false);
      assert.equal(h.button.disabled, false); assert.equal(h.time.jobs.size, 0); assert.equal(h.failures.length, 0);
      h.button.click(); assert.equal(h.video.playCalls, 2); await flush();
    }
    h.time.advance(19999); await flush(); assert.equal(h.state, 'pending');
    h.time.advance(1); await flush(); assert.equal(h.state, 'rejected');
    assert.match(h.error.message, /超时|timeout|timed out/i); assert.equal(h.failures.length, 0); clean(h);
  });
}
await test('resume only plays paused video in a visible document, without awaiting a gesture', async () => {
  const h = make(); await ready(h); h.preview.resume(); assert.equal(h.video.playCalls, 1);
  h.video.videoWidth = 0; h.preview.resume(); assert.equal(h.video.playCalls, 1, 'already playing never replays, even with a transient missing size');
  h.video.paused = true; h.document.hidden = true; h.preview.resume(); assert.equal(h.video.playCalls, 1);
  h.document.hidden = false; h.preview.resume(); assert.equal(h.video.playCalls, 2);
  await flush(); assert.equal(h.video.paused, false); assert.deepEqual(h.video.assignments, [h.stream]); clean(h);
});
for (const kind of ['reject', 'throw', 'media', 'timeout']) {
  await test('post-ready ' + kind + ' failure reports through onFailure', async () => {
    const h = make(), error = namedError('NotReadableError'); await ready(h);
    if (kind === 'media') { h.video.error = { code: 3, message: 'later decode failure' }; h.video.dispatch('error'); }
    else { h.video.paused = true; h.video.plans.push(() => { if (kind === 'throw') throw error; return kind === 'timeout' ? Promise.resolve() : Promise.reject(error); }); h.preview.resume(); }
    await flush(); if (kind === 'timeout') { h.time.advance(20000); await flush(); }
    assert.equal(h.state, 'fulfilled'); assert.equal(h.failures.length, 1);
    assert.ok(h.failures[0] instanceof Error); if (['reject', 'throw'].includes(kind)) assert.ok(h.failures[0].message.includes(error.message)); clean(h);
  });
}
await test('post-ready policy denial offers the same DOM retry instead of fatal failure', async () => {
  const h = make(); await ready(h); h.video.paused = true;
  h.video.plans.push(() => Promise.reject(namedError('NotAllowedError'))); h.preview.resume(); await flush();
  assert.equal(h.button.hidden, false); assert.equal(h.failures.length, 0); h.button.click(); await flush();
  assert.equal(h.button.hidden, true); assert.equal(h.video.playCalls, 3); clean(h);
});
for (const settlement of ['resolve', 'reject']) {
  await test('dispose rejects pending ready with AbortError; late play ' + settlement + ' cannot revive', async () => {
    const gate = deferred(), h = make([() => gate.promise]); h.video.frame();
    const old = [...h.video.listeners].flatMap(([type, callbacks]) => [...callbacks.keys()].map(fn => () => fn({ type, target: h.video })));
    const timer = [...h.time.jobs.values()].map(job => job.fn), buttons = [...(h.button.listeners.get('click') || new Map()).keys()];
    clean(h); await flush(); assert.equal(h.state, 'rejected'); assert.equal(h.error.name, 'AbortError');
    if (settlement === 'resolve') gate.resolve(); else gate.reject(namedError('NotAllowedError'));
    for (const callback of [...old, ...timer, ...buttons]) callback(); h.preview.resume(); h.button.click(); await flush();
    assert.equal(h.error.name, 'AbortError'); assert.equal(h.failures.length, 0); assert.equal(h.video.playCalls, 1); clean(h);
  });
}
await test('disposed successful preview ignores stale events and resume', async () => {
  const h = make(); await ready(h);
  const old = [...h.video.listeners].flatMap(([type, callbacks]) => [...callbacks.keys()].map(fn => () => fn({ type, target: h.video })));
  clean(h); for (const callback of old) callback(); h.preview.resume(); await flush();
  assert.equal(h.state, 'fulfilled'); assert.equal(h.video.playCalls, 1); assert.equal(h.failures.length, 0); clean(h);
});
const failed = results.filter(result => !result.passed).length;
console.log(JSON.stringify({ passed: failed === 0, total: results.length, passedTests: results.length - failed,
  failedTests: failed, index: path.join(root, 'index.html'), tests: results,
  boundaries: ['Real helper only; media state, DOM clicks, promises and the 20s clock are controlled fakes.',
    'No browser user activation, real camera/audio/network/GPU, rendered pixels, or iOS/Android acceptance tested.'] }, null, 2));
if (failed) process.exitCode = 1;
