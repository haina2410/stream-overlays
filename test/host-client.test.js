import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gamePageUrl, applyActiveGame } from '../public/control.js';
import { updateViewerFrame } from '../public/viewer.js';

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
