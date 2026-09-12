# Multi-Game Packages Design

## Summary

Turn the current REANIMAL-only overlay into a host for independent game packages. The server owns the active-game choice, persists a separate state for every game, and tells all connected control panels and viewers when the active game changes. Each package owns its server behavior, control panel, viewer renderer, styles, assets, defaults, and tests.

The first delivery migrates REANIMAL into this package boundary without intentionally changing its visuals or behavior. A small test-only game proves that selection and isolation work; adding another real game is a separate content task because no second title or art direction has been chosen.

## Goals

- Let an operator choose the active game from the web control panel.
- Switch every open control panel, preview, viewer, and OBS browser source immediately after that choice.
- Restore each game's last scene, content edits, loop state, and theme when switching back.
- Let different games define completely different scenes, behavior, controls, and visuals.
- Keep the stable entry points `/` and `/viewer` for phones and OBS.
- Preserve the existing active-game HTTP commands where their target package implements them.
- Provide a documented, explicit process for adding a game package.

## Non-Goals

- Installing or editing packages through the browser.
- Automatically discovering untrusted folders at runtime.
- Designing a second real game's broadcast package.
- Running different active games on different viewers at the same time.
- Sharing scene state or theme values between games.
- Hot-loading a newly added package without restarting watch mode.

## Package Model

Game packages are explicitly registered in `games/index.js`. Explicit registration makes package order deterministic and turns duplicate IDs or invalid definitions into startup errors instead of silently exposing partial packages.

Each package lives at `games/<game-id>/` and contains:

```text
games/reanimal/
  index.js            # metadata, store factory, and route registration
  store.js            # REANIMAL state and timing behavior
  public/
    control.html      # game-specific controls
    viewer.html       # game-specific overlay document
    overlay.js        # scene rendering
    overlay.css       # scene visuals
    previews/         # package-owned images
  test/
    store.test.js
```

A registered definition has this server-side contract:

```js
{
  id: 'reanimal',
  name: 'REANIMAL',
  description: 'Co-op horror broadcast package',
  publicDir: '/absolute/path/to/games/reanimal/public',
  createStore(options),
  registerRoutes(app, context),
}
```

`id` is a lowercase URL-safe slug matching `/^[a-z0-9][a-z0-9-]*$/`. `createStore({ initialState, onChange })` returns the package store. `registerRoutes(app, { store })` adds package-specific API routes relative to `/games/<id>`; the host adds the package state endpoint and SSE endpoint. Package public files are served only below `/games/<id>/assets/*`, so package routes and files cannot replace host routes.

The host validates IDs, required fields, duplicate registration, the store interface, and the existence of the public directory before it begins listening.

## Host Pages and Client Flow

`public/control.html` becomes a small host shell containing the shared server status, game selector, and a game control iframe. `public/viewer.html` becomes a transparent host shell containing only a full-size game viewer iframe. Their JavaScript lives in focused `public/control.js` and `public/viewer.js` modules.

On startup, a shell fetches `GET /api/games`, renders the registered games, and points its iframe at the active package:

```text
control shell -> /games/reanimal/control
viewer shell  -> /games/reanimal/viewer
```

Both shells subscribe to the host `/events` stream. A game switch changes the iframe URL only when `gameId` changes. Changing the `src` fully tears down the former game's scripts, styles, SSE stream, and timers, preventing one package from leaking behavior into another.

The control selector sends `POST /api/games/active` with `{ "gameId": "..." }`. It remains disabled until the request completes. On success, the server persists the selection and broadcasts the newly active state. On failure, the selector returns to the server-reported value and shows an inline error without changing either iframe.

The existing development reload module remains loaded by the two host shells and by game pages. A source edit may therefore reload a nested game page before the server-generation poll reloads the shell; this is harmless and no new file watcher is required because `games/` will be added to the native Node watch paths.

## Server and Routing

The host exposes:

| Method and path | Result |
| --- | --- |
| `GET /api/games` | `{ activeGameId, games: [{ id, name, description }] }` |
| `POST /api/games/active` | Validate, persist, broadcast, and return the same catalog shape |
| `GET /events` | SSE `state` events containing `{ ...activeState, gameId }` |
| `GET /games/:id/api/state` | Raw state for one registered game |
| `GET /games/:id/events` | Raw state SSE stream for one registered game |
| `/games/:id/api/*` | Other routes registered by that package |

Existing active-game routes remain available through a compatibility dispatcher. Requests such as `/api/state`, `/api/show`, `/api/loop`, `/api/chapters`, and `/api/chapter/next` are internally dispatched to `/games/<activeGameId>/api/...`. Host-owned `/api/games`, `/api/addresses`, and `/api/dev` are matched first and are never dispatched. If the active package does not implement a requested command, the response is a JSON `404` naming the game and unavailable path.

