// Local OBS overlay server.
// Routes:
//   GET  /            control panel
//   GET  /viewer      overlay page for the OBS browser source
//   GET  /api/state   current state as JSON
//   POST /api/state   deep-merge a JSON patch into the state
//   POST /api/show    switch scene: { scene, data? }
//   GET  /events      Server-Sent Events stream of the full state
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createStore, SCENES } from './lib/store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4545);
const HOST = process.env.HOST || '127.0.0.1';
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
  console.log(`control  http://${HOST}:${PORT}/`);
  console.log(`viewer   http://${HOST}:${PORT}/viewer   (OBS browser source, 1920x1080)`);
});
