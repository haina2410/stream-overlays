import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createGameManager({ registry, file, logger = console }) {
  const saved = loadSavedState(file, logger);
  const definitions = registry.list();
  const knownIds = new Set(definitions.map(({ id }) => id));
  const retainedUnknownStates = Object.fromEntries(
    Object.entries(saved.games).filter(([id]) => !knownIds.has(id)),
  );
  const stores = new Map();
  let activeGameId = registry.get(saved.activeGameId) ? saved.activeGameId : registry.first().id;
  const listeners = new Set();
  let writes = Promise.resolve();
  const temporaryFile = file && `${file}.${process.pid}.tmp`;

  for (const game of definitions) {
    stores.set(game.id, game.createStore({ initialState: saved.games[game.id] }));
  }

  function hostState() {
    return { ...stores.get(activeGameId).get(), gameId: activeGameId };
  }

  function emit() {
    const state = hostState();
    for (const listener of listeners) listener(state);
  }

  function snapshot() {
    return {
      version: 2,
      activeGameId,
      games: Object.fromEntries([
        ...Object.entries(retainedUnknownStates),
        ...definitions.map(({ id }) => [id, stores.get(id).get()]),
      ]),
    };
  }

  function persist() {
    if (!file) return writes;
    const contents = JSON.stringify(snapshot(), null, 2);
    writes = writes.then(async () => {
      try {
        await writeFile(temporaryFile, contents);
        await rename(temporaryFile, file);
      } catch (error) {
        logError(logger, `could not write ${file}:`, error);
      }
    });
    return writes;
  }

  for (const { id } of definitions) {
    stores.get(id).onChange(() => {
      persist();
      if (id === activeGameId) emit();
    });
  }

  return {
    activeId: () => activeGameId,
    activeState: () => stores.get(activeGameId).get(),
    catalog: () => ({
      activeGameId,
      games: definitions.map(({ id, name, description }) => ({ id, name, description })),
    }),
    getStore: (id) => stores.get(id),
    setActive(id) {
      if (!registry.get(id)) throw new Error(`unknown game: ${id}`);
      if (id === activeGameId) return stores.get(activeGameId).get();
      activeGameId = id;
      persist();
      emit();
      return stores.get(activeGameId).get();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: () => writes,
  };
}

function loadSavedState(file, logger) {
  if (!file) return { activeGameId: undefined, games: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (isObject(parsed?.games) && parsed.version === 2) {
      return { activeGameId: parsed.activeGameId, games: parsed.games };
    }
    if (isObject(parsed) && Object.hasOwn(parsed, 'scene')) {
      return { activeGameId: 'reanimal', games: { reanimal: parsed } };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') logError(logger, `could not read ${file}:`, error);
  }
  return { activeGameId: undefined, games: {} };
}

function logError(logger, prefix, error) {
  if (typeof logger?.error === 'function') logger.error(prefix, error.message);
}
