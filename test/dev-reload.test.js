import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function loadReloadClient() {
  try {
    return await import('../public/dev-reload.js');
  } catch (error) {
    assert.fail(`reload client is unavailable: ${error.message}`);
  }
}

test('reloads when a running dev server gets a new generation', async () => {
  const { shouldReload } = await loadReloadClient();

  assert.equal(shouldReload('generation-a', { enabled: true, generation: 'generation-b' }), true);
});

test('does not reload on the initial check or outside dev mode', async () => {
  const { shouldReload } = await loadReloadClient();

  assert.equal(shouldReload(null, { enabled: true, generation: 'generation-a' }), false);
  assert.equal(shouldReload('generation-a', { enabled: false, generation: 'generation-b' }), false);
});

test('polls until the dev server generation changes, then reloads once', async () => {
  const { createDevReloadWatcher } = await loadReloadClient();
  const statuses = [
    { enabled: true, generation: 'generation-a' },
    { enabled: true, generation: 'generation-b' },
  ];
  const scheduled = [];
  let reloads = 0;
  const watcher = createDevReloadWatcher({
    getStatus: async () => statuses.shift(),
    reload: () => { reloads += 1; },
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  await watcher.poll();
  assert.equal(reloads, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 500);

  await scheduled.shift().callback();
  assert.equal(reloads, 1);
  assert.equal(scheduled.length, 0);
});

test('browser module starts polling the dev status endpoint', async () => {
  const previousWindow = globalThis.window;
  let requestedPath = null;
  const scheduled = [];
  globalThis.window = {
    fetch: async (path) => {
      requestedPath = path;
      return {
        ok: true,
        json: async () => ({ enabled: true, generation: 'generation-a' }),
      };
    },
    location: { reload: () => assert.fail('initial status must not reload the page') },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };

  try {
    await import(`../public/dev-reload.js?browser=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requestedPath, '/api/dev');
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 500);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startServer(args = []) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ['server.js', ...args], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 3000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}: ${stderr}`));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (chunk.includes('control')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return { child, port };
}

test('dev server exposes its reload generation', { timeout: 5000 }, async (t) => {
  const { child, port } = await startServer(['--dev']);
  t.after(() => child.kill());

  const response = await fetch(`http://127.0.0.1:${port}/api/dev`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.enabled, true);
  assert.equal(typeof status.generation, 'string');
  assert.ok(status.generation.length > 0);

  for (const path of ['/', '/viewer']) {
    const html = await fetch(`http://127.0.0.1:${port}${path}`).then((res) => res.text());
    assert.match(html, /<script type="module" src="\/dev-reload\.js"><\/script>/);
  }
});
