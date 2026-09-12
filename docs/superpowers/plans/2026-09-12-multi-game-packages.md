# Multi-Game Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the REANIMAL-only overlay into a server-selected host for isolated, stateful game packages.

**Architecture:** An explicit registry validates package definitions, while a central game manager owns selection, versioned persistence, and active-state notifications. Stable host pages at `/` and `/viewer` embed the selected package in an iframe; each package owns scoped APIs, control UI, renderer, styles, assets, and state behavior.

**Tech Stack:** Node.js 20+, ECMAScript modules, Hono, `@hono/node-server`, Server-Sent Events, Node test runner, browser-native modules and iframes.

**Spec:** `docs/superpowers/specs/2026-09-12-multi-game-packages-design.md`

## Global Constraints

- Game IDs must match `/^[a-z0-9][a-z0-9-]*$/` and be registered explicitly.
- `/` and `/viewer` remain the stable phone and OBS entry points.
- `STATE_FILE` continues to override the default `state.json` path.
- Legacy unversioned REANIMAL state must load without data loss.
- Switching games must preserve each package's state and must not reset its timers or loop.
- REANIMAL visuals, scene behavior, copy, and controls must not intentionally change.
- Use the existing Node test runner and add no runtime dependency.

---

## File Structure

```text
games/
  index.js                         explicit production registry
  reanimal/
    index.js                       package definition and routes
    store.js                       REANIMAL store logic
    public/
      control.html                 existing REANIMAL control UI
      viewer.html                  existing REANIMAL viewer document
      overlay.js                   existing renderer
      overlay.css                  existing styles
      previews/gameplay.webp       existing preview asset
    test/store.test.js             existing store tests
lib/
  game-registry.js                 definition validation and lookup
  game-manager.js                  selection, persistence, notifications
public/
  control.html                     shared selector/control iframe shell
  control.js                       control-shell behavior
  host.css                         host-shell layout
  viewer.html                      transparent viewer iframe shell
  viewer.js                        viewer-shell behavior
  dev-reload.js                    existing shared dev reload client
test/
  game-registry.test.js
  game-manager.test.js
  host-client.test.js
  server.test.js
server.js                          app factory, package mounting, startup
README.md                          operator and package-author docs
package.json                       watch `games/`
```

---

### Task 1: Validate and Register Game Definitions

**Files:**
- Create: `lib/game-registry.js`
- Create: `test/game-registry.test.js`

**Interfaces:**
- Consumes: Package objects with `id`, `name`, `description`, `publicDir`, `createStore`, and `registerRoutes`.
- Produces: `createGameRegistry(definitions, { exists }?)` returning `{ list(), get(id), first() }`.

- [ ] **Step 1: Write failing registry tests**

```js
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
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `node --test test/game-registry.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/game-registry.js`.

- [ ] **Step 3: Implement the immutable registry**

```js
import fs from 'node:fs';

const ID = /^[a-z0-9][a-z0-9-]*$/;

export function createGameRegistry(definitions, { exists = fs.existsSync } = {}) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new Error('at least one game is required');
  const games = [];
  const byId = new Map();
  for (const definition of definitions) {
    if (!ID.test(definition?.id || '')) throw new Error(`invalid game id: ${definition?.id}`);
    if (byId.has(definition.id)) throw new Error(`duplicate game id: ${definition.id}`);
    for (const field of ['name', 'description', 'publicDir']) {
      if (typeof definition[field] !== 'string' || !definition[field]) throw new Error(`${definition.id}.${field} is required`);
    }
    for (const field of ['createStore', 'registerRoutes']) {
      if (typeof definition[field] !== 'function') throw new Error(`${definition.id}.${field} must be a function`);
    }
    if (!exists(definition.publicDir)) throw new Error(`public directory not found: ${definition.publicDir}`);
    const frozen = Object.freeze({ ...definition });
    games.push(frozen);
    byId.set(frozen.id, frozen);
  }
  return Object.freeze({
    list: () => [...games],
    get: (id) => byId.get(id),
    first: () => games[0],
  });
}
```

- [ ] **Step 4: Run the registry tests**

Run: `node --test test/game-registry.test.js`

Expected: all registry tests PASS.

- [ ] **Step 5: Commit the registry**

```bash
git add lib/game-registry.js test/game-registry.test.js
git commit -m "Add explicit game package registry"
```

---

### Task 2: Add Versioned Multi-Game State Management

**Files:**
- Create: `lib/game-manager.js`
- Create: `test/game-manager.test.js`
- Modify: `lib/store.js`
- Modify: `test/store.test.js`

**Interfaces:**
- Consumes: `registry.list()`, `registry.get(id)`, and package stores with `get()` and `onChange(fn)`.
- Produces: `createGameManager({ registry, file, logger })` returning `{ activeId(), activeState(), catalog(), getStore(id), setActive(id), onChange(fn), flush() }`.
- Produces: REANIMAL `createStore({ initialState, setTimer, clearTimer })`; filesystem persistence is removed from the package store.

- [ ] **Step 1: Write failing manager tests with two in-memory packages**

Create a fixture store that deep-merges `initialState`, exposes `get`, `patch`, and `onChange`, then cover:

```js
test('manager switches games and preserves independent state', async () => {
  const manager = createGameManager({ registry, file });
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
  await writeFile(file, JSON.stringify({ scene: 'info', revision: 4 }));
  const manager = createGameManager({ registry: reanimalRegistry, file });
  assert.equal(manager.activeId(), 'reanimal');
  assert.equal(manager.activeState().scene, 'info');
});

