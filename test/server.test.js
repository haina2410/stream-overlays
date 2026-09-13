import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { games } from '../games/index.js';

const directories = [];

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixturePaths() {
  const directory = await mkdtemp(join(tmpdir(), 'stream-overlay-server-'));
  directories.push(directory);
  return { publicDir: directory, stateFile: join(directory, 'state.json') };
}

function createFixtureStore({ initialState } = {}) {
  let state = { score: 0, ...initialState };
  const listeners = new Set();
  return {
    get: () => state,
    patch(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
      return state;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function fixtureGame(publicDir, id = 'fixture') {
  return {
    id,
    name: 'Fixture',
    description: 'Test-only game package',
    publicDir,
    createStore: createFixtureStore,
    registerRoutes(app) {
      app.all('/api/games', (c) => c.json({ hijacked: 'games' }));
      app.all('/api/games/active', (c) => c.json({ hijacked: 'games-active' }));
      app.all('/api/addresses', (c) => c.json({ hijacked: 'addresses' }));
      app.all('/api/dev', (c) => c.json({ hijacked: 'dev' }));
      app.get('/api/records/:id', (c) => c.json({ error: 'record missing', id: c.req.param('id') }, 404));
    },
  };
}

test('catalog lists packages and validates active-game selection', async () => {
  const { publicDir, stateFile } = await fixturePaths();
  const { app, manager } = createApp({ definitions: [...games, fixtureGame(publicDir)], stateFile, logger: null });

  const catalog = await app.request('/api/games').then((response) => response.json());
  assert.equal(catalog.activeGameId, 'reanimal');
  assert.deepEqual(catalog.games.map(({ id }) => id), ['reanimal', 'fixture']);

  const selected = await app.request('/api/games/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'fixture' }),
  });
  assert.equal(selected.status, 200);
  assert.equal(manager.activeId(), 'fixture');

  const invalid = await app.request('/api/games/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'missing' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(manager.activeId(), 'fixture');

  const malformed = await app.request('/api/games/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(malformed.status, 400);
});

test('scoped state and compatibility APIs follow the active package', async () => {
  const { publicDir, stateFile } = await fixturePaths();
  const { app } = createApp({ definitions: [...games, fixtureGame(publicDir)], stateFile, logger: null });

  const reanimalState = await app.request('/games/reanimal/api/state').then((response) => response.json());
  assert.equal(reanimalState.scene, 'clean');

  await app.request('/api/games/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'fixture' }),
  });

  const activeState = await app.request('/api/state').then((response) => response.json());
  assert.deepEqual(activeState, { score: 0 });

  const unsupported = await app.request('/api/chapters');
  assert.equal(unsupported.status, 404);
  assert.deepEqual(await unsupported.json(), {
    error: 'unsupported game API',
    gameId: 'fixture',
    path: '/api/chapters',
  });
});

test('compatibility API commands target only the active package and preserve host routes', async () => {
  const { publicDir, stateFile } = await fixturePaths();
  const { app } = createApp({ definitions: [...games, fixtureGame(publicDir)], stateFile, logger: null });

  const shown = await app.request('/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: 'info' }),
  });
  assert.equal(shown.status, 200);
  assert.equal((await app.request('/games/reanimal/api/state').then((response) => response.json())).scene, 'info');
  assert.deepEqual(await app.request('/games/fixture/api/state').then((response) => response.json()), { score: 0 });

  const chapters = await app.request('/api/chapters');
  assert.equal(chapters.status, 200);
  assert.deepEqual((await chapters.json()).map(({ title }) => title), [
    'Dead in the Water',
    'The Cleaning House',
    'After the Flood',
    'No Shelter',
    'Down in a Hole',
    'Nobody Left Behind',
    'The Spoils',
    'The Watcher',
    'All-Consuming Past',
  ]);

  await app.request('/api/games/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'fixture' }),
  });
  const unsupported = await app.request('/api/chapters');
  assert.equal(unsupported.status, 404);
  assert.deepEqual(await unsupported.json(), {
    error: 'unsupported game API',
    gameId: 'fixture',
    path: '/api/chapters',
  });

  const hostCatalog = await app.request('/api/games');
  assert.equal(hostCatalog.status, 200);
  assert.equal((await hostCatalog.json()).activeGameId, 'fixture');
});

test('scoped REANIMAL updates and active selection persist through the manager', async () => {
  const { publicDir, stateFile } = await fixturePaths();
  const { app, manager } = createApp({ definitions: [...games, fixtureGame(publicDir)], stateFile, logger: null });

  const shown = await app.request('/games/reanimal/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: 'info' }),
  });
  assert.equal(shown.status, 200);

  await app.request('/api/games/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'fixture' }),
  });
  await manager.flush();

  const saved = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.activeGameId, 'fixture');
  assert.equal(saved.games.reanimal.scene, 'info');
});

test('canceling host and scoped event streams clears their heartbeats', async (t) => {
  const { stateFile } = await fixturePaths();
  const timers = [];
  const cleared = [];
  t.mock.method(globalThis, 'setInterval', () => {
    const timer = {};
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearInterval', (timer) => cleared.push(timer));
  const { app } = createApp({ stateFile, logger: null });

  for (const path of ['/events', '/games/reanimal/events']) {
    const response = await app.request(path);
    const reader = response.body.getReader();
    await reader.read();
    await new Promise((resolve) => setImmediate(resolve));
    await reader.cancel();
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(timers.length, 2, 'each stream creates one heartbeat before cancellation');
  assert.equal(cleared.length, timers.length);
  assert.deepEqual(new Set(cleared), new Set(timers));
});

test('missing scoped APIs return structured errors naming the package and path', async () => {
  const { stateFile } = await fixturePaths();
  const { app } = createApp({ stateFile, logger: null });
  for (const gameId of ['reanimal', 'missing']) {
    const response = await app.request(`/games/${gameId}/api/unavailable`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), {
      error: 'unsupported game API', gameId, path: '/api/unavailable',
    });
  }
});

test('unsupported methods on host-owned APIs are not dispatched into the active package', async () => {
  const { publicDir, stateFile } = await fixturePaths();
  const { app } = createApp({ definitions: [...games, fixtureGame(publicDir)], stateFile, logger: null });
  await app.request('/api/games/active', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: 'fixture' }),
  });

  for (const path of ['/api/games', '/api/games/active', '/api/addresses', '/api/dev']) {
    const response = await app.request(path, { method: 'PATCH' });
    assert.equal(response.status, 405);
    assert.notDeepEqual(await response.json(), { hijacked: path.slice('/api/'.length) });
  }
});

test('package 404 responses survive scoped and compatibility dispatch', async () => {
  const { publicDir, stateFile } = await fixturePaths();
  const { app } = createApp({ definitions: [...games, fixtureGame(publicDir)], stateFile, logger: null });
  await app.request('/api/games/active', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: 'fixture' }),
  });

  for (const path of ['/games/fixture/api/records/x', '/api/records/x']) {
    const response = await app.request(path);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'record missing', id: 'x' });
  }
});

test('scoped fallback derives the API path from its game prefix', async () => {
  const { publicDir, stateFile } = await fixturePaths();
  const { app } = createApp({ definitions: [...games, fixtureGame(publicDir, 'api')], stateFile, logger: null });

  for (const [path, gameId] of [['/games/reanimal/api', 'reanimal'], ['/games/api/api', 'api']]) {
    const response = await app.request(path);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'unsupported game API', gameId, path: '/api' });
  }
});
