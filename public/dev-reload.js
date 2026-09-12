export function shouldReload(previousGeneration, status) {
  return Boolean(
    status.enabled
      && previousGeneration
      && previousGeneration !== status.generation,
  );
}

export function createDevReloadWatcher({ getStatus, reload, schedule = setTimeout }) {
  let generation = null;
  const watcher = {
    async poll() {
      try {
        const status = await getStatus();
        if (shouldReload(generation, status)) {
          reload();
          return;
        }
        if (!status.enabled) return;
        generation = status.generation;
      } catch {
        // The server is briefly unavailable while Node restarts it.
      }
      schedule(watcher.poll, 500);
    },
  };
  return watcher;
}

if (typeof window !== 'undefined') {
  const watcher = createDevReloadWatcher({
    getStatus: async () => {
      const response = await window.fetch('/api/dev', { cache: 'no-store' });
      if (!response.ok) throw new Error(`dev status returned ${response.status}`);
      return response.json();
    },
    reload: () => window.location.reload(),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
  });
  void watcher.poll();
}
