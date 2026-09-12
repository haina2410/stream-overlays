// State store for the overlay. Pure logic, no HTTP.

export const SCENES = ['clean', 'info', 'chapter', 'soon', 'brb'];
// Gameplay scenes are transparent overlays on top of the game capture.
export const GAMEPLAY_SCENES = ['clean', 'info', 'chapter'];
// Timed scenes hide themselves after their hold time.
export const TIMED_SCENES = ['chapter'];

// Settle time of the entrance animation, added before the hold starts.
const ENTRANCE_MS = { chapter: 1300 };

// The 9 chapters of the base game. Objectives are short, own wording.
export const CHAPTERS = [
  { n: 1, title: 'Dead in the Water', objective: 'Con thuyền nhỏ trôi qua bãi mìn trong đêm. Bờ bên kia có em gái đang chờ, và một thứ gì đó đang lắng nghe.' },
  { n: 2, title: 'The Cleaning House', objective: 'Thị trấn chìm trong nước, rạp phim không còn khán giả. Một người bạn bị giữ ở đâu đó trong này.' },
  { n: 3, title: 'After the Flood', objective: 'Biển đã nuốt hết đường về. Ngọn hải đăng xa xa vẫn sáng, như đang gọi hai đứa trẻ tới.' },
  { n: 4, title: 'No Shelter', objective: 'Tháp đồng hồ đã ngừng chạy từ lâu. Dưới chân nó, có kẻ tự xưng là Vua đang đợi.' },
  { n: 5, title: 'Down in a Hole', objective: 'Một sợi dây, một ngọn đèn, hai anh em bước xuống lòng đất. Bóng tối ở đây có tám chân.' },
  { n: 6, title: 'Nobody Left Behind', objective: 'Ngoài khơi có một hòn đảo, dưới đáy biển có một bí mật. Không ai bị bỏ lại, dù phải lặn sâu tới đâu.' },
  { n: 7, title: 'The Spoils', objective: 'Chiến hào cũ, đạn vẫn bay. Giữa bùn và sương, những mảnh ký ức bị chôn dưới bức tường giả.' },
  { n: 8, title: 'The Watcher', objective: 'Có ai đó dõi theo từ trên cao. Mỗi bước qua con phố mù sương đều nằm trong tầm ngắm.' },
  { n: 9, title: 'All-Consuming Past', objective: 'Quá khứ không chịu nằm yên. Chuyến đi cuối cùng, và câu trả lời cho tất cả.' },
];

export function defaultState() {
  return {
    revision: 0,
    nonce: 0,
    scene: 'clean',
    returnTo: 'clean',
    live: true,
    partner: 'with @mvy.libr',
    theme: { accent: '#C8A76A', grain: 0.055 },
    info: {
      title: 'Reanimal',
      kicker: 'Tăm tối và loạn lạc',
      main: 'Hai anh em bước vào\nmột thế giới đổ nát',
      secondary: 'để tìm những người bạn mất tích.',
      meta: 'co-op horror',
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
    // Rotation between gameplay scenes. Seconds per step, each step can be off.
    loop: {
      enabled: false,
      index: 0,
      steps: [
        { scene: 'clean', sec: 60, on: true },
        { scene: 'info', sec: 12, on: true },
        { scene: 'chapter', sec: 8, on: true },
      ],
    },
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

export function createStore({ initialState, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let state = deepMerge(defaultState(), initialState || {});
  let timer = null;
  let loopTimer = null;
  const listeners = new Set();

  // Never resume on a timed or unknown scene after a restart.
  if (TIMED_SCENES.includes(state.scene) || !SCENES.includes(state.scene)) state.scene = state.returnTo || 'clean';

  // Resume the loop after a restart.
  if (state.loop.enabled) {
    const first = state.loop.steps.map((st, i) => ({ ...st, i })).find((st) => st.on && st.sec > 0);
    if (first) {
      state = { ...state, scene: first.scene, loop: { ...state.loop, index: first.i } };
      loopTimer = setTimer(loopTick, first.sec * 1000);
      if (loopTimer && typeof loopTimer.unref === 'function') loopTimer.unref();
    } else {
      state.loop.enabled = false;
    }
  }

  function commit(next) {
    state = { ...next, revision: state.revision + 1 };
    for (const fn of listeners) fn(state);
    return state;
  }

  function armTimer(scene) {
    if (timer) clearTimer(timer);
    timer = null;
    // The loop owns scene changes while it runs.
    if (state.loop.enabled) return;
    if (!TIMED_SCENES.includes(scene)) return;
    const hold = Number(state[scene]?.holdMs) || 0;
    timer = setTimer(() => {
      timer = null;
      if (state.scene !== scene) return;
      commit({ ...state, scene: state.returnTo || 'clean' });
    }, ENTRANCE_MS[scene] + hold);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  // ---- Loop
  function activeSteps() {
    return state.loop.steps.map((st, i) => ({ ...st, i })).filter((st) => st.on && SCENES.includes(st.scene) && st.sec > 0);
  }

  function clearLoopTimer() {
    if (loopTimer) clearTimer(loopTimer);
    loopTimer = null;
  }

  function armLoopTimer() {
    clearLoopTimer();
    const step = state.loop.steps[state.loop.index];
    if (!state.loop.enabled || !step) return;
    loopTimer = setTimer(loopTick, Math.max(1, Number(step.sec) || 0) * 1000);
    if (loopTimer && typeof loopTimer.unref === 'function') loopTimer.unref();
  }

  // Move to the next active step and show it.
  function loopTick() {
    loopTimer = null;
    const steps = activeSteps();
    if (!state.loop.enabled || steps.length === 0) return;
    const next = steps.find((st) => st.i > state.loop.index) || steps[0];
    commit({ ...state, scene: next.scene, nonce: state.nonce + 1, loop: { ...state.loop, index: next.i } });
    armLoopTimer();
  }

  // Merge loop settings. Turning it on starts from the current scene when possible.
  function setLoop(patch) {
    const loop = deepMerge(state.loop, patch || {});
    const steps = loop.steps.map((st, i) => ({ ...st, i })).filter((st) => st.on && st.sec > 0);
    if (loop.enabled && steps.length === 0) loop.enabled = false;
    if (loop.enabled) {
      const cur = steps.find((st) => st.scene === state.scene) || steps[0];
      loop.index = cur.i;
      if (timer) clearTimer(timer);
      timer = null;
      const sameScene = state.scene === cur.scene;
      commit({ ...state, loop, scene: cur.scene, nonce: sameScene ? state.nonce : state.nonce + 1 });
      armLoopTimer();
    } else {
      clearLoopTimer();
      commit({ ...state, loop });
      armTimer(state.scene);
    }
    return state;
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
    setLoop,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Merge data without changing the scene. Used for live text edits.
    patch(patch) {
      const { scene, revision, nonce, returnTo, loop, ...rest } = patch || {};
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
      if (state.loop.enabled) {
        const step = activeSteps().find((st) => st.scene === scene);
        if (step) {
          // Manual pick of a loop scene: jump the loop to that step.
          next = { ...next, loop: { ...next.loop, index: step.i } };
          const result = commit(next);
          armLoopTimer();
          return result;
        }
        // A scene outside the loop pauses it.
        clearLoopTimer();
        next = { ...next, loop: { ...next.loop, enabled: false } };
      }
      const result = commit(next);
      armTimer(scene);
      return result;
    },
  };
  return api;
}