`GET /events` preserves the existing `state` event name and top-level state fields, adding `gameId`. It emits immediately upon connection, whenever the active package changes state, and once after a game switch with the restored state of the newly active package. Changes to inactive games are persisted but not broadcast on the host stream. A package's scoped stream continues to report that package only.

## State and Persistence

`state.json` becomes a versioned envelope:

```json
{
  "version": 2,
  "activeGameId": "reanimal",
  "games": {
    "reanimal": {
      "revision": 12,
      "scene": "info"
    }
  }
}
```

The full package state is stored under its ID; the shortened example above is not the complete REANIMAL state. State belonging to a package that is temporarily no longer registered is retained in the envelope but never served until that package is registered again.

At startup:

1. A version-2 envelope is loaded and merged with each registered package's defaults.
2. A legacy unversioned object containing the current top-level `scene` is treated as REANIMAL state and wrapped under `games.reanimal`.
3. A missing file uses the first registered game and all package defaults.
4. An unknown saved `activeGameId` falls back to the first registered game without deleting its saved data.
5. Invalid JSON logs one clear error and starts from defaults, matching current behavior.

The host owns persistence so packages never race while writing the common file. Package stores report changes to `GameManager`; it snapshots the selection and every package state and writes the complete envelope. Writes are serialized and use a temporary sibling file followed by rename, so a process interruption cannot leave a partially written JSON document. `STATE_FILE` continues to override the default path for compatibility and tests.

Switching games does not mutate either package's state, increment its revision, restart its loop, or replay its scene timer. Package timers may continue while inactive; switching back shows the state the package reached. This matches the meaning of separate live server state and avoids adding lifecycle semantics to package contracts.

## REANIMAL Migration

The existing `lib/store.js` moves to `games/reanimal/store.js`, and its tests move beside it. The existing control, viewer, renderer, stylesheet, and preview asset move into `games/reanimal/public/`. Their API URLs become package-relative so the embedded control and viewer always address REANIMAL even during a switch.

The REANIMAL package registers its chapter, loop, state-patch, and scene routes. Scene names, chapter copy, timings, default state, loop behavior, fonts, dimensions, and Vietnamese UI copy remain unchanged. The host control page keeps the LAN URL and OBS viewer URL; game-specific editing UI remains inside the REANIMAL control page.

`public/dev-reload.js` stays shared and is served by the host. Game HTML imports it from `/dev-reload.js`.

## Error Handling

- An invalid or unregistered selection returns `400` with `{ error, gameIds }` and does not change persisted state.
- Invalid package definitions stop startup and identify the package and failed contract field.
- A missing package API route returns structured `404` JSON rather than the host HTML page.
- A failed persistence write logs the filename and error while keeping the in-memory state available.
- A host shell that loses SSE shows a reconnecting status and relies on `EventSource` reconnection.
- A package iframe load failure leaves the selector usable; switching away can recover without restarting the server.

## Testing

Tests use Node's existing test runner and no new runtime dependency.

- Registry tests cover valid registration, duplicate IDs, malformed IDs, and missing required package fields.
- Manager tests use REANIMAL plus a minimal in-memory fixture game to cover defaults, switching, per-game isolation, unknown selection, inactive changes, active notifications, and legacy migration.
- Persistence tests use a temporary directory to verify the version-2 envelope, retention of unknown package state, and reload restoration.
- HTTP tests exercise the catalog, selection validation, scoped state, compatibility dispatch, structured missing-route responses, and host SSE payload shape.
- Client unit tests cover catalog rendering and iframe URL changes without requiring a browser framework; URL selection is extracted into pure functions.
- Existing REANIMAL store tests continue to pass from their new location.
- A manual smoke test opens `/` and `/viewer`, changes the active game using the test fixture only in a test server, verifies both iframes switch, switches back, and verifies REANIMAL state is restored.
- Watch-mode smoke testing verifies that an edit below `games/` changes `/api/dev` generation and reloads host and package pages.

## Documentation and Extension Workflow

The README will describe game selection, the versioned state file, compatibility endpoints, and a concise checklist for adding a package:

1. Copy or create a focused package directory.
2. Implement and test the package contract.
3. Register it explicitly in `games/index.js`.
4. Confirm its control and viewer pages use scoped APIs.
5. Run the complete test suite and manually switch to and from the package.

No generator, upload UI, schema language, or auto-discovery is included in this delivery.

## Delivery Sequence

1. Add and test the registry and game manager, including persistence migration.
2. Move REANIMAL server logic behind the package contract while preserving its tests.
3. Add scoped package routing and active-game compatibility dispatch.
4. Replace the root documents with host shells and move REANIMAL browser files into its package.
5. Add client selection tests, watch coverage, documentation, and end-to-end smoke checks.

Each step must leave the test suite passing and should be committed separately so package infrastructure, migration, routing, and client behavior can be reviewed independently.
