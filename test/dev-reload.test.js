import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function temporaryStateFile() {
  const directory = await mkdtemp(join(tmpdir(), 'stream-overlay-dev-'));
  return {
    stateFile: join(directory, 'state.json'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessGroupExit(pid, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await delay(25);
  }
  return !processGroupExists(pid);
}

function forceStopProcessGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function startTermResistantProcess() {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  child.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`term-resistant child exited with ${code}`)));
    child.stdout.on('data', (chunk) => {
      if (chunk.includes('ready')) resolve();
    });
  });
  return child;
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

async function waitForDevServer(child, stderr, timeout) {
  await new Promise((resolve, reject) => {
    const fail = (error) => {
      clearTimeout(timer);
      child.stdout.off('data', started);
      child.off('exit', exited);
      child.off('error', fail);
      reject(error);
    };
    const started = (chunk) => {
      if (!chunk.includes('control')) return;
      clearTimeout(timer);
      child.off('exit', exited);
      child.off('error', fail);
      resolve();
    };
    const exited = (code) => fail(new Error(`dev server exited with ${code}: ${stderr()}`));
    const timer = setTimeout(() => fail(new Error(`dev server start timed out: ${stderr()}`)), timeout);
    child.once('exit', exited);
    child.once('error', fail);
    child.stdout.on('data', started);
  });
}

async function startDevServer({ port, stateFile, readinessTimeoutMs = 5000, onSpawn } = {}) {
  if (!stateFile) throw new Error('a temporary state file is required for dev server tests');
  if (port === undefined) port = await unusedPort();
  const child = spawn('pnpm', ['dev'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), STATE_FILE: stateFile },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  try {
    onSpawn?.(child);
    await waitForDevServer(child, () => stderr, readinessTimeoutMs);
    return { child, port };
  } catch (error) {
    try {
      await stopDevServer(child, { graceMs: 250, forceMs: 250 });
    } catch (cleanupError) {
      error.message += `; cleanup failed: ${cleanupError.message}`;
    }
    throw error;
  }
}

async function stopWindowsDevServer(child, timeout) {
  const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  const finished = await Promise.race([
    once(killer, 'exit').then(() => true),
    delay(timeout).then(() => false),
  ]);
  if (!finished) {
    killer.kill();
    throw new Error('timed out while terminating the dev server process tree');
  }
}

async function stopDevServer(child, { graceMs = 1000, forceMs = 1000 } = {}) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await stopWindowsDevServer(child, graceMs + forceMs);
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') return;
    throw error;
  }
  if (await waitForProcessGroupExit(child.pid, graceMs)) return;

  process.kill(-child.pid, 'SIGKILL');
  if (await waitForProcessGroupExit(child.pid, forceMs)) return;
  throw new Error('timed out while terminating the dev server process group');
}

test('dev startup timeout tears down its watcher process group', { skip: process.platform === 'win32', timeout: 5000 }, async () => {
  const state = await temporaryStateFile();
  let observedChild;
  const started = startDevServer({
    stateFile: state.stateFile,
    readinessTimeoutMs: 1,
    onSpawn: (child) => { observedChild = child; },
  });
  const fallbackCleanup = started.then(
    ({ child }) => stopDevServer(child).catch(() => {}),
    () => {},
  );

  try {
    await assert.rejects(started, /timed out/);
    assert.ok(observedChild, 'the timed-out startup exposes its real child process');
    assert.equal(await waitForProcessGroupExit(observedChild.pid, 500), true);
  } finally {
    if (observedChild) forceStopProcessGroup(observedChild.pid);
    await fallbackCleanup;
    await state.cleanup();
  }
});

test('dev watcher shutdown is bounded for a process that ignores SIGTERM', { skip: process.platform === 'win32', timeout: 5000 }, async () => {
  const child = await startTermResistantProcess();
  const stopping = stopDevServer(child, { graceMs: 50, forceMs: 500 });

  try {
    const stoppedInTime = await Promise.race([
      stopping.then(() => true),
      delay(750).then(() => false),
    ]);
    assert.equal(stoppedInTime, true, 'the process tree must be force-stopped after its grace period');
    assert.equal(await waitForProcessGroupExit(child.pid, 100), true);
  } finally {
    forceStopProcessGroup(child.pid);
    await stopping;
  }
});

async function waitForNewGeneration(port, generation) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const status = await fetch(`http://127.0.0.1:${port}/api/dev`).then((response) => response.json());
      if (status.generation !== generation) return status.generation;
    } catch {
      // The child process briefly closes the listener while it restarts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('dev server did not start a new generation after a game asset changed');
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

test('pnpm dev restarts when a file below games changes', { timeout: 12000 }, async () => {
  const asset = new URL('../games/reanimal/public/overlay.css', import.meta.url);
  const original = await readFile(asset, 'utf8');
  const state = await temporaryStateFile();
  let child;

  try {
    const started = await startDevServer({ stateFile: state.stateFile });
    child = started.child;
    const { port } = started;
    const initial = await fetch(`http://127.0.0.1:${port}/api/dev`).then((response) => response.json());
    await writeFile(asset, `${original}\n`);
    const nextGeneration = await waitForNewGeneration(port, initial.generation);
    assert.notEqual(nextGeneration, initial.generation);
  } finally {
    try {
      await stopDevServer(child);
    } finally {
      try {
        await writeFile(asset, original);
      } finally {
        await state.cleanup();
      }
    }
  }
});
