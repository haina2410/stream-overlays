import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SCENES } from '../lib/store.js';

test('default scene is clean and all scenes are known', () => {
  const s = createStore();
  assert.equal(s.get().scene, 'clean');
  assert.deepEqual(SCENES, ['clean', 'info', 'soon', 'brb']);
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
  const st = s.show('brb', { headline: 'Chờ chút.' });
  assert.equal(st.brb.headline, 'Chờ chút.');
  assert.equal(st.brb.sub, 'Mình quay lại ngay.');
});

test('patch merges data but cannot change the scene', () => {
  const s = createStore();
  s.show('brb');
  const st = s.patch({ scene: 'clean', brb: { headline: 'Chờ chút.' }, theme: { accent: '#E8CE97' } });
  assert.equal(st.scene, 'brb');
  assert.equal(st.brb.headline, 'Chờ chút.');
  assert.equal(st.theme.accent, '#E8CE97');
  assert.equal(st.theme.grain, 0.055);
});

test('listeners get every commit', () => {
  const s = createStore();
  const seen = [];
  s.onChange((st) => seen.push(st.scene));
  s.show('soon');
  s.patch({ live: false });
  assert.deepEqual(seen, ['soon', 'soon']);
});

test('unknown scene throws', () => {
  const s = createStore();
  assert.throws(() => s.show('chapter'), /unknown scene/);
});
