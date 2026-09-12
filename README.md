# Stream overlay

Local overlay host for OBS. REANIMAL is the installed default broadcast package; additional game packages can be registered explicitly. The REANIMAL UI text is Vietnamese.

## Start

```sh
pnpm install
pnpm start
```

The server listens on all interfaces on port 4545 and prints the LAN address for your phone. It uses Hono on Node.

For development, start watch mode instead:

```sh
pnpm dev
```

Changes in `server.js`, `lib/`, `public/`, or anywhere below `games/` restart the server and automatically reload open control panels, viewers, package pages, and OBS browser sources. The regular `pnpm start` command does not watch or reload.

| Path | Use |
| --- | --- |
| `/` | Control panel. Works on a phone on the same Wi-Fi. |
| `/viewer` | Overlay for the OBS browser source. |

Set `PORT` or `HOST` in the environment to change the address.

## Packages and selection

The control page has an active-game selector. Choosing a package updates the active package immediately: the control-page iframe and the stable `/viewer` OBS source switch through the host event stream. Keep OBS pointed at `/viewer`; changing packages never requires changing its browser-source URL.

Each package keeps its own state. Switching away does not reset a package, and switching back restores the state it last saved. REANIMAL is initially active because it is the first registered package.

## Stable and scoped routes

Use stable host routes for the operator and existing integrations:

| Route | Use |
| --- | --- |
| `/` | Host control page and package selector. |
| `/viewer` | Host OBS viewer; it follows the active package. |
| `GET /api/games` | List registered packages and the active package. |
| `POST /api/games/active` | Select a package with `{ "gameId": "..." }`. |
| `/events` | Host state stream, including `gameId`. |
| `/api/addresses`, `/api/dev` | Host-owned network and development status endpoints. |

Package-aware tools should use scoped routes: `/games/<gameId>/control`, `/games/<gameId>/viewer`, `/games/<gameId>/events`, `/games/<gameId>/assets/*`, and `/games/<gameId>/api/*`.

For compatibility, an unmatched `/api/*` request is sent to the active package. That keeps existing REANIMAL commands such as `POST /api/show` working while REANIMAL is active. Host routes above are never forwarded. If the active package does not implement a command, the response is `404` JSON: `{ "error": "unsupported game API", "gameId": "...", "path": "/api/..." }`.

## OBS setup

1. Add a **Browser** source.
2. URL: `http://127.0.0.1:4545/viewer`. Width `1920`, height `1080`.
3. Keep "Shutdown source when not visible" off, so the entrance timing stays in sync.

Gameplay scenes have a transparent background. Full-screen scenes are opaque.

## Scenes

| # | Scene | Kind | Behaviour |
| --- | --- | --- | --- |
| 01 | Đang chơi | overlay | LIVE tally with the current clock and grain. No full-frame vignette. |
| 02 | Thông tin game | overlay | Bottom-left card. Stays until you change scene. |
| 03 | Chapter card | timed | Shows for 6 s, then returns to the previous gameplay scene. |
| 04 | Sắp bắt đầu | full | Opaque. Countdown from the control panel. |
| 05 | Quay lại ngay | full | Opaque. Two copy presets. |

The clock next to LIVE shows the local time of the machine that runs the browser source.

### Chapter cards

The base game has 9 chapters. Each has a preset card with a short Vietnamese objective in `lib/store.js`.
Pick one in the control panel, or press "Chương tiếp theo" to advance. The overlay cannot read the game, so you trigger each card yourself.

For a hotkey or Stream Deck, call:

```sh
curl -X POST localhost:4545/api/chapter/next
```

## Loop

The control panel can rotate between Đang chơi, Thông tin game, and Chapter card. Set seconds per step and switch single steps off.
Picking a loop scene by hand jumps the loop to that step. Showing Sắp bắt đầu or Quay lại ngay pauses the loop.

```sh
curl -X POST localhost:4545/api/loop -H 'content-type: application/json' \
  -d '{"enabled":true,"steps":[{"scene":"clean","sec":60,"on":true},{"scene":"info","sec":12,"on":true},{"scene":"chapter","sec":8,"on":true}]}'
```

## REANIMAL API

Other tools can drive the active REANIMAL overlay through the compatibility URLs below. For a package-specific integration, prefix the same API path with `/games/reanimal`.

```sh
# switch scene, with optional data for that scene
curl -X POST localhost:4545/api/show \
  -H 'content-type: application/json' \
  -d '{"scene":"brb","data":{"headline":"Chờ chút.","sub":"Mình quay lại sớm."}}'

# patch text or theme without a scene change
curl -X POST localhost:4545/api/state \
  -H 'content-type: application/json' \
  -d '{"theme":{"accent":"#E8CE97"},"live":false}'

# read state and presets
curl localhost:4545/api/state
curl localhost:4545/api/chapters
```

`GET /events` is a Server-Sent Events stream. Each host `state` event carries the active package state plus `gameId`; `/games/reanimal/events` carries REANIMAL state only.

## State persistence

`state.json` uses a version-2 envelope so the active selection and every package state persist together:

```json
{
  "version": 2,
  "activeGameId": "reanimal",
  "games": {
    "reanimal": { "scene": "clean" }
  }
}
```

A legacy state file whose top-level object has `scene` is recognized as REANIMAL state at startup. Its saved scene is available through the normal APIs after restart, and the next persisted update automatically writes the version-2 envelope.

## Writing a package

Create the package below `games/<id>/`. Its `index.js` must export a package definition with a lowercase, hyphen-safe `id`, `name`, `description`, `publicDir`, `createStore`, and `registerRoutes`. Put `control.html`, `viewer.html`, and assets in the declared public directory; the host serves them under `/games/<id>/control`, `/games/<id>/viewer`, and `/games/<id>/assets/*`.

`registerRoutes(app, { store })` receives the package router and its isolated store. Register API paths such as `/api/state` there; the host mounts them under `/games/<id>`. Packages are not discovered automatically: import the definition and add it to the ordered `games` array in `games/index.js`. That order determines the default active package when no valid saved selection exists.


## Test

```sh
pnpm test
```
