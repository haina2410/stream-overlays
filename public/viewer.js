export function updateViewerFrame(frame, gameId) {
  if (frame.dataset.gameId === gameId) return false;
  frame.dataset.gameId = gameId;
  frame.src = `/games/${encodeURIComponent(gameId)}/viewer`;
  return true;
}

export function createHostViewer({ frame, fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource }) {
  let selectionVersion = 0;

  function applySelection(gameId) {
    selectionVersion += 1;
    updateViewerFrame(frame, gameId);
  }

  async function loadCatalog() {
    const requestVersion = selectionVersion;
    const response = await fetchImpl('/api/games');
    if (!response.ok) return;
    const catalog = await response.json();
    if (requestVersion === selectionVersion) applySelection(catalog.activeGameId);
  }

  function start() {
    const events = new EventSourceImpl('/events');
    events.addEventListener('state', (event) => {
      const state = JSON.parse(event.data);
      if (state.gameId) applySelection(state.gameId);
    });
    // EventSource reconnects independently if the startup request fails.
    loadCatalog().catch(() => {});
    return events;
  }

  return { start };
}

if (typeof document !== 'undefined') {
  createHostViewer({ frame: document.querySelector('#gameFrame') }).start();
}
