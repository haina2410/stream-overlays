import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameManager } from '../lib/game-manager.js';
import { createGameRegistry } from '../lib/game-registry.js';
import { createStore as createReanimalStore } from '../lib/store.js';

const directories = [];

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function stateFile() {
  const directory = await mkdtemp(join(tmpdir(), 'stream-overlay-game-manager-'));
  directories.push(directory);
  return join(directory, 'state.json');
}

function merge(target, patch) {
  const value = { ...target };
  for (const [key, next] of Object.entries(patch || {})) {
    value[key] = next && typeof next === 'object' && !Array.isArray(next) && value[key] && typeof value[key] === 'object'
      ? merge(value[key], next)
      : next;
  }
  return value;
}

function createFixtureStore({ initialState } = {}) {
  let state = merge({ score: 0, settings: { sound: true } }, initialState);
  const listeners = new Set();
  return {
    get: () => state,
    patch(patch) {
      state = merge(state, patch);
      for (const listener of listeners) listener(state);
      return state;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function registryFor(...ids) {
  return createGameRegistry(ids.map((id) => ({
    id,
    name: id.toUpperCase(),
    description: `${id} package`,
    publicDir: `/games/${id}/public`,
    createStore: createFixtureStore,
    registerRoutes() {},
  })), { exists: () => true });
}

test('manager switches games and preserves independent state', async () => {
  const file = await stateFile();
  const manager = createGameManager({ registry: registryFor('alpha', 'beta'), file });

  manager.getStore('alpha').patch({ score: 7 });
  manager.setActive('beta');
  manager.getStore('beta').patch({ score: 3 });
  manager.setActive('alpha');

  assert.equal(manager.activeState().score, 7);
  await manager.flush();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.activeGameId, 'alpha');
  assert.equal(saved.games.beta.score, 3);
});

test('manager wraps a legacy state as reanimal state', async () => {
  const file = await stateFile();
  await writeFile(file, JSON.stringify({ scene: 'info', revision: 4 }));
  const reanimalRegistry = createGameRegistry([{
    id: 'reanimal',
    name: 'REANIMAL',
    description: 'package',
    publicDir: '/games/reanimal/public',
    createStore: createReanimalStore,
    registerRoutes() {},
  }], { exists: () => true });

  const manager = createGameManager({ registry: reanimalRegistry, file });
  assert.equal(manager.activeId(), 'reanimal');
  assert.equal(manager.activeState().scene, 'info');
  assert.equal(manager.activeState().revision, 4);
});

test('unknown selection is rejected without changing the active game', async () => {
  const file = await stateFile();
  const manager = createGameManager({ registry: registryFor('alpha', 'beta'), file });

  assert.throws(() => manager.setActive('missing'), /unknown game/i);
  assert.equal(manager.activeId(), 'alpha');
});

test('manager notifies host listeners only for active store changes and selection changes', async () => {
  const file = await stateFile();
  const manager = createGameManager({ registry: registryFor('alpha', 'beta'), file });
  const received = [];
  manager.onChange((state) => received.push(state));

  manager.getStore('beta').patch({ score: 9 });
  manager.getStore('alpha').patch({ score: 2 });
  manager.setActive('beta');

  assert.deepEqual(received, [
    { score: 2, settings: { sound: true }, gameId: 'alpha' },
    { score: 9, settings: { sound: true }, gameId: 'beta' },
  ]);
});

test('manager persists inactive game changes without broadcasting them', async () => {
  const file = await stateFile();
  const manager = createGameManager({ registry: registryFor('alpha', 'beta'), file });
  let notifications = 0;
  manager.onChange(() => { notifications += 1; });

  manager.getStore('beta').patch({ score: 11 });
  await manager.flush();

  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.games.beta.score, 11);
  assert.equal(notifications, 0);
});

test('manager retains saved state for packages that are not registered', async () => {
  const file = await stateFile();
  await writeFile(file, JSON.stringify({
    version: 2,
    activeGameId: 'alpha',
    games: { alpha: { score: 5 }, retired: { trophies: 4 } },
  }));
  const manager = createGameManager({ registry: registryFor('alpha', 'beta'), file });

  manager.getStore('alpha').patch({ score: 6 });
  await manager.flush();

  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.games.retired, { trophies: 4 });
  assert.equal(saved.games.alpha.score, 6);
});

test('manager falls back to the first registered game for an unknown saved selection', async () => {
  const file = await stateFile();
  await writeFile(file, JSON.stringify({
    version: 2,
    activeGameId: 'retired',
    games: { retired: { trophies: 4 }, beta: { score: 8 } },
  }));
  const manager = createGameManager({ registry: registryFor('alpha', 'beta'), file });

  assert.equal(manager.activeId(), 'alpha');
  assert.equal(manager.getStore('beta').get().score, 8);
});

test('manager restores the selected game and every registered state after reload', async () => {
  const file = await stateFile();
  const registry = registryFor('alpha', 'beta');
  const first = createGameManager({ registry, file });
  first.getStore('alpha').patch({ score: 6 });
  first.setActive('beta');
  first.getStore('beta').patch({ score: 12, settings: { sound: false } });
  await first.flush();

  const reloaded = createGameManager({ registry, file });
  assert.equal(reloaded.activeId(), 'beta');
  assert.deepEqual(reloaded.activeState(), { score: 12, settings: { sound: false } });
  assert.equal(reloaded.getStore('alpha').get().score, 6);
});

test('manager logs malformed saved JSON and starts with package defaults', async () => {
  const file = await stateFile();
  await writeFile(file, '{ definitely not JSON');
  const errors = [];

  const manager = createGameManager({
    registry: registryFor('alpha'),
    file,
    logger: { error: (...args) => errors.push(args.join(' ')) },
  });

  assert.equal(manager.activeId(), 'alpha');
  assert.equal(manager.activeState().score, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not read/i);
});
