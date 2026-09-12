// State store for the overlay. Pure logic, no HTTP.
import fs from 'node:fs';

export const SCENES = ['clean', 'info', 'soon', 'brb'];

export function defaultState() {
  return {
    revision: 0,
    nonce: 0,
    scene: 'clean',
    live: true,
    theme: { accent: '#C8A76A', grain: 0.055 },
    info: {
      title: 'Reanimal',
      kicker: 'Kinh dị nhưng có hy vọng',
      main: 'Hai anh em bước vào\nmột thế giới đổ nát',
      secondary: 'để tìm những người bạn mất tích.',
      meta: 'Game kinh dị chơi chung',
    },
    soon: {
      kicker: 'Sắp bắt đầu',
      title: 'Reanimal',
      line: 'Không ai phải đi một mình.',
      countLabel: 'Còn',
      startAt: null,
    },
    brb: { headline: 'Đừng đi đâu.', sub: 'Mình quay lại ngay.' },
  };
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

export function createStore({ file } = {}) {
  let state = defaultState();
  const listeners = new Set();

  if (file && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = deepMerge(state, saved);
      if (!SCENES.includes(state.scene)) state.scene = 'clean';
    } catch (err) {
      console.error(`could not read ${file}:`, err.message);
    }
  }

  function persist() {
    if (!file) return;
    fs.writeFile(file, JSON.stringify(state, null, 2), (err) => {
      if (err) console.error(`could not write ${file}:`, err.message);
    });
  }

  function commit(next) {
    state = { ...next, revision: state.revision + 1 };
    persist();
    for (const fn of listeners) fn(state);
    return state;
  }

  return {
    get: () => state,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Merge data without changing the scene. Used for live text edits.
    patch(patch) {
      const { scene, revision, nonce, ...rest } = patch || {};
      return commit(deepMerge(state, rest));
    },
    // Switch scene. Bumps the nonce so the viewer replays the entrance.
    show(scene, data) {
      if (!SCENES.includes(scene)) throw new Error(`unknown scene: ${scene}`);
      const next = data ? deepMerge(state, { [scene]: data }) : { ...state };
      return commit({ ...next, scene, nonce: state.nonce + 1 });
    },
  };
}
