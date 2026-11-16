// Node-only behavioral checks of the real createBackgroundMusic function and page wiring.
// Run from any directory: node C:/Users/amst/blackbird-ar/tools/test_background_music.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replaceAll('\r\n', '\n');
function functionSource(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' exists');
  const end = html.indexOf('\n}\n', start);
  assert.notEqual(end, -1, name + ' closes at top level');
  return html.slice(start, end + 2);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function namedError(name) { return Object.assign(new Error(name), { name }); }
async function flush() { await Promise.resolve(); await Promise.resolve(); }

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, fields = {}) {
    for (const callback of [...(this.listeners.get(type) || [])]) {
      callback.call(this, { type, target: this, ...fields });
    }
  }
  count(type) { return this.listeners.get(type)?.size || 0; }
}
class FakeHTMLAudio extends FakeTarget {
  constructor() {
    super();
    this.paused = true;
    this.currentTime = 0;
    this.volume = 1;
    this.loop = false;
    this.preload = '';
    this.error = null;
    this.playCalls = this.pauseCalls = this.loadCalls = 0;
    this.plans = [];
  }
  play() {
    this.playCalls += 1;
    const plan = this.plans.shift();
    if (!plan) { this.paused = false; return Promise.resolve(); }
    if (plan.kind === 'throw') throw plan.error;
    if (plan.kind === 'pending') return plan.gate.promise;
    if (plan.kind === 'reject') return Promise.reject(plan.error);
    if (plan.kind === 'resolve') { this.paused = false; return Promise.resolve(); }
    assert.fail('unknown fake play plan: ' + plan.kind);
  }
  pause() {
    const wasPlaying = !this.paused;
    this.pauseCalls += 1;
    this.paused = true;
    if (wasPlaying) this.dispatch('pause');
  }
  load() { this.loadCalls += 1; this.error = null; }
  queue(plan) { this.plans.push(plan); }
}
function makeMusic(hidden = false) {
  const document = new FakeTarget(), window = new FakeTarget();
  document.hidden = hidden;
  const audio = new FakeHTMLAudio();
  const button = new FakeTarget();
  button.dataset = {};
  button.attributes = new Map();
  button.textContent = '';
  button.setAttribute = (name, value) => button.attributes.set(name, value);
  const note = { textContent: '' };
  const create = new Function('document', 'window', functionSource('createBackgroundMusic')
    + '\nreturn createBackgroundMusic;')(document, window);
  const music = create(audio, button, note);
  return { document, window, audio, button, note, music };
}

const results = [];
async function test(name, run) {
  try { results.push({ name, passed: true, ...await run() }); }
  catch (error) {
    const stack = String(error.stack || error).split('\n').slice(0, 6).join('\n');
    results.push({ name, passed: false, error: stack });
    console.error('FAIL ' + name + '\n' + stack);
  }
}

