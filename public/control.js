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

export async function initializeHostLinks({
  viewer,
  phone,
  open,
  copy,
  origin = globalThis.location?.origin,
  fetchImpl = globalThis.fetch,
  clipboard = globalThis.navigator?.clipboard,
  setTimeoutImpl = globalThis.setTimeout,
}) {
  const viewerUrl = `${origin}/viewer`;
  viewer.textContent = viewerUrl;
  open.href = viewerUrl;
  if (copy) {
    copy.addEventListener('click', async () => {
      try {
        await clipboard?.writeText(viewerUrl);
        copy.textContent = 'Đã sao chép';
        setTimeoutImpl(() => { copy.textContent = 'Sao chép URL'; }, 1200);
      } catch {
        // Clipboard access is optional; the visible URL remains available.
      }
    });
  }
  try {
    const response = await fetchImpl('/api/addresses');
    if (!response.ok) return;
    const { port, lan } = await response.json();
    if (lan.length) phone.textContent = lan.map((ip) => `http://${ip}:${port}/`).join(' ');
  } catch {
    // The stable local viewer URL remains useful when network discovery fails.
  }
}

export function createHostController({ frame, selector, error, status, fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource }) {
  let activeGameId = null;
  let selectionVersion = 0;
  let catalogLoaded = false;
  let catalogRequest = null;

  function showError(message = '') {
    error.textContent = message;
  }

  function applySelection(gameId) {
    const changed = activeGameId !== gameId;
    activeGameId = gameId;
    if (changed) selectionVersion += 1;
    applyActiveGame(frame, selector, gameId);
  }

  function applyCatalog(catalog, requestVersion, allowActiveChange = true) {
    selector.replaceChildren(...catalog.games.map((game) => {
      const option = selector.ownerDocument.createElement('option');
      option.value = game.id;
      option.textContent = game.name;
      return option;
    }));
    if (requestVersion === selectionVersion && (allowActiveChange || !activeGameId || catalog.activeGameId === activeGameId)) {
      applySelection(catalog.activeGameId);
    }
    else if (activeGameId) selector.value = activeGameId;
  }

  async function loadCatalog() {
    if (catalogRequest) return catalogRequest;
    const requestVersion = selectionVersion;
    catalogRequest = (async () => {
      const response = await fetchImpl('/api/games');
      if (!response.ok) throw new Error('Could not load games.');
      const catalog = await response.json();
      catalogLoaded = true;
      applyCatalog(catalog, requestVersion, false);
    })();
    try {
      await catalogRequest;
    } finally {
      catalogRequest = null;
    }
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
    if (status) status.textContent = 'đang kết nối';
    const events = new EventSourceImpl('/events');
    events.addEventListener('open', () => {
      if (status) status.textContent = 'đã kết nối';
      if (!catalogLoaded) loadCatalog().catch((loadError) => showError(loadError.message));
    });
    events.addEventListener('error', () => { if (status) status.textContent = 'đang kết nối lại'; });
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
    status: document.querySelector('#serverStatus'),
  }).start();
  initializeHostLinks({
    viewer: document.querySelector('#viewerUrl'),
    phone: document.querySelector('#phoneUrls'),
    open: document.querySelector('#openViewer'),
    copy: document.querySelector('#copyUrl'),
  });
}
