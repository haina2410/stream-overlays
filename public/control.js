export function gamePageUrl(gameId, page) {
  return `/games/${encodeURIComponent(gameId)}/${encodeURIComponent(page)}`;
}

export function applyActiveGame(frame, selector, gameId) {
  selector.value = gameId;
  if (frame.dataset.gameId === gameId) return false;
  frame.dataset.gameId = gameId;
  frame.src = gamePageUrl(gameId, 'control');
  return true;
}

export function createHostController({ frame, selector, error, fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource }) {
  let activeGameId = null;
  let selectionVersion = 0;

  function showError(message = '') {
    error.textContent = message;
  }

  function applySelection(gameId) {
    activeGameId = gameId;
    selectionVersion += 1;
    applyActiveGame(frame, selector, gameId);
  }

  function applyCatalog(catalog, requestVersion) {
    selector.replaceChildren(...catalog.games.map((game) => {
      const option = selector.ownerDocument.createElement('option');
      option.value = game.id;
      option.textContent = game.name;
      return option;
    }));
    if (requestVersion === selectionVersion) applySelection(catalog.activeGameId);
    else if (activeGameId) selector.value = activeGameId;
  }

  async function loadCatalog() {
    const requestVersion = selectionVersion;
    const response = await fetchImpl('/api/games');
    if (!response.ok) throw new Error('Could not load games.');
    const catalog = await response.json();
    applyCatalog(catalog, requestVersion);
  }

  async function restoreSelection(message) {
    showError(message);
    try {
      await loadCatalog();
    } catch {
      if (activeGameId) applyActiveGame(frame, selector, activeGameId);
    }
  }

  selector.addEventListener('change', async () => {
    const gameId = selector.value;
    const requestVersion = selectionVersion;
    selector.disabled = true;
    showError();
    try {
      const response = await fetchImpl('/api/games/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        await restoreSelection(body.error || 'Could not change active game.');
        return;
      }
      applyCatalog(body, requestVersion);
    } catch {
      await restoreSelection('Could not change active game.');
    } finally {
      selector.disabled = false;
    }
  });

  function start() {
    const events = new EventSourceImpl('/events');
    events.addEventListener('state', (event) => {
      const state = JSON.parse(event.data);
      if (state.gameId) {
        applySelection(state.gameId);
      }
    });
    loadCatalog().catch((error) => showError(error.message));
    return events;
  }

  return { start };
}

if (typeof document !== 'undefined') {
  createHostController({
    frame: document.querySelector('#gameFrame'),
    selector: document.querySelector('#gameSelect'),
    error: document.querySelector('#gameError'),
  }).start();
}
