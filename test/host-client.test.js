import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gamePageUrl, applyActiveGame, createHostController } from '../public/control.js';
import * as hostClient from '../public/control.js';
import { updateViewerFrame, createHostViewer } from '../public/viewer.js';

function deferred() {
  let resolve;
  return { promise: new Promise((done) => { resolve = done; }), resolve };
}

function response(body, ok = true) {
  return { ok, json: async () => body };
}

function catalog(activeGameId) {
  return {
    activeGameId,
    games: [
      { id: 'reanimal', name: 'REANIMAL' },
      { id: 'fixture', name: 'Fixture' },
    ],
  };
}

function createSelector() {
  const listeners = new Map();
  return {
    value: '',
    disabled: false,
    ownerDocument: { createElement: () => ({}) },
    addEventListener(type, listener) { listeners.set(type, listener); },
    replaceChildren(...options) {
      this.options = options;
      if (!options.some((option) => option.value === this.value)) this.value = options[0]?.value || '';
    },
    change() { return listeners.get('change')(); },
  };
}

function createEventSourceStub() {
  let instance;
  class EventSourceStub {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      instance = this;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    emitGame(gameId) {
      this.listeners.get('state')({ data: JSON.stringify({ gameId }) });
    }
  }
  return { EventSourceStub, get instance() { return instance; } };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('game page URLs are scoped and encoded', () => {
  assert.equal(gamePageUrl('reanimal', 'control'), '/games/reanimal/control');
  assert.equal(gamePageUrl('co-op/team', 'viewer'), '/games/co-op%2Fteam/viewer');
});

test('control selection and viewer update only replace changed iframe URLs', () => {
  const frame = { dataset: {}, src: '' };
  assert.equal(applyActiveGame(frame, { value: '' }, 'reanimal'), true);
  assert.equal(applyActiveGame(frame, { value: 'reanimal' }, 'reanimal'), false);
  assert.equal(updateViewerFrame(frame, 'reanimal'), false);
});

test('viewer update loads a changed game page once', () => {
  const frame = { dataset: { gameId: 'reanimal' }, src: '' };
  assert.equal(updateViewerFrame(frame, 'next game'), true);
  assert.equal(frame.src, '/games/next%20game/viewer');
  assert.equal(updateViewerFrame(frame, 'next game'), false);
});

test('delayed initial catalog responses do not override newer SSE game selections', async () => {
  const initialControl = deferred();
  const controlFrame = { dataset: {}, src: '' };
  const selector = createSelector();
  const controlEvents = createEventSourceStub();
  createHostController({
    frame: controlFrame,
    selector,
    error: { textContent: '' },
    fetchImpl: () => initialControl.promise,
    EventSourceImpl: controlEvents.EventSourceStub,
  }).start();
  controlEvents.instance.emitGame('fixture');
  initialControl.resolve(response(catalog('reanimal')));
  await settle();
  assert.equal(controlFrame.dataset.gameId, 'fixture');
  assert.equal(selector.value, 'fixture');
  assert.deepEqual(selector.options.map((option) => option.value), ['reanimal', 'fixture']);

  const initialViewer = deferred();
  const viewerFrame = { dataset: {}, src: '' };
  const viewerEvents = createEventSourceStub();
  createHostViewer({
    frame: viewerFrame,
    fetchImpl: () => initialViewer.promise,
    EventSourceImpl: viewerEvents.EventSourceStub,
  }).start();
  viewerEvents.instance.emitGame('fixture');
  initialViewer.resolve(response(catalog('reanimal')));
  await settle();
  assert.equal(viewerFrame.dataset.gameId, 'fixture');
});

test('delayed successful POST responses do not override newer SSE game selections', async () => {
  const post = deferred();
  const frame = { dataset: {}, src: '' };
  const selector = createSelector();
  const events = createEventSourceStub();
  let requestCount = 0;
  createHostController({
    frame,
    selector,
    error: { textContent: '' },
    fetchImpl: (url) => {
      requestCount += 1;
      if (url === '/api/games' && requestCount === 1) return Promise.resolve(response(catalog('reanimal')));
      return post.promise;
    },
    EventSourceImpl: events.EventSourceStub,
  }).start();
  await settle();
  selector.value = 'fixture';
  const changing = selector.change();
  events.instance.emitGame('fixture');
  post.resolve(response(catalog('reanimal')));
  await changing;
  assert.equal(frame.dataset.gameId, 'fixture');
  assert.equal(selector.value, 'fixture');
});

test('delayed restoration catalog responses do not override newer SSE game selections', async () => {
  const restoration = deferred();
  const frame = { dataset: {}, src: '' };
  const selector = createSelector();
  const events = createEventSourceStub();
  let requestCount = 0;
  createHostController({
    frame,
    selector,
    error: { textContent: '' },
    fetchImpl: (url) => {
      requestCount += 1;
      if (url === '/api/games' && requestCount === 1) return Promise.resolve(response(catalog('reanimal')));
      if (url === '/api/games/active') return Promise.resolve(response({ error: 'unknown game' }, false));
      return restoration.promise;
    },
    EventSourceImpl: events.EventSourceStub,
  }).start();
  await settle();
  selector.value = 'fixture';
  const changing = selector.change();
  await settle();
  events.instance.emitGame('fixture');
  restoration.resolve(response(catalog('reanimal')));
  await changing;
  assert.equal(frame.dataset.gameId, 'fixture');
  assert.equal(selector.value, 'fixture');
});

test('failed control selection disables the selector until its error and restoration finish', async () => {
  const post = deferred();
  const frame = { dataset: {}, src: '' };
  const selector = createSelector();
  const error = { textContent: '' };
  const events = createEventSourceStub();
  let catalogRequests = 0;
  createHostController({
    frame, selector, error,
    fetchImpl: (url) => {
      if (url === '/api/games') {
        catalogRequests += 1;
        return Promise.resolve(response(catalog('reanimal')));
      }
      return post.promise;
    },
    EventSourceImpl: events.EventSourceStub,
  }).start();
  await settle();

  selector.value = 'fixture';
  const changing = selector.change();
  assert.equal(selector.disabled, true);
  post.resolve(response({ error: 'fixture is unavailable' }, false));
  await changing;

  assert.equal(catalogRequests, 2);
  assert.equal(selector.disabled, false);
  assert.equal(error.textContent, 'fixture is unavailable');
  assert.equal(selector.value, 'reanimal');
  assert.equal(frame.src, '/games/reanimal/control');
});

test('viewer handles a rejected startup catalog and recovers on the event stream', async () => {
  const frame = { dataset: {}, src: '' };
  const events = createEventSourceStub();
  createHostViewer({
    frame,
    fetchImpl: async () => { throw new Error('network unavailable'); },
    EventSourceImpl: events.EventSourceStub,
  }).start();
  await settle();
  assert.equal(frame.src, '');
  events.instance.emitGame('fixture');
  assert.equal(frame.src, '/games/fixture/viewer');
});

test('host controller reports reconnecting status and recovers without changing its frame', async () => {
  const frame = { dataset: {}, src: '' };
  const status = { textContent: '' };
  const events = createEventSourceStub();
  createHostController({
    frame, selector: createSelector(), error: { textContent: '' }, status,
    fetchImpl: async () => response(catalog('fixture')),
    EventSourceImpl: events.EventSourceStub,
  }).start();
  await settle();
  assert.equal(status.textContent, 'đang kết nối');
  events.instance.listeners.get('open')();
  assert.equal(status.textContent, 'đã kết nối');
  events.instance.listeners.get('error')();
  assert.equal(status.textContent, 'đang kết nối lại');
  assert.equal(frame.src, '/games/fixture/control');
  events.instance.listeners.get('open')();
  assert.equal(status.textContent, 'đã kết nối');
});

test('host operator links expose the stable viewer and phone URLs independently of the package', async () => {
  assert.equal(typeof hostClient.initializeHostLinks, 'function', 'host operator links must be initialized outside the package');
  const viewer = { textContent: '' };
  const phone = { textContent: '' };
  const open = { href: '' };
  await hostClient.initializeHostLinks({
    viewer, phone, open, origin: 'http://localhost:4545',
    fetchImpl: async (url) => {
      assert.equal(url, '/api/addresses');
      return response({ port: 4567, lan: ['192.168.1.20', '10.0.0.2'] });
    },
  });
  assert.equal(viewer.textContent, 'http://localhost:4545/viewer');
  assert.equal(open.href, 'http://localhost:4545/viewer');
  assert.equal(phone.textContent, 'http://192.168.1.20:4567/ http://10.0.0.2:4567/');
});

test('host operator links retain the viewer URL when the address request fails', async () => {
  assert.equal(typeof hostClient.initializeHostLinks, 'function', 'host operator links must be initialized outside the package');
  const viewer = { textContent: '' };
  const phone = { textContent: 'Cùng mạng Wi-Fi' };
  await hostClient.initializeHostLinks({
    viewer, phone, open: {}, origin: 'http://localhost:4545',
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(viewer.textContent, 'http://localhost:4545/viewer');
  assert.equal(phone.textContent, 'Cùng mạng Wi-Fi');
});

test('host control document owns the shared connection and operator-link controls', async () => {
  const html = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../public/control.html', import.meta.url), 'utf8'));
  assert.match(html, /id="serverStatus"/);
  assert.match(html, /id="viewerUrl"/);
  assert.match(html, /id="phoneUrls"/);
  assert.doesNotMatch(html, /REANIMAL/);
});
