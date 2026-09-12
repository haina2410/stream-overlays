// Viewer renderer. Builds a scene from state, plays exits and entrances.
const FULL_SCENES = new Set(['soon', 'brb']);
const EXIT_MS = { info: 700, chapter: 720, soon: 600, brb: 600, clean: 0 };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const el = (tag, cls, html, attrs = {}) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const tally = (state) => (state.live
  ? el('div', 'abs tally', `<span class="dot"></span><span class="label">Live</span><span class="sep"></span><span class="clock" data-time>${timeNow()}</span><span class="sep"></span><span class="partner" data-bind="partner">${esc(state.partner)}</span>`)
  : null);

function timeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// One ticker for every clock on the page.
setInterval(() => {
  for (const n of document.querySelectorAll('[data-time]')) n.textContent = timeNow();
}, 1000);

const builders = {
  clean(state) {
    // No full-frame vignette on gameplay. Dark washes sit only behind text.
    return [el('div', 'grain'), tally(state)];
  },
  info(state) {
    const d = state.info;
    const box = el('div', 'abs info-box');
    box.append(
      el('div', 'info-word', `${esc(d.title)}<span class="sweep"></span>`, { 'data-text': '', 'data-bind': 'info.title', 'data-keep': '' }),
      el('div', 'kicker info-kicker', esc(d.kicker), { 'data-text': '', 'data-bind': 'info.kicker' }),
      el('div', 'info-main', esc(d.main), { 'data-text': '', 'data-bind': 'info.main' }),
      el('div', 'info-secondary', esc(d.secondary), { 'data-text': '', 'data-bind': 'info.secondary' }),
      el('div', 'info-meta', `<span class="bar"></span><span class="txt" data-bind="info.meta">${esc(d.meta)}</span>`, { 'data-text': '' }),
    );
    return [el('div', 'grain'), el('div', 'abs info-haze', null, { 'data-haze': '' }), box, tally(state)];
  },
  chapter(state) {
    const d = state.chapter;
    const box = el('div', 'abs chapter-box');
    box.append(
      el('div', 'kicker chapter-label', esc(d.label), { 'data-text': '', 'data-bind': 'chapter.label' }),
      el('div', 'chapter-title', esc(d.title), { 'data-text': '', 'data-bind': 'chapter.title' }),
      el('div', 'rule chapter-rule', null, { 'data-text': '' }),
      el('div', 'chapter-objective', esc(d.objective), { 'data-text': '', 'data-bind': 'chapter.objective' }),
    );
    return [el('div', 'grain'), el('div', 'abs chapter-wash', null, { 'data-haze': '' }), box, tally(state)];
  },
  soon(state) {
    const d = state.soon;
    const center = el('div', 'abs soon-center');
    center.append(
      el('div', 'soon-kicker', esc(d.kicker), { 'data-text': '', 'data-bind': 'soon.kicker' }),
      el('div', 'soon-word', esc(d.title), { 'data-text': '', 'data-bind': 'soon.title' }),
      el('div', 'soon-line', esc(d.line), { 'data-text': '', 'data-bind': 'soon.line' }),
      el('div', 'soon-partner', esc(state.partner), { 'data-text': '', 'data-bind': 'partner' }),
    );
    const count = el('div', 'abs soon-count', `<span class="lbl" data-bind="soon.countLabel">${esc(d.countLabel)}</span><span class="clock" data-clock>--:--</span>`, { 'data-text': '' });
    return [
      el('div', 'abs soon-base'),
      el('div', 'abs soon-fog'),
      el('div', 'abs soon-floor'),
      el('div', 'abs soon-horizon'),
      el('div', 'abs lantern-big'),
      center,
      count,
      el('div', 'grain'),
      el('div', 'vignette deep'),
    ];
  },
  brb(state) {
    const d = state.brb;
    const box = el('div', 'abs brb-box');
    box.append(
      el('div', 'brb-head', esc(d.headline), { 'data-text': '', 'data-bind': 'brb.headline' }),
      el('div', 'rule brb-rule', null, { 'data-text': '' }),
      el('div', 'brb-sub', esc(d.sub), { 'data-text': '', 'data-bind': 'brb.sub' }),
    );
    return [
      el('div', 'abs brb-base'),
      el('div', 'abs brb-fog'),
      el('div', 'abs lantern-small'),
      box,
      el('div', 'grain'),
      el('div', 'vignette brb'),
    ];
  },
};

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function createViewer(stage) {
  let current = null; // { scene, nonce, node }
  let state = null;
  let clockTimer = null;

  function applyTheme(s) {
    const r = document.documentElement.style;
    r.setProperty('--accent', s.theme?.accent || '#C8A76A');
    r.setProperty('--grain', String(s.theme?.grain ?? 0.055));
  }

  function mount(s) {
    const node = el('div', `scene scene-${s.scene}${FULL_SCENES.has(s.scene) ? ' full' : ''}`);
    for (const child of builders[s.scene](s)) if (child) node.append(child);
    stage.append(node);
    current = { scene: s.scene, nonce: s.nonce, node };
    tickClock();
  }

  function exit(entry) {
    const { node, scene } = entry;
    const texts = [...node.querySelectorAll('[data-text]')].reverse();
    texts.forEach((t, i) => { t.style.transitionDelay = `${i * 40}ms`; });
    node.classList.add('is-exiting');
    setTimeout(() => node.remove(), EXIT_MS[scene] || 600);
  }

  // Patch text in place without replaying the entrance.
  function patch(s) {
    if (!current) return;
    for (const n of current.node.querySelectorAll('[data-bind]')) {
      const v = getPath(s, n.getAttribute('data-bind'));
      const keep = n.hasAttribute('data-keep') ? n.querySelector('.sweep') : null;
      if (n.textContent !== String(v ?? '')) {
        n.textContent = v ?? '';
        if (keep) n.append(keep);
      }
    }
    const tallyNode = current.node.querySelector('.tally');
    if (s.live && !tallyNode && !FULL_SCENES.has(s.scene)) current.node.append(tally(s));
    if (!s.live && tallyNode) tallyNode.remove();
  }

  function tickClock() {
    clearInterval(clockTimer);
    clockTimer = null;
    if (!current || current.scene !== 'soon') return;
    const clock = current.node.querySelector('[data-clock]');
    const update = () => {
      const at = state?.soon?.startAt;
      if (!at) { clock.textContent = '--:--'; return; }
      const left = Math.max(0, Math.round((at - Date.now()) / 1000));
      const m = String(Math.floor(left / 60)).padStart(2, '0');
      const sec = String(left % 60).padStart(2, '0');
      clock.textContent = `${m}:${sec}`;
    };
    update();
    clockTimer = setInterval(update, 250);
  }

  return {
    update(next) {
      state = next;
      applyTheme(next);
      if (!current) { mount(next); return; }
      if (current.nonce !== next.nonce || current.scene !== next.scene) {
        exit(current);
        current = null;
        mount(next);
        return;
      }
      patch(next);
    },
  };
}
