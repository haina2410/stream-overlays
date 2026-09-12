import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, createStore, SCENES } from './store.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export const reanimalGame = {
  id: 'reanimal',
  name: 'REANIMAL',
  description: 'Co-op horror broadcast package',
  publicDir,
  createStore,
  registerRoutes(app, { store }) {
    app.get('/api/chapters', (c) => c.json(CHAPTERS));
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
  },
};
