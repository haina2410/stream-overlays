import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gamePageUrl, applyActiveGame, createHostController } from '../public/control.js';
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
