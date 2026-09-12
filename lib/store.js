// State store for the overlay. Pure logic, no HTTP.
import fs from 'node:fs';

export const SCENES = ['clean', 'info', 'chapter', 'soon', 'brb'];
// Gameplay scenes are transparent overlays on top of the game capture.
export const GAMEPLAY_SCENES = ['clean', 'info', 'chapter'];
// Timed scenes hide themselves after their hold time.
export const TIMED_SCENES = ['chapter'];

// Settle time of the entrance animation, added before the hold starts.
const ENTRANCE_MS = { chapter: 1300 };

// The 9 chapters of the base game. Objectives are short, own wording.
export const CHAPTERS = [
  { n: 1, title: 'Dead in the Water', objective: 'Lái thuyền qua bãi mìn vào bờ. Tìm em gái và chạy khỏi con quái nghe tiếng.' },
  { n: 2, title: 'The Cleaning House', objective: 'Lẻn qua thị trấn ngập nước và rạp phim bỏ hoang. Cứu bạn rồi chạy bằng xe kem.' },
  { n: 3, title: 'After the Flood', objective: 'Đi thuyền qua vùng biển ngập. Dùng móc câu mở đường, cứu bạn ở hải đăng.' },
  { n: 4, title: 'No Shelter', objective: 'Vào tháp đồng hồ. Đập tượng, đánh lũ chuột và đối mặt với Vua.' },
  { n: 5, title: 'Down in a Hole', objective: 'Buộc dây với nhau, cầm đèn đi qua hang tối. Đánh nhện khổng lồ.' },
  { n: 6, title: 'Nobody Left Behind', objective: 'Bắn pháo vào đảo. Mặc đồ lặn xuống nước lấy đồ từ quái vật biển.' },
  { n: 7, title: 'The Spoils', objective: 'Bò qua chiến hào dưới làn đạn. Tìm đồ giấu sau tường bí mật.' },
  { n: 8, title: 'The Watcher', objective: 'Bị bắn tỉa trong thị trấn đầy sương. Nấp sau xe để tiến lên.' },
  { n: 9, title: 'All-Consuming Past', objective: 'Lái xe tăng phá đường. Đối mặt con quái cuối và kết thúc hành trình.' },
];

export function defaultState() {
  return {
    revision: 0,
    nonce: 0,
    scene: 'clean',
    returnTo: 'clean',
    live: true,
    theme: { accent: '#C8A76A', grain: 0.055 },
    info: {
      title: 'Reanimal',
      kicker: 'Kinh dị nhưng có hy vọng',
      main: 'Hai anh em bước vào\nmột thế giới đổ nát',
      secondary: 'để tìm những người bạn mất tích.',
      meta: 'Game kinh dị chơi chung',
    },
    chapter: { label: 'Chương 1', title: CHAPTERS[0].title, objective: CHAPTERS[0].objective, holdMs: 6000 },
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

export function createStore({ file, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let state = defaultState();
  let timer = null;
  const listeners = new Set();

  if (file && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = deepMerge(state, saved);
      // Never resume on a timed or unknown scene after a restart.
      if (TIMED_SCENES.includes(state.scene) || !SCENES.includes(state.scene)) state.scene = state.returnTo || 'clean';
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

  function armTimer(scene) {
    if (timer) clearTimer(timer);
    timer = null;
    if (!TIMED_SCENES.includes(scene)) return;
    const hold = Number(state[scene]?.holdMs) || 0;
    timer = setTimer(() => {
      timer = null;
      if (state.scene !== scene) return;
      commit({ ...state, scene: state.returnTo || 'clean' });
    }, ENTRANCE_MS[scene] + hold);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  // Show the chapter after the one on the card. Wraps to chapter 1.
  function nextChapter() {
    const i = CHAPTERS.findIndex((c) => c.title === state.chapter.title);
    const ch = CHAPTERS[(i + 1) % CHAPTERS.length];
    return api.show('chapter', { label: `Chương ${ch.n}`, title: ch.title, objective: ch.objective });
  }

  const api = {
    get: () => state,
    nextChapter,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Merge data without changing the scene. Used for live text edits.
    patch(patch) {
      const { scene, revision, nonce, returnTo, ...rest } = patch || {};
      return commit(deepMerge(state, rest));
    },
    // Switch scene. Bumps the nonce so the viewer replays the entrance.
    show(scene, data) {
      if (!SCENES.includes(scene)) throw new Error(`unknown scene: ${scene}`);
      let next = data ? deepMerge(state, { [scene]: data }) : { ...state };
      // Remember where a timed scene returns to.
      let returnTo = state.returnTo;
      if (TIMED_SCENES.includes(scene) && !TIMED_SCENES.includes(state.scene)) {
        returnTo = GAMEPLAY_SCENES.includes(state.scene) ? state.scene : 'clean';
      }
      next = { ...next, scene, returnTo, nonce: state.nonce + 1 };
      const result = commit(next);
      armTimer(scene);
      return result;
    },
  };
  return api;
}
