import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameRegistry } from '../lib/game-registry.js';

const game = (id = 'alpha') => ({
  id,
  name: id.toUpperCase(),
  description: `${id} package`,
  publicDir: `/games/${id}/public`,
  createStore() {},
  registerRoutes() {},
});

test('registry preserves order and supports lookup', () => {
  const registry = createGameRegistry([game('alpha'), game('beta')], { exists: () => true });
  assert.deepEqual(registry.list().map(({ id }) => id), ['alpha', 'beta']);
  assert.equal(registry.get('beta').name, 'BETA');
  assert.equal(registry.first().id, 'alpha');
});

test('registry rejects empty, duplicate, malformed, incomplete, or missing packages', () => {
  assert.throws(() => createGameRegistry([], { exists: () => true }), /at least one game/i);
  assert.throws(() => createGameRegistry([game('alpha'), game('alpha')], { exists: () => true }), /duplicate.*alpha/i);
  assert.throws(() => createGameRegistry([game('../bad')], { exists: () => true }), /invalid game id/i);
  assert.throws(() => createGameRegistry([{ ...game(), createStore: null }], { exists: () => true }), /createStore/i);
  assert.throws(() => createGameRegistry([game()], { exists: () => false }), /public directory/i);
});
