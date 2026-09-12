// Local OBS overlay server.
// Routes:
//   GET  /            control panel
//   GET  /viewer      overlay page for the OBS browser source
//   GET  /api/state   current state as JSON
//   GET  /api/chapters preset chapter cards
//   POST /api/chapter/next  show the next chapter card (for hotkeys)
//   POST /api/loop    merge loop settings: { enabled?, steps? }
//   POST /api/state   deep-merge a JSON patch into the state
//   POST /api/show    switch scene: { scene, data? }
//   GET  /events      Server-Sent Events stream of the full state
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createStore, SCENES, CHAPTERS } from './lib/store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4545);
const HOST = process.env.HOST || '0.0.0.0';
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, 'state.json');
const HEARTBEAT_MS = 25_000;

const store = createStore({ file: STATE_FILE });
const clients = new Set();

store.onChange((state) => {
  for (const stream of clients) stream.writeSSE({ event: 'state', data: JSON.stringify(state) });
});

const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/', serveStatic({ path: './public/control.html' }));
app.get('/viewer', serveStatic({ path: './public/viewer.html' }));

app.get('/api/state', (c) => c.json(store.get()));
app.get('/api/chapters', (c) => c.json(CHAPTERS));
app.get('/api/addresses', (c) => c.json({ port: PORT, lan: lanAddresses() }));

// IPv4 addresses of this machine on the local network, for the phone.
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}
app.post('/api/chapter/next', (c) => c.json(store.nextChapter()));

app.post('/api/loop', async (c) => {
  const patch = await c.req.json().catch(() => null);
  if (!patch || typeof patch !== 'object') return c.json({ error: 'body must be a JSON object' }, 400);
  return c.json(store.setLoop(patch));
});

app.post('/api/state', async (c) => {
  const patch = await c.req.json().catch(() => null);
  if (!patch || typeof patch !== 'object') return c.json({ error: 'body must be a JSON object' }, 400);
  return c.json(store.patch(patch));
});

app.post('/api/show', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !SCENES.includes(body.scene)) {
    return c.json({ error: `unknown scene: ${body?.scene}`, scenes: SCENES }, 400);
  }
  return c.json(store.show(body.scene, body.data));
});

app.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    clients.add(stream);
    await stream.writeSSE({ event: 'state', data: JSON.stringify(store.get()) });
    // Keep the connection alive through OBS idle timeouts.
    const heartbeat = setInterval(() => stream.write(': ping\n\n'), HEARTBEAT_MS);
    await new Promise((resolve) => stream.onAbort(resolve));
    clearInterval(heartbeat);
    clients.delete(stream);
  }),
);

app.use('/*', serveStatic({ root: './public' }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`control  http://127.0.0.1:${PORT}/`);
  for (const ip of lanAddresses()) console.log(`phone    http://${ip}:${PORT}/`);
  console.log(`viewer   http://127.0.0.1:${PORT}/viewer   (OBS browser source, 1920x1080)`);
});
