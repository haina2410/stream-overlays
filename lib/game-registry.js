import fs from 'node:fs';

const ID = /^[a-z0-9][a-z0-9-]*$/;

export function createGameRegistry(definitions, { exists = fs.existsSync } = {}) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new Error('at least one game is required');
  const games = [];
  const byId = new Map();
  for (const definition of definitions) {
    if (!ID.test(definition?.id || '')) throw new Error(`invalid game id: ${definition?.id}`);
    if (byId.has(definition.id)) throw new Error(`duplicate game id: ${definition.id}`);
    for (const field of ['name', 'description', 'publicDir']) {
      if (typeof definition[field] !== 'string' || !definition[field]) throw new Error(`${definition.id}.${field} is required`);
    }
    for (const field of ['createStore', 'registerRoutes']) {
      if (typeof definition[field] !== 'function') throw new Error(`${definition.id}.${field} must be a function`);
    }
    if (!exists(definition.publicDir)) throw new Error(`public directory not found: ${definition.publicDir}`);
    const frozen = Object.freeze({ ...definition });
    games.push(frozen);
    byId.set(frozen.id, frozen);
  }
  return Object.freeze({
    list: () => [...games],
    get: (id) => byId.get(id),
    first: () => games[0],
  });
}
