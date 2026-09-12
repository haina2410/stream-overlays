export function updateViewerFrame(frame, gameId) {
  if (frame.dataset.gameId === gameId) return false;
  frame.dataset.gameId = gameId;
  frame.src = `/games/${encodeURIComponent(gameId)}/viewer`;
  return true;
}

export function createHostViewer({ frame, fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource }) {
  async function loadCatalog() {
    const response = await fetchImpl('/api/games');
    if (!response.ok) return;
    const catalog = await response.json();
    updateViewerFrame(frame, catalog.activeGameId);
  }

  function start() {
    const events = new EventSourceImpl('/events');
    events.addEventListener('state', (event) => {
      const state = JSON.parse(event.data);
      if (state.gameId) updateViewerFrame(frame, state.gameId);
    });
    loadCatalog();
    return events;
  }

  return { start };
}

if (typeof document !== 'undefined') {
  createHostViewer({ frame: document.querySelector('#gameFrame') }).start();
}
