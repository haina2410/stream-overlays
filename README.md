# Stream overlay

Local overlay server for OBS. It shows the REANIMAL broadcast package: four scenes at 1920x1080. UI text is Vietnamese.

## Start

```sh
pnpm install
pnpm start
```

The server listens on `http://127.0.0.1:4545`. It uses Hono on Node.

| Path | Use |
| --- | --- |
| `/` | Control panel. Pick the scene, edit text, set the countdown. |
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
| 01 | Đang chơi | overlay | LIVE tally with the current clock, grain, vignette. |
| 02 | Thông tin game | overlay | Bottom-left card. Stays until you change scene. |
| 03 | Sắp bắt đầu | full | Opaque. Countdown from the control panel. |
| 04 | Quay lại ngay | full | Opaque. Two copy presets. |

The clock next to LIVE shows the local time of the machine that runs the browser source.

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

# read state
curl localhost:4545/api/state
```

`GET /events` is a Server-Sent Events stream. Each `state` event carries the full state.

State persists in `state.json` next to the server.

## Test

```sh
pnpm test
```
