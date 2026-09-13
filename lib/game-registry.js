import fs from 'node:fs';
import path from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]*$/;

export function createGameRegistry(definitions, { exists = (directory) => fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory() } = {}) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new Error('at least one game is required');
  const games = [];
  const byId = new Map();
  for (const definition of definitions) {
    if (typeof definition?.id !== 'string' || !ID.test(definition.id)) throw new Error(`invalid game id: ${definition?.id}`);
    if (byId.has(definition.id)) throw new Error(`duplicate game id: ${definition.id}`);
    for (const field of ['name', 'description', 'publicDir']) {
      if (typeof definition[field] !== 'string' || !definition[field]) throw new Error(`${definition.id}.${field} is required`);
    }
    for (const field of ['createStore', 'registerRoutes']) {
      if (typeof definition[field] !== 'function') throw new Error(`${definition.id}.${field} must be a function`);
    }
    let hasPublicDirectory = false;
    try {
      hasPublicDirectory = path.isAbsolute(definition.publicDir) && exists(definition.publicDir);
    } catch {
      hasPublicDirectory = false;
    }
    if (!hasPublicDirectory) {
      throw new Error(`${definition.id}.publicDir must be an existing absolute public directory: ${definition.publicDir}`);
    }
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
