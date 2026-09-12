// Local OBS overlay host for registered game packages.
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { games } from './games/index.js';
import { createGameManager } from './lib/game-manager.js';
import { createGameRegistry } from './lib/game-registry.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4545);
const HOST = process.env.HOST || '0.0.0.0';
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, 'state.json');
const HEARTBEAT_MS = 25_000;
const DEV = process.argv.includes('--dev');
const DEV_GENERATION = DEV ? randomUUID() : null;

export function createApp({ definitions = games, stateFile = STATE_FILE, logger = console } = {}) {
  const registry = createGameRegistry(definitions);
  const manager = createGameManager({ registry, file: stateFile, logger });
  const app = new Hono();
  const hostClients = new Set();

  manager.onChange((state) => broadcast(hostClients, state));

  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/', serveStatic({ root: path.join(ROOT, 'public'), path: 'control.html' }));
  app.get('/viewer', serveStatic({ root: path.join(ROOT, 'public'), path: 'viewer.html' }));
  app.get('/api/games', (c) => c.json(manager.catalog()));
  app.post('/api/games/active', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || !registry.get(body.gameId)) {
      return c.json({ error: 'unknown game', gameIds: registry.list().map(({ id }) => id) }, 400);
    }
    manager.setActive(body.gameId);
    return c.json(manager.catalog());
  });
  app.get('/api/addresses', (c) => c.json({ port: PORT, lan: lanAddresses() }));
  app.get('/api/dev', (c) => c.json({ enabled: DEV, generation: DEV_GENERATION }));
  app.get('/events', stateEvents(hostClients, () => ({ ...manager.activeState(), gameId: manager.activeId() })));

  for (const definition of registry.list()) {
    mountGame(app, definition, manager.getStore(definition.id));
  }

  app.all('/api/*', async (c) => {
    const gameId = manager.activeId();
    const url = new URL(c.req.url);
    url.pathname = `/games/${encodeURIComponent(gameId)}${c.req.path}`;
    const response = await app.fetch(new Request(url, c.req.raw));
    if (response.status !== 404) return response;
    return c.json({ error: 'unsupported game API', gameId, path: c.req.path }, 404);
  });

  app.use('/*', serveStatic({ root: path.join(ROOT, 'public') }));
  return { app, manager };
}

function mountGame(app, definition, store) {
  const prefix = `/games/${definition.id}`;
  const assetsPrefix = `${prefix}/assets`;
  const clients = new Set();
  store.onChange((state) => broadcast(clients, state));

  app.get(`${prefix}/control`, serveStatic({ root: definition.publicDir, path: 'control.html' }));
  app.get(`${prefix}/viewer`, serveStatic({ root: definition.publicDir, path: 'viewer.html' }));
  app.get(`${assetsPrefix}/*`, serveStatic({
    root: definition.publicDir,
    rewriteRequestPath: (requestPath) => requestPath.slice(assetsPrefix.length),
  }));
  app.get(`${prefix}/api/state`, (c) => c.json(store.get()));
  app.get(`${prefix}/events`, stateEvents(clients, () => store.get()));

  const packageApp = new Hono();
  definition.registerRoutes(packageApp, { store });
  app.route(prefix, packageApp);
}

function stateEvents(clients, state) {
  return (c) => streamSSE(c, async (stream) => {
    let aborted = false;
    let resolveAbort;
    const abort = new Promise((resolve) => {
      resolveAbort = resolve;
    });
    stream.onAbort(() => {
      aborted = true;
      resolveAbort();
    });
    clients.add(stream);
    let heartbeat;
    try {
      await stream.writeSSE({ event: 'state', data: JSON.stringify(state()) });
      if (aborted) return;
      heartbeat = setInterval(() => stream.write(': ping\n\n'), HEARTBEAT_MS);
      await abort;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      clients.delete(stream);
    }
  });
}

function broadcast(clients, state) {
  for (const stream of clients) stream.writeSSE({ event: 'state', data: JSON.stringify(state) });
}

// IPv4 addresses of this machine on the local network, for the phone.
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network && network.family === 'IPv4' && !network.internal)
    .map((network) => network.address);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app } = createApp();
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
    console.log(`control  http://127.0.0.1:${PORT}/`);
    for (const ip of lanAddresses()) console.log(`phone    http://${ip}:${PORT}/`);
    console.log(`viewer   http://127.0.0.1:${PORT}/viewer   (OBS browser source, 1920x1080)`);
  });
}