await test('one lazy player, initial UI, markup and shared entry wiring', () => {
  const version = /const ART_VERSION = '(\d+)';/.exec(html);
  assert.ok(version, 'ART_VERSION exists');
  assert.equal((html.match(/const music = createBackgroundMusic\(/g) || []).length, 1,
    'the page creates one reusable player');
  assert.ok(html.includes(`<audio id="backgroundMusic" src="./assets/audio/bye-bye-blackbird.mp3?v=${version[1]}"`));
  assert.match(html, /<span id="musicNote"/);
  assert.match(html, /<button id="musicToggle"/);
  assert.match(html, /if \(arBusy \|\| vrBusy \|\| entryMode\) return;/);
  assert.match(html, /if \(vrBusy \|\| arBusy \|\| entryMode === 'AR'\) return;/);
  assert.match(html, /music\.enter\(true\)/);
  assert.match(html, /music\.enter\(false\)/);
  assert.match(html, /music\.enter\(!auto\)/);
  assert.match(html, /if \(wantsVR\) \{\s*enterVR\(true\);/);
  assert.match(html, /const backToSplash = \(\) => \{\s*entryMode = null;\s*music\.stop\(\);/);

  const h = makeMusic();
  assert.equal(h.audio.preload, 'none');
  assert.equal(h.audio.playCalls, 0, 'construction does not start playback or fetch audio');
  assert.equal(h.audio.volume, 0.35);
  assert.equal(h.audio.loop, true);
  assert.equal(h.button.dataset.state, 'idle');
  assert.equal(h.document.count('visibilitychange'), 1);
  assert.equal(h.window.count('pagehide'), 1);
  assert.equal(h.window.count('pageshow'), 1);
  assert.equal(h.button.count('click'), 1);
  h.music.enter(true);
  h.music.enter(true);
  assert.equal(h.audio.playCalls, 1, 'repeated entry uses the existing player and active playback');
  assert.equal(h.document.count('visibilitychange'), 1, 'entry adds no duplicate listeners');
  return { version: version[1], preload: h.audio.preload, volume: h.audio.volume,
    loop: h.audio.loop, playCallsAfterRepeatedEntry: h.audio.playCalls, onePlayer: true };
});

await test('gesture entry calls play synchronously without awaiting and deduplicates pending play', async () => {
  const h = makeMusic(), gate = deferred();
  h.audio.queue({ kind: 'pending', gate });
  const result = h.music.enter(true);
  assert.equal(result, undefined, 'enter does not return or await the play promise');
  assert.equal(h.audio.playCalls, 1);
  assert.equal(h.button.dataset.state, 'loading');
  h.music.enter(true);
  assert.equal(h.audio.playCalls, 1, 'pending playback is not requested twice');
  h.audio.paused = false;
  gate.resolve();
  await flush();
  assert.equal(h.button.dataset.state, 'playing');
  return { playCalls: h.audio.playCalls, returnedPromise: false, settledState: h.button.dataset.state };
});

await test('URL-driven auto VR entry stays silent until an explicit button gesture', async () => {
  const h = makeMusic();
  h.music.enter(false); // enterVR(true) calls music.enter(!auto).
  await flush();
  assert.equal(h.audio.playCalls, 0);
  assert.equal(h.button.dataset.state, 'idle');
  h.button.dispatch('click');
  await flush();
  assert.equal(h.audio.playCalls, 1);
  assert.equal(h.button.dataset.state, 'playing');
  return { autoEntryPlayCalls: 0, explicitGesturePlayCalls: h.audio.playCalls };
});

await test('NotAllowed rejection or synchronous denial stays inside music UI', async () => {
  for (const kind of ['reject', 'throw']) {
    const h = makeMusic(), error = namedError('NotAllowedError');
    h.audio.queue(kind === 'reject' ? { kind, error } : { kind, error });
    assert.doesNotThrow(() => h.music.enter(true), 'AR entry must not receive the play failure');
    await flush();
    assert.equal(h.button.dataset.state, 'blocked');
    assert.match(h.note.textContent, /点按一次/);
  }
  return { denialForms: ['promise rejection', 'synchronous throw'], propagatedToAR: false };
});

await test('resource/download failure is recoverable with a user-triggered retry', async () => {
  const h = makeMusic();
  h.audio.queue({ kind: 'reject', error: namedError('NotSupportedError') });
  assert.doesNotThrow(() => h.music.enter(true));
  await flush();
  assert.equal(h.button.dataset.state, 'unavailable');
  h.audio.error = { code: 4 };
  h.audio.dispatch('error');
  assert.equal(h.button.dataset.state, 'unavailable');
  h.button.dispatch('click');
  await flush();
  assert.equal(h.audio.loadCalls, 1, 'retry reloads a failed media resource');
  assert.equal(h.audio.playCalls, 2, 'retry invokes play again');
  assert.equal(h.button.dataset.state, 'playing');
  return { failedState: 'unavailable', loadCalls: h.audio.loadCalls,
    playCalls: h.audio.playCalls, retryState: h.button.dataset.state };
});

await test('music button mutes and unmutes the same player', async () => {
  const h = makeMusic();
  h.music.enter(true);
  await flush();
  assert.equal(h.button.dataset.state, 'playing');
  h.button.dispatch('click');
  assert.equal(h.audio.paused, true);
  assert.equal(h.button.dataset.state, 'off');
  assert.equal(h.button.attributes.get('aria-pressed'), 'false');
  h.button.dispatch('click');
  await flush();
  assert.equal(h.audio.playCalls, 2);
  assert.equal(h.button.dataset.state, 'playing');
  assert.equal(h.button.attributes.get('aria-pressed'), 'true');
  return { playerInstances: 1, playCalls: h.audio.playCalls, finalState: h.button.dataset.state };
});

await test('visibility and BFCache suspend audio in place, then resume after return', async () => {
  const h = makeMusic();
  h.music.enter(true);
  await flush();
  h.audio.currentTime = 37.25;
  h.document.hidden = true;
  h.document.dispatch('visibilitychange');
  assert.equal(h.audio.paused, true);
  assert.equal(h.audio.currentTime, 37.25, 'background pause preserves playback position');
  assert.equal(h.button.dataset.state, 'background');
  h.document.hidden = false;
  h.document.dispatch('visibilitychange');
  await flush();
  assert.equal(h.audio.playCalls, 2);
  assert.equal(h.audio.currentTime, 37.25);
  assert.equal(h.button.dataset.state, 'playing');

  h.audio.currentTime = 52.5;
  h.window.dispatch('pagehide');
  assert.equal(h.audio.paused, true);
  assert.equal(h.audio.currentTime, 52.5);
  assert.equal(h.button.dataset.state, 'background');
  h.window.dispatch('pageshow');
  await flush();
  assert.equal(h.audio.playCalls, 3);
  assert.equal(h.audio.currentTime, 52.5);
  assert.equal(h.button.dataset.state, 'playing');
  return { visibilityResume: true, bfcacheResume: true, retainedSeconds: h.audio.currentTime,
    playCalls: h.audio.playCalls };
});

await test('a user mute remains off across visibility and BFCache return', async () => {
  const h = makeMusic();
  h.music.enter(true);
  await flush();
  h.button.dispatch('click');
  assert.equal(h.button.dataset.state, 'off');
  const callsAtMute = h.audio.playCalls;
  h.audio.currentTime = 11;
  h.document.hidden = true;
  h.document.dispatch('visibilitychange');
  h.document.hidden = false;
  h.document.dispatch('visibilitychange');
  h.window.dispatch('pagehide');
  h.window.dispatch('pageshow');
  await flush();
  assert.equal(h.audio.playCalls, callsAtMute);
  assert.equal(h.button.dataset.state, 'off');
  assert.equal(h.audio.currentTime, 11);
  return { playCallsBeforeAndAfterReturn: callsAtMute, state: h.button.dataset.state,
    retainedSeconds: h.audio.currentTime };
});

await test('stop resets position; pending resolve/reject cannot resurrect or replace newer play', async () => {
  for (const settlement of ['resolve', 'reject']) {
    // A pending request settled after stop cannot restart the stopped player.
    const stopped = makeMusic(), first = deferred();
    stopped.audio.queue({ kind: 'pending', gate: first });
    stopped.music.enter(true);
    stopped.audio.currentTime = 19;
    stopped.music.stop();
    assert.equal(stopped.audio.currentTime, 0);
    assert.equal(stopped.audio.paused, true);
    if (settlement === 'resolve') stopped.audio.paused = false; // simulate a late media start
    if (settlement === 'resolve') first.resolve(); else first.reject(namedError('AbortError'));
    await flush();
    assert.equal(stopped.audio.paused, true);
    assert.equal(stopped.button.dataset.state, 'idle');

    // An obsolete promise cannot change the loading state of a newer request.
    const newer = makeMusic(), oldGate = deferred(), newGate = deferred();
    newer.audio.queue({ kind: 'pending', gate: oldGate });
    newer.audio.queue({ kind: 'pending', gate: newGate });
    newer.music.enter(true);
    newer.music.stop();
    newer.music.enter(true);
    assert.equal(newer.button.dataset.state, 'loading');
    if (settlement === 'resolve') oldGate.resolve(); else oldGate.reject(namedError('AbortError'));
    await flush();
    assert.equal(newer.button.dataset.state, 'loading', 'stale settlement must not touch the current request');
    assert.equal(newer.audio.playCalls, 2);
    newer.audio.paused = false;
    newGate.resolve();
    await flush();
    assert.equal(newer.button.dataset.state, 'playing');
  }
  return { settlements: ['resolve', 'reject'], stoppedPosition: 0,
    staleSettlementOverridesNewRequest: false };
});

await test('late playing events are rejected when playback is no longer wanted', () => {
  const h = makeMusic(), gate = deferred();
  h.audio.queue({ kind: 'pending', gate });
  h.music.enter(true);
  h.music.stop();
  h.audio.paused = false;
  h.audio.dispatch('playing');
  assert.equal(h.audio.paused, true);
  assert.equal(h.button.dataset.state, 'idle');
  assert.equal(h.audio.playCalls, 1, 'late event must not issue a new play request');
  return { latePlayingEvent: 'paused', wanted: false, extraPlayCalls: 0 };
});

const failed = results.filter(result => !result.passed).length;
console.log(JSON.stringify({ passed: failed === 0, total: results.length,
  passedTests: results.length - failed, failedTests: failed,
  index: path.join(root, 'index.html'), tests: results,
  boundaries: [
    'The real createBackgroundMusic function runs against a deterministic fake HTMLAudioElement and fake DOM events; this is not an audio decoder, browser autoplay policy, network download, or device test.',
    'The mobile scene regression suite uses a lightweight music stub; lifecycle and AR/VR scene coverage remain in test_mobile_scene.mjs.'
  ] }, null, 2));
if (failed) process.exitCode = 1;
