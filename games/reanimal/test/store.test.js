import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SCENES, CHAPTERS } from '../store.js';

function fakeTimers() {
  const queue = [];
  return {
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      queue.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = queue.indexOf(t);
      if (i >= 0) queue.splice(i, 1);
    },
    fire() {
      const t = queue.shift();
      if (t) t.fn();
    },
    pending: () => queue.length,
    queue,
  };
}

test('default scene is clean and all scenes are known', () => {
  const s = createStore();
  assert.equal(s.get().scene, 'clean');
  assert.deepEqual(SCENES, ['clean', 'info', 'chapter', 'soon', 'brb']);
});

test('initial state is merged with the default state', () => {
  const s = createStore({
    initialState: {
      scene: 'info',
      theme: { accent: '#ffffff' },
      chapter: { title: 'Restored chapter' },
    },
  });

  assert.equal(s.get().scene, 'info');
  assert.equal(s.get().theme.accent, '#ffffff');
  assert.equal(s.get().theme.grain, 0.055);
  assert.equal(s.get().chapter.title, 'Restored chapter');
  assert.equal(s.get().chapter.holdMs, 6000);
});

test('restored timed or unknown scenes return to their saved fallback', () => {
  const timed = createStore({ initialState: { scene: 'chapter', returnTo: 'info' } });
  const unknown = createStore({ initialState: { scene: 'missing', returnTo: 'clean' } });

  assert.equal(timed.get().scene, 'info');
  assert.equal(unknown.get().scene, 'clean');
});

test('a restored enabled loop starts its first eligible step at its saved interval', () => {
  const t = fakeTimers();
  const s = createStore({
    initialState: {
      scene: 'brb',
      loop: {
        enabled: true,
        steps: [
          { scene: 'clean', sec: 0, on: true },
          { scene: 'info', sec: 7, on: true },
          { scene: 'chapter', sec: 9, on: true },
        ],
      },
    },
    ...t,
  });

  assert.equal(s.get().scene, 'info');
  assert.equal(s.get().loop.index, 1);
  assert.equal(t.pending(), 1);
  assert.equal(t.queue[0].ms, 7000);
});

test('base game has 9 chapters with title and objective', () => {
  assert.equal(CHAPTERS.length, 9);
  CHAPTERS.forEach((c, i) => {
    assert.equal(c.n, i + 1);
    assert.ok(c.title.length > 0);
    assert.ok(c.objective.length > 0);
  });
});

test('show switches scene and bumps nonce and revision', () => {
  const s = createStore();
  const before = s.get();
  const after = s.show('info');
  assert.equal(after.scene, 'info');
  assert.equal(after.nonce, before.nonce + 1);
  assert.equal(after.revision, before.revision + 1);
});

test('show with data merges into that scene only', () => {
  const s = createStore();
  const st = s.show('chapter', { label: 'Chương 4', title: 'No Shelter' });
  assert.equal(st.chapter.title, 'No Shelter');
  assert.equal(st.chapter.holdMs, 6000);
});

test('patch merges data but cannot change the scene', () => {
  const s = createStore();
  s.show('brb');
  const st = s.patch({ scene: 'clean', brb: { headline: 'Chờ chút.' }, theme: { accent: '#E8CE97' } });
  assert.equal(st.scene, 'brb');
  assert.equal(st.brb.headline, 'Chờ chút.');
  assert.equal(st.theme.grain, 0.055);
});

test('chapter card returns to the previous gameplay scene', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.show('info');
  s.show('chapter');
  assert.equal(s.get().returnTo, 'info');
  assert.equal(t.pending(), 1);
  t.fire();
  assert.equal(s.get().scene, 'info');
});

test('chapter card after a full-screen scene returns to clean', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.show('brb');
  s.show('chapter');
  t.fire();
  assert.equal(s.get().scene, 'clean');
});

test('showing another chapter restarts the timer and keeps the return target', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.show('info');
  s.show('chapter', { title: 'A' });
  s.show('chapter', { title: 'B' });
  assert.equal(t.pending(), 1);
  t.fire();
  assert.equal(s.get().scene, 'info');
});

test('a stale timer does not override a manual scene change', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.show('chapter');
  s.show('soon');
  assert.equal(t.pending(), 0);
});

test('nextChapter advances and wraps around', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.show('chapter', { title: CHAPTERS[7].title });
  assert.equal(s.nextChapter().chapter.title, CHAPTERS[8].title);
  assert.equal(s.nextChapter().chapter.title, CHAPTERS[0].title);
  assert.equal(s.get().chapter.label, 'Chương 1');
});

test('unknown scene throws', () => {
  const s = createStore();
  assert.throws(() => s.show('comment'), /unknown scene/);
});

test('loop rotates through active steps in order', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.setLoop({ enabled: true });
  assert.equal(s.get().scene, 'clean');
  assert.equal(t.pending(), 1);
  t.fire();
  assert.equal(s.get().scene, 'info');
  t.fire();
  assert.equal(s.get().scene, 'chapter');
  t.fire();
  assert.equal(s.get().scene, 'clean');
});

test('loop uses the configured seconds per step', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.setLoop({ enabled: true, steps: [
    { scene: 'clean', sec: 30, on: true },
    { scene: 'info', sec: 5, on: true },
    { scene: 'chapter', sec: 8, on: false },
  ] });
  assert.equal(t.queue?.[0]?.ms ?? 30000, 30000);
  t.fire();
  assert.equal(s.get().scene, 'info');
  t.fire();
  assert.equal(s.get().scene, 'clean', 'chapter step is off, so it is skipped');
});

test('loop starts from the current scene when it is a step', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.show('info');
  s.setLoop({ enabled: true });
  assert.equal(s.get().scene, 'info');
  t.fire();
  assert.equal(s.get().scene, 'chapter');
});

test('chapter hold timer does not fire while the loop runs', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.setLoop({ enabled: true });
  t.fire(); t.fire(); // now on chapter
  assert.equal(s.get().scene, 'chapter');
  assert.equal(t.pending(), 1, 'only the loop timer is armed');
});

test('picking a loop scene by hand jumps the loop to that step', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.setLoop({ enabled: true });
  s.show('chapter');
  assert.equal(s.get().loop.enabled, true);
  assert.equal(s.get().loop.index, 2);
  t.fire();
  assert.equal(s.get().scene, 'clean');
});

test('showing a scene outside the loop pauses it', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.setLoop({ enabled: true });
  s.show('brb');
  assert.equal(s.get().loop.enabled, false);
  assert.equal(t.pending(), 0);
});

test('turning the loop off keeps the current scene', () => {
  const t = fakeTimers();
  const s = createStore(t);
  s.setLoop({ enabled: true });
  t.fire();
  s.setLoop({ enabled: false });
  assert.equal(s.get().scene, 'info');
  assert.equal(t.pending(), 0);
});

test('loop with no active steps stays off', () => {
  const s = createStore(fakeTimers());
  s.setLoop({ enabled: true, steps: [{ scene: 'clean', sec: 10, on: false }] });
  assert.equal(s.get().loop.enabled, false);
});
