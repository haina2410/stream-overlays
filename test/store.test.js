import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SCENES, CHAPTERS } from '../lib/store.js';

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
  };
}

test('default scene is clean and all scenes are known', () => {
  const s = createStore();
  assert.equal(s.get().scene, 'clean');
  assert.deepEqual(SCENES, ['clean', 'info', 'chapter', 'soon', 'brb']);
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