test('unknown selection is rejected without changing the active game', () => {
  const manager = createGameManager({ registry, file });
  assert.throws(() => manager.setActive('missing'), /unknown game/i);
  assert.equal(manager.activeId(), 'alpha');
});
```

Also test active-only notifications, inactive persistence, unknown saved-package retention, fallback from an unknown saved active ID, and reload restoration.

- [ ] **Step 2: Run focused manager tests and verify failure**

Run: `node --test test/game-manager.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/game-manager.js`.

- [ ] **Step 3: Refactor the REANIMAL store away from filesystem ownership**

Change its constructor to merge supplied state and leave persistence to its caller:

```js
export function createStore({ initialState, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let state = deepMerge(defaultState(), initialState || {});
  // Existing scene validation, loop restoration, timers, commit, and listeners remain.
}
```

Delete `node:fs`, file reads, and file writes. Update the persistence test to construct a manager later; keep all scene, chapter, loop, and timer assertions unchanged.

- [ ] **Step 4: Implement the manager and atomic serialized persistence**

Use `readFileSync` only during construction. Maintain a promise chain for writes to `<state file>.<pid>.tmp`, followed by `rename`. Catch and log each write failure so future writes still run. Build persisted snapshots as:

```js
const snapshot = () => ({
  version: 2,
  activeGameId,
  games: Object.fromEntries([
    ...Object.entries(retainedUnknownStates),
    ...registry.list().map(({ id }) => [id, stores.get(id).get()]),
  ]),
});
```

Subscribe once to each package store. Every store change queues persistence; only the active store change emits the host state. `setActive` queues persistence and emits `{ ...store.get(), gameId: activeGameId }` without touching package state.

- [ ] **Step 5: Run manager and existing store tests**

Run: `node --test test/game-manager.test.js test/store.test.js`

Expected: all tests PASS and no timer behavior regresses.

- [ ] **Step 6: Commit state management**

```bash
git add lib/game-manager.js lib/store.js test/game-manager.test.js test/store.test.js
git commit -m "Persist isolated state for each game"
```

---

### Task 3: Package REANIMAL and Mount Scoped APIs

**Files:**
- Create: `games/index.js`
- Create: `games/reanimal/index.js`
- Move: `lib/store.js` to `games/reanimal/store.js`
- Move: `test/store.test.js` to `games/reanimal/test/store.test.js`
- Modify: `server.js`
- Create: `test/server.test.js`

**Interfaces:**
- Consumes: `createGameRegistry`, `createGameManager`, and the REANIMAL definition.
- Produces: `createApp({ definitions, stateFile, logger }?)` returning `{ app, manager }` without opening a socket.
- Produces: `reanimalGame` definition and scoped `/games/reanimal/api/*` routes.

- [ ] **Step 1: Move the REANIMAL store and repair its test import**

Use filesystem moves, then change the test import to `../store.js`. Run:

```bash
node --test games/reanimal/test/store.test.js
```

Expected: all moved store tests PASS.

- [ ] **Step 2: Write failing HTTP tests against the exported app factory**

Use a minimal second definition with an existing temporary public directory. Assert:

```js
const catalog = await app.request('/api/games').then((r) => r.json());
assert.equal(catalog.activeGameId, 'reanimal');

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
```

Also cover malformed bodies, scoped REANIMAL state, the compatibility `/api/state` route after switching, and structured `404` for unsupported active-package APIs.

- [ ] **Step 3: Define and register the REANIMAL server package**

`games/reanimal/index.js` exports metadata, resolves its `publicDir` with `import.meta.url`, creates its store, and registers the existing routes relative to the game mount:

```js
export const reanimalGame = {
  id: 'reanimal',
  name: 'REANIMAL',
  description: 'Co-op horror broadcast package',
  publicDir,
  createStore,
  registerRoutes(app, { store }) {
    app.get('/api/chapters', (c) => c.json(CHAPTERS));
    app.post('/api/chapter/next', (c) => c.json(store.nextChapter()));
    // Register validated loop, patch, and show handlers with current behavior.
  },
};
```

`games/index.js` exports `[reanimalGame]` as `games`.

- [ ] **Step 4: Refactor `server.js` into construction and startup**

Create the registry and manager inside `createApp`. Mount for every definition:

- `/games/<id>/control` and `/viewer` from the package public directory.
- `/games/<id>/assets/*` with a rewrite that strips the package asset prefix.
- `/games/<id>/api/state` and `/games/<id>/events` from the host.
- Package-specific routes through `registerRoutes`.

Add host catalog and selection routes before the active-game compatibility dispatcher. Keep LAN addresses and dev generation on the host. Start the Node listener only when `server.js` is the process entry point.

- [ ] **Step 5: Run HTTP and package-store tests**

Run: `node --test test/server.test.js games/reanimal/test/store.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit server packaging**

```bash
git add server.js games/index.js games/reanimal/index.js games/reanimal/store.js games/reanimal/test/store.test.js test/server.test.js lib/store.js test/store.test.js
git commit -m "Package REANIMAL behind scoped game routes"
```

The deleted source paths in the final `git add` are intentional so Git records the moves.

---

### Task 4: Build Stable Host Shells

**Files:**
- Create: `public/control.js`
- Create: `public/viewer.js`
- Create: `public/host.css`
- Replace: `public/control.html`
- Replace: `public/viewer.html`
- Move: `public/overlay.js` to `games/reanimal/public/overlay.js`
- Move: `public/overlay.css` to `games/reanimal/public/overlay.css`
- Move: `public/previews/gameplay.webp` to `games/reanimal/public/previews/gameplay.webp`
- Create: `games/reanimal/public/control.html` from the current control page
- Create: `games/reanimal/public/viewer.html` from the current viewer page
- Create: `test/host-client.test.js`

**Interfaces:**
- Consumes: `GET /api/games`, `POST /api/games/active`, and host `state` SSE events carrying `gameId`.
- Produces: `gamePageUrl(gameId, page)` and `createHostController(options)` from `public/control.js`; `updateViewerFrame(frame, gameId)` from `public/viewer.js`.

- [ ] **Step 1: Write failing pure client tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gamePageUrl, applyActiveGame } from '../public/control.js';
import { updateViewerFrame } from '../public/viewer.js';

test('game page URLs are scoped and encoded', () => {
  assert.equal(gamePageUrl('reanimal', 'control'), '/games/reanimal/control');
});

test('control selection and viewer update only replace changed iframe URLs', () => {
  const frame = { dataset: {}, src: '' };
  assert.equal(applyActiveGame(frame, { value: '' }, 'reanimal'), true);
  assert.equal(applyActiveGame(frame, { value: 'reanimal' }, 'reanimal'), false);
  assert.equal(updateViewerFrame(frame, 'reanimal'), false);
});
```

Keep DOM startup behind `if (typeof document !== 'undefined')` so Node can import both modules.

- [ ] **Step 2: Run client tests and verify missing exports**

Run: `node --test test/host-client.test.js`

Expected: FAIL because the host modules do not exist.

- [ ] **Step 3: Move REANIMAL browser files and scope every package URL**

Copy the current root control and viewer documents into the package before replacing them. Change their resources and APIs to:

```text
/games/reanimal/assets/overlay.css
/games/reanimal/assets/overlay.js
/games/reanimal/api/state
/games/reanimal/api/show
/games/reanimal/api/loop
/games/reanimal/api/chapters
/games/reanimal/api/chapter/next
/games/reanimal/events
```

Keep `/dev-reload.js`, `/api/addresses`, and the stable `/viewer` copy target host-scoped.

- [ ] **Step 4: Implement host modules and minimal shell documents**

The control shell fetches the catalog, populates one `<option>` per registered game, selects `activeGameId`, and loads `/games/<id>/control`. Its change handler disables the selector during `POST /api/games/active`, renders a returned error inline, and restores the authoritative selection after failure. Its `EventSource('/events')` handler applies `event.gameId`.

The viewer shell uses a borderless transparent iframe sized to `100vw` by `100vh`. It fetches the initial catalog and also listens to `/events`; `updateViewerFrame` changes `src` only when `frame.dataset.gameId !== gameId`.

- [ ] **Step 5: Run client and full unit tests**

Run: `pnpm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit host shells and package assets**

```bash
git add public games/reanimal/public test/host-client.test.js
git commit -m "Switch host pages between game packages"
```

---

### Task 5: Complete Compatibility, Watch Mode, and Documentation

**Files:**
- Modify: `server.js`
- Modify: `package.json`
- Modify: `test/server.test.js`
- Modify: `test/dev-reload.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: Active package routing and existing `/api/*` callers.
- Produces: Compatibility dispatch for active-game commands and watch coverage for `games/`.

- [ ] **Step 1: Add failing compatibility assertions**

Test that `/api/show` changes the selected package only, `/api/chapters` still returns REANIMAL chapters, an unsupported fixture endpoint returns `{ error, gameId, path }` with status `404`, and a host endpoint such as `/api/games` is never forwarded.

- [ ] **Step 2: Implement active-game request dispatch**

After host-owned routes, rewrite unmatched `/api/*` requests to `/games/<activeGameId>/api/*` and call the same Hono app with the original method, headers, and body. Guard the rewritten request so it cannot re-enter the compatibility route. Return structured JSON when the package route does not exist.

- [ ] **Step 3: Extend native watch mode**

Set the script to:

```json
"dev": "node --watch --watch-preserve-output --watch-path=server.js --watch-path=lib --watch-path=public --watch-path=games server.js --dev"
```

Update the dev test to assert `games` is included alongside the existing watch paths.

- [ ] **Step 4: Rewrite operator and package-author documentation**

Document the selector, immediate OBS switching, per-game saved state, stable versus scoped routes, the version-2 state envelope and automatic legacy migration, package directory contract, explicit registration, and `pnpm dev` behavior below `games/`.

- [ ] **Step 5: Run automated verification**

Run:

```bash
pnpm test
git diff --check
```

Expected: every test PASS and `git diff --check` prints nothing.

- [ ] **Step 6: Run manual smoke verification**

Start on isolated temporary ports and state files. Verify:

1. `GET /api/games` reports REANIMAL active.
2. `/`, `/viewer`, `/games/reanimal/control`, and `/games/reanimal/viewer` return `200`.
3. `POST /api/show` updates REANIMAL and appears on both scoped and host event streams.
4. A legacy state file with `scene: "info"` is returned from `/api/state` after restart.
5. `pnpm dev` restarts after touching a file below `games/`, and `/api/dev` returns a new generation.

- [ ] **Step 7: Commit compatibility and documentation**

```bash
git add server.js package.json test/server.test.js test/dev-reload.test.js README.md
git commit -m "Document and verify multi-game operation"
```

---

### Task 6: Final Review and Push

**Files:**
- Review: every path listed above

**Interfaces:**
- Consumes: all earlier task deliverables.
- Produces: a clean, tested `main` branch synchronized with `origin/main`.

- [ ] **Step 1: Compare implementation to the approved spec**

Check package isolation, selection persistence, legacy migration, stable entry points, compatibility endpoints, structured failures, REANIMAL parity, and test coverage. Fix any missed requirement using a failing test first.

- [ ] **Step 2: Run the final test and whitespace checks**

Run:

```bash
pnpm test
git diff --check
git status --short --branch
```

Expected: tests PASS, whitespace check is empty, and only intended work is committed.

- [ ] **Step 3: Inspect the commit range**

Run:

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: the design plus focused implementation commits appear, with no unrelated files.

- [ ] **Step 4: Push**

Run: `git push origin main`

Expected: `main -> main`, followed by `git status --short --branch` showing `main...origin/main` with no divergence.
