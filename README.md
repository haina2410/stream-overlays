# Stream overlay

Local overlay server for OBS. It shows the REANIMAL broadcast package: five scenes at 1920x1080. UI text is Vietnamese.

## Start

```sh
pnpm install
pnpm start
```

The server listens on all interfaces on port 4545 and prints the LAN address for your phone. It uses Hono on Node.

| Path | Use |
| --- | --- |
| `/` | Control panel. Works on a phone on the same Wi-Fi. |
| `/viewer` | Overlay for the OBS browser source. |

Set `PORT` or `HOST` in the environment to change the address.

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

## API

Other tools can drive the overlay directly.

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

`GET /events` is a Server-Sent Events stream. Each `state` event carries the full state.

State persists in `state.json` next to the server.

## Test

```sh
pnpm test
```
