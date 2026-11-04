// Web Tools Arsenal - 描画用の関数（ブラウザ専用の処理は別途追加する）

const ICON_BODIES = {
  'calendar': '<path d="M8 2v3"></path><path d="M16 2v3"></path><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18"></path>',
  'book-open': '<path d="M12 5v16"></path><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"></path>',
  'timer': '<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle>',
  'heart': '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"></path>',
  'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"></path>',
  'instagram': '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line>',
  'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>',
  'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>',
  'arrow-right': '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
};

export const ICONS = Object.fromEntries(
  Object.entries(ICON_BODIES).map(([name, body]) => [
    name,
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`,
  ])
);

const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"></svg>';

export function iconSvg(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : EMPTY_SVG;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

export function normalizeTools(data) {
  if (!data || !Array.isArray(data.tools)) {
    throw new Error('tools.json の tools が配列ではありません');
  }
  return data.tools.map((t) => ({ ...t, status: t.status ?? 'live', size: t.size ?? 'small' }));
}

export function renderCard(tool) {
  const name = escapeHtml(tool.name);
  const desc = escapeHtml(tool.description);
  const classes = ['card'];
  if (tool.size === 'large') classes.push('card--large');
  const badge = tool.status === 'beta' ? '<span class="badge">β</span>' : '';
  const soonLabel = tool.status === 'soon' ? '<span class="badge badge--soon">Coming soon</span>' : '';
  const inner =
    `<div class="card-icon">${iconSvg(tool.icon)}</div>` +
    `<h2 class="card-title">${name}${badge}</h2>` +
    `<p class="card-desc">${desc}</p>` +
    `<div class="card-arrow">${tool.status === 'soon' ? soonLabel : iconSvg('arrow-right')}</div>`;
  if (tool.status === 'soon' || !isSafeUrl(tool.url)) {
    classes.push('is-soon');
    return `<div class="${classes.join(' ')}" aria-disabled="true">${inner}</div>`;
  }
  return `<a class="${classes.join(' ')}" href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}

// ツールをグループごとに分ける。groups が無い／壊れているときは、全部を1つのグループ（ラベルなし）にする。
export function groupTools(tools, groups) {
  const valid = Array.isArray(groups)
    ? groups.filter((g) => g && typeof g.id === 'string' && g.id && typeof g.label === 'string')
    : [];
  if (valid.length === 0) return [{ id: 'all', label: '', tools: [...tools] }];
  const sections = valid.map((g) => ({ id: g.id, label: g.label, tools: [] }));
  const other = { id: 'other', label: 'その他', tools: [] };
  for (const t of tools) {
    const sec = sections.find((x) => x.id === t.group);
    (sec || other).tools.push(t);
  }
  if (other.tools.length) sections.push(other);
  return sections.filter((x) => x.tools.length > 0);
}

export function renderGroups(sections) {
  return sections
    .map((sec) => {
      const label = sec.label ? `<p class="section-label">${escapeHtml(sec.label)}</p>` : '';
      return `<section class="group">${label}<div class="tool-grid">${sec.tools.map((t) => renderCard(t)).join('')}</div></section>`;
    })
    .join('');
}

export function renderLink(link) {
  const inner =
    `<div class="card-icon">${iconSvg(link.icon)}</div>` +
    `<h2 class="card-title">${escapeHtml(link.name)}</h2>` +
    `<p class="card-handle">${escapeHtml(link.handle)}</p>` +
    `<p class="card-desc">${escapeHtml(link.description)}</p>` +
    `<div class="card-arrow">${iconSvg('arrow-right')}</div>`;
  if (!isSafeUrl(link.url)) {
    return `<div class="card card--link is-soon" aria-disabled="true">${inner}</div>`;
  }
  return `<a class="card card--link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}

export function cleanLinks(data) {
  const list = data && Array.isArray(data.links) ? data.links : [];
  return list.filter((l) => l && typeof l === 'object');
}

export function isStandalone(env) {
  try {
    const mm = env && env.matchMedia;
    if (typeof mm === 'function' && mm.call(env, '(display-mode: standalone)').matches) return true;
  } catch (e) {
    // matchMedia が使えない環境は「通常のブラウザ」として扱う
  }
  try {
    return !!(env && env.navigator && env.navigator.standalone === true);
  } catch (e) {
    return false;
  }
}

function setupA2hs() {
  const box = document.getElementById('a2hs');
  const btn = document.getElementById('a2hs-btn');
  const panel = document.getElementById('a2hs-panel');
  if (!box || !btn || !panel || isStandalone(window)) return;
  box.hidden = false;
  btn.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
}

// カード登場のずらし時間（同時に見えたカードの順番 × stepMs）
export function staggerDelays(count, stepMs = 80) {
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  return Array.from({ length: n }, (_, i) => i * stepMs);
}

// true = 登場演出をせず、すぐ全部見せる（IntersectionObserver が無い／動きを減らす設定）
export function shouldRevealNow(env) {
  try {
    if (!env || typeof env.IntersectionObserver !== 'function') return true;
    if (typeof env.matchMedia === 'function' && env.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    return false;
  } catch (e) {
    return true;
  }
}

// 要素の枠（getBoundingClientRect の結果）が画面の高さと少しでも重なるか
export function isInViewport(rect, viewportHeight) {
  if (!rect || !(viewportHeight > 0)) return false;
  return rect.bottom > 0 && rect.top < viewportHeight;
}

export function bootPlan({ visited, reducedMotion }) {
  if (reducedMotion) return { show: false, totalMs: 0 };
  if (visited) return { show: true, totalMs: 1500 };
  return { show: true, totalMs: 3500 };
}

const VISITED_KEY = 'kwn-arsenal-visited';

export function readVisited() {
  try {
    return localStorage.getItem(VISITED_KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function barOf(n) {
  return '■'.repeat(n) + '□'.repeat(5 - n);
}

export function markVisited() {
  try {
    localStorage.setItem(VISITED_KEY, '1');
  } catch (e) {
    // 保存できない環境では何もしない
  }
}

// ---- ブラウザ専用: 画面の組み立て ----
let skipBoot = null; // 起動アニメを今すぐ終わらせる関数（動いていないときは null）

function wantsReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return false;
  }
}

export async function runBoot() {
  const boot = document.getElementById('boot');
  const plan = bootPlan({ visited: readVisited(), reducedMotion: wantsReducedMotion() });
  if (!boot) { markVisited(); return; }
  if (!plan.show) {
    boot.remove();
    markVisited();
    return;
  }

  const FADE_MS = 200;
  const stepsMs = Math.max(0, plan.totalMs - FADE_MS);
  const text = boot.querySelector('.boot-text');
  const setText = (t) => { if (text) text.textContent = t; };
  boot.hidden = false;
  setText('INITIALIZING...');

  let finished = false;
  let wake = null;
  const timers = [];
  const wait = (ms) => new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    timers.push(id);
    wake = resolve;
  });
  const onKey = (e) => { if (e.key === 'Enter') skip(); };
  function skip() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    if (wake) wake();
  }
  skipBoot = skip;
  boot.addEventListener('click', skip);
  document.addEventListener('keydown', onKey);

  // 待ち時間を割り振る: INITIALIZING 30% / LOADING 55%（4マス） / READY 15%
  await wait(stepsMs * 0.3);
  if (!finished) {
    const per = (stepsMs * 0.55) / 4;
    for (let n = 1; n <= 4 && !finished; n++) {
      setText('LOADING TOOLS [' + barOf(n) + ']');
      await wait(per);
    }
  }
  if (!finished) {
    setText('READY');
    await wait(stepsMs * 0.15);
  }
  if (!finished) {
    boot.classList.add('is-leaving');
    await wait(FADE_MS);
  }

  finished = true;
  skipBoot = null;
  boot.removeEventListener('click', skip);
  document.removeEventListener('keydown', onKey);
  boot.remove();
  markVisited();
}

async function loadTools() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('tools.json', { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return { data, tools: normalizeTools(data) };
  } finally {
    clearTimeout(timer);
  }
}

export async function init() {
  const grid = document.getElementById('grid');
  const links = document.getElementById('links');
  grid.innerHTML = '<p class="empty">読み込み中…</p>';
  // 読み込みは起動アニメと同時に始める。失敗したらアニメを切り上げてエラーを見せる。
  const loading = loadTools().then(
    (v) => ({ ok: true, v }),
    () => { if (skipBoot) skipBoot(); return { ok: false }; }
  );
  await runBoot();
  const r = await loading;
  if (!r.ok) {
    grid.innerHTML = '<p role="alert">読み込めませんでした</p>';
    links.innerHTML = '';
    return;
  }
  const { data, tools } = r.v;
  if (tools.length === 0) {
    grid.innerHTML = '<p class="empty">ツールがありません</p>';
  } else {
    grid.innerHTML = renderGroups(groupTools(tools, data.groups));
  }
  links.innerHTML = cleanLinks(data).map((l) => renderLink(l)).join('');
  setupReveal();
}

// カードは画面に入った瞬間に登場させる。どこかで失敗したら全部すぐ見せる。
function setupReveal() {
  const cards = Array.from(document.querySelectorAll('#grid .card, #links .card'));
  if (cards.length === 0 || shouldRevealNow(window)) return;
  try {
    cards.forEach((el) => el.classList.add('will-reveal'));
    const io = new IntersectionObserver((entries) => {
      try {
        const seen = entries.filter((e) => e.isIntersecting);
        const delays = staggerDelays(seen.length);
        seen.forEach((e, i) => {
          e.target.style.setProperty('--d', delays[i] + 'ms');
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
      } catch (err) {
        cards.forEach((el) => el.classList.add('is-in'));
        io.disconnect();
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    cards.forEach((el) => io.observe(el));
    // 最後の砦: observer が一度も動かなくても、画面内のカードは隠れたままにしない
    setTimeout(() => {
      try {
        const vh = window.innerHeight || document.documentElement.clientHeight;
        cards.forEach((el) => {
          if (el.classList.contains('will-reveal') && !el.classList.contains('is-in') && isInViewport(el.getBoundingClientRect(), vh)) {
            el.classList.add('is-in');
          }
        });
      } catch (err) {
        cards.forEach((el) => el.classList.add('is-in'));
      }
    }, 4000);
  } catch (e) {
    cards.forEach((el) => el.classList.remove('will-reveal'));
  }
}

if (typeof document !== 'undefined') {
  setupA2hs();
  init();
}
