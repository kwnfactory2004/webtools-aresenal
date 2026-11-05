// Web Tools Arsenal - 描画用の関数（ブラウザ専用の処理は別途追加する）
import { buildSwarmPlan, runSwarm, swarmCount, statusAt, stageOf, PHASE, STAGE_TEXT } from './swarm.js';

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

// 文字を1文字ずつに分ける（絵文字などのサロゲートペアも1文字として扱う）
export function splitChars(text) {
  return Array.from(String(text ?? ''));
}

// 打ち込みの計画。texts[0] は見出し（速め）、残りは本文。各文字の開始ms・1文字の幅・全体の時間を返す。
// 全体が maxTotalMs を超えるときは、1文字あたりの間隔を縮める。
export function typingPlan(texts, { titleMs = 35, bodyMs = 18, maxTotalMs = 1400 } = {}) {
  const lists = (Array.isArray(texts) ? texts : []).map(splitChars);
  const stepOf = (k) => (k === 0 ? titleMs : bodyMs);
  const raw = lists.reduce((sum, chars, k) => sum + chars.length * stepOf(k), 0);
  const scale = raw > maxTotalMs ? maxTotalMs / raw : 1;
  let t = 0;
  const delays = [];
  const widths = [];
  lists.forEach((chars, k) => {
    const step = stepOf(k) * scale;
    const base = t;
    delays.push(chars.map((_, i) => base + i * step));
    widths.push(chars.map(() => step));
    t += chars.length * step;
  });
  return { delays, widths, totalMs: Math.min(t, maxTotalMs) };
}

export function bootPlan({ visited, reducedMotion }) {
  if (reducedMotion) return { show: false, totalMs: 0 };
  // 初回も2回目以降も、同じ長さのフル演出（visited は互換のため受け取るだけ）
  void visited;
  return { show: true, totalMs: 7000 };
}

// 起動の状態バーの段階（swarm.js の PHASE と同じ割合）。
// SCANNING PAGE... 0〜17% / BUILDING LAYOUT 17〜46% / FILLING CONTENT 46〜86% / READY 86%〜（93%からフェード）
export function bootStage(tMs, totalMs) {
  const p = totalMs > 0 ? Math.min(1, Math.max(0, (Number(tMs) || 0) / totalMs)) : 1;
  return { text: STAGE_TEXT[stageOf(p)], leaving: p >= PHASE.leave };
}

// 状態バーの数字の表示（例: 34 agents · 87 / 128 layers）
export function bootCounts(status) {
  const s = status || {};
  const n = (v) => Math.max(0, Math.floor(Number(v)) || 0);
  return n(s.agents) + ' agents · ' + n(s.layers) + ' / ' + n(s.totalLayers) + ' layers';
}

// 起動演出の後始末で、どのカードを今すぐ見せるか（純粋）。states: [{ revealed, inView }]
// mode: 'skip' / 'error' = まだ出ていない全部を演出なしで。'done' = 画面内の残りを普通の登場で。
// 'interrupt'（スクロール・リサイズ）= 画面内の残りを演出なしで。戻り値: [{ index, animate }]
export function cardsToRevealNow(states, mode) {
  const list = Array.isArray(states) ? states : [];
  const everything = mode === 'skip' || mode === 'error' || mode === 'fatal';
  const out = [];
  list.forEach((s, index) => {
    if (!s || s.revealed) return;
    if (everything || s.inView) out.push({ index, animate: mode === 'done' });
  });
  return out;
}

const VISITED_KEY = 'kwn-arsenal-visited';

export function readVisited() {
  try {
    return localStorage.getItem(VISITED_KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function markVisited() {
  try {
    localStorage.setItem(VISITED_KEY, '1');
  } catch (e) {
    // 保存できない環境では何もしない
  }
}


// ---- ブラウザ専用: 画面の組み立て ----
function wantsReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return false;
  }
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

const TYPE_START_MS = 150; // カードのふわっとした登場のあとに打ち始める
const activeTypings = new Set(); // 打ち込み途中のカードを元の文字に戻す関数（スキップ用）

// 打ち込み対象の文字（見出し・ハンドル・説明の、文字だけのノード）
function cardJobs(card) {
  const jobs = [];
  if (card.classList.contains('is-soon')) return jobs;
  card.querySelectorAll('.card-title, .card-handle, .card-desc').forEach((el) => {
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeType === 3 && node.data.trim()) jobs.push({ el, node, text: node.data, wrap: null });
    });
  });
  return jobs;
}

// カード内の文字を1文字ずつ打ち込む。分割は再生中だけで、終わったら元の文字に戻す。
function typeCard(card) {
  const jobs = cardJobs(card);
  if (jobs.length === 0) return;
  const restore = () => {
    jobs.forEach((j) => {
      if (j.wrap && j.wrap.parentNode === j.el) j.el.replaceChild(j.node, j.wrap);
      j.wrap = null;
    });
    activeTypings.delete(restore);
  };
  try {
    const plan = typingPlan(jobs.map((j) => j.text));
    jobs.forEach((j, k) => {
      const wrap = document.createElement('span');
      wrap.className = 'typed';
      const vis = document.createElement('span');
      vis.className = 'typed-vis';
      vis.setAttribute('aria-hidden', 'true');
      splitChars(j.text).forEach((c, i) => {
        const ch = document.createElement('span');
        ch.className = 'ch';
        ch.textContent = c;
        ch.style.setProperty('--t', (TYPE_START_MS + plan.delays[k][i]) + 'ms');
        ch.style.setProperty('--w', plan.widths[k][i] + 'ms');
        if (k === jobs.length - 1 && i === plan.delays[k].length - 1) ch.classList.add('ch-last');
        vis.appendChild(ch);
      });
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = j.text;
      wrap.append(vis, sr);
      j.el.replaceChild(wrap, j.node);
      j.wrap = wrap;
    });
    activeTypings.add(restore);
    const d = parseFloat(card.style.getPropertyValue('--d')) || 0;
    setTimeout(restore, d + TYPE_START_MS + plan.totalMs + 600);
  } catch (e) {
    restore();
  }
}

function restoreAllTypings() {
  Array.from(activeTypings).forEach((fn) => fn());
}

function revealCard(card) {
  card.classList.add('is-in');
  typeCard(card);
}

// 演出なしで、すぐ見せる（スキップ用）
function revealNow(card) {
  if (card.classList.contains('is-in')) return;
  card.classList.add('no-anim', 'is-in');
}

// ---- 群れの目標（カードの位置）を測る ----
function textBox(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    return rects;
  } catch (e) {
    return [];
  }
}

const toBox = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
// 複数の矩形をまとめた外枠
function unionBox(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return { x: left, y: top, w: Math.max(...rects.map((r) => r.right)) - left, h: Math.max(...rects.map((r) => r.bottom)) - top };
}

// カードの設計図: 外枠＋中の部品（アイコン・見出し・本文）＋打ち込みのハイライト用の文字の矩形
function describeTarget(card, id) {
  const target = { id, kind: 'card', rect: toBox(card.getBoundingClientRect()) };
  try {
    const parts = [];
    const icon = card.querySelector('.card-icon');
    if (icon) parts.push(toBox(icon.getBoundingClientRect()));
    const titleEl = card.querySelector('.card-title');
    const tr = titleEl ? textBox(titleEl) : [];
    if (tr.length) {
      target.title = unionBox(tr);
      parts.push(target.title);
    }
    // 本文（ハンドル → 説明の順。打ち込みと同じ順番）の行ごとの矩形
    const body = [];
    card.querySelectorAll('.card-handle, .card-desc').forEach((el) => {
      const rs = textBox(el);
      const u = unionBox(rs);
      if (u) parts.push(u);
      rs.forEach((r) => body.push(toBox(r)));
    });
    if (body.length) target.body = body;
    target.parts = parts;
    const descEl = card.querySelector('.card-desc');
    const dr = descEl ? textBox(descEl) : [];
    if (dr.length) {
      const last = dr[dr.length - 1];
      target.descEnd = { x: last.right, y: last.top };
    }
    const tp = typingPlan(cardJobs(card).map((j) => j.text));
    const first = tp.delays[0];
    target.typing = {
      titleMs: first && first.length ? first[first.length - 1] + tp.widths[0][first.length - 1] : 0,
      totalMs: tp.totalMs,
    };
  } catch (e) {
    // 測れないときは、カードの枠だけで計画する
  }
  return target;
}

// 見出し・ラベルなどの設計図: 文字の部分だけの外枠（画像は要素の枠）
function describeLabel(el, id) {
  const box = el.tagName === 'IMG' ? null : unionBox(textBox(el));
  return { id, kind: 'label', rect: box || toBox(el.getBoundingClientRect()) };
}

// 起動演出で組み立てる部品（ヘッダー・グループラベル・カード）。ページの表示順で、画面に見えているものだけ
const INTRO_SELECTOR = '.site-logo, .site-brand, .site-title, .section-label, #grid .card, #links .card';
function introElements() {
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return Array.from(document.querySelectorAll(INTRO_SELECTOR)).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && isInViewport(r, vh) && r.right > 0 && r.left < vw;
  });
}

// 起動中だけ、ヘッダーとラベルを隠す（設計図→中身の順に出す）。外すと全部見える
function setBooting(on) {
  try { document.documentElement.classList.toggle('is-booting', !!on); } catch (e) { /* 何もしない */ }
}
function removeBoot(boot) {
  try { if (boot) boot.remove(); } catch (e) { /* 次へ */ }
  setBooting(false);
}

function canvasUsable(canvas) {
  try {
    return !!(canvas && typeof canvas.getContext === 'function' && canvas.getContext('2d'));
  } catch (e) {
    return false;
  }
}

const randomSeed = () => Math.floor(Math.random() * 2147483647);

// 使い終わった canvas は大きさ0にして隠す（常時の全画面レイヤーを残さない）。次に使うときに runSwarm が大きさを付け直す
function releaseCanvas(canvas) {
  try {
    if (canvas) { canvas.width = 0; canvas.height = 0; canvas.hidden = true; }
  } catch (e) {
    // 何もしない
  }
}

// #boot の中にフォーカスがあったまま外すと body に落ちるので、見えているものへ移す
function moveFocusToPage(cards) {
  try {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const first = cards.find((el) => el.tagName === 'A' && el.classList.contains('is-in') && isInViewport(el.getBoundingClientRect(), vh));
    const target = first || document.querySelector('.site-title');
    if (!target) return;
    if (!first && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  } catch (e) {
    // 何もしない
  }
}

let activeIntroEnd = null; // 起動演出を今すぐ終える関数（動いていないときは null）

// 何があっても最後に「全カードが見える・#boot が無い」状態にする
function forceAllVisible(boot, cards) {
  try { if (activeIntroEnd) activeIntroEnd('error'); } catch (e) { /* 次へ */ }
  try { restoreAllTypings(); } catch (e) { /* 次へ */ }
  try { cards.forEach(revealNow); } catch (e) { /* 次へ */ }
  try { releaseCanvas(document.getElementById('swarm')); } catch (e) { /* 次へ */ }
  removeBoot(boot);
}

// ---- 起動演出: カーソルの群れが、設計図 → 中身の順にページを組み立てる。状態バーも同じ時計（runSwarm）で進める ----
// 終わる（または途中でやめる）と resolve。#boot はここで取り除く。
function runIntro(boot, cards, totalMs) {
  return new Promise((resolve) => {
    const text = boot.querySelector('.boot-text');
    const countEl = boot.querySelector('.boot-count');
    const dots = Array.from(boot.querySelectorAll('.boot-dot'));
    const canvas = document.getElementById('swarm');
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const startScroll = window.scrollY || 0;
    const ctrl = new AbortController();
    let ended = false;
    let lastText = '';
    let lastCount = '';
    let lastDots = -1;
    const skipBtn = boot.querySelector('.boot-skip');
    // 透明なカードにフォーカスが乗らないよう、演出中だけ Tab の順番から外す
    const tabbed = [];
    cards.forEach((el) => {
      if (!el.classList.contains('is-in') && !el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '-1'); tabbed.push(el); }
    });
    activeIntroEnd = (mode) => end(mode);
    const setText = (t) => { if (text && t !== lastText) { text.textContent = t; lastText = t; } };
    const setCount = (t) => { if (countEl && t !== lastCount) { countEl.textContent = t; lastCount = t; } };
    const setDots = (n) => {
      if (n === lastDots) return;
      lastDots = n;
      dots.forEach((d, i) => d.classList.toggle('is-on', i < n));
    };
    const fadeMs = Math.round(totalMs * (1 - PHASE.leave));
    boot.style.setProperty('--boot-fade', fadeMs + 'ms');
    setText(STAGE_TEXT.scan);

    function end(mode) {
      if (ended) return;
      ended = true;
      activeIntroEnd = null;
      ctrl.abort();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      const focusWasInBoot = boot.contains(document.activeElement);
      try {
        if (mode === 'skip' || mode === 'error') restoreAllTypings();
        const vh2 = window.innerHeight || document.documentElement.clientHeight;
        const states = cards.map((el) => ({ revealed: el.classList.contains('is-in'), inView: isInViewport(el.getBoundingClientRect(), vh2) }));
        cardsToRevealNow(states, mode).forEach(({ index, animate }) => {
          if (animate) revealCard(cards[index]); else revealNow(cards[index]);
        });
      } catch (e) {
        cards.forEach(revealNow);
      }
      tabbed.forEach((el) => el.removeAttribute('tabindex'));
      releaseCanvas(canvas);
      removeBoot(boot); // ヘッダー・ラベルの「起動中だけ隠す」もここで外れる
      if (focusWasInBoot) moveFocusToPage(cards);
      markVisited();
      resolve();
    }
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        end('skip');
      }
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      end('skip');
    }
    // 位置が変わると、飛んでいく先がずれる。止めて、見えているカードを出す
    function onScroll() { if (Math.abs((window.scrollY || 0) - startScroll) > 24) end('interrupt'); }
    function onResize() {
      const w = window.innerWidth || document.documentElement.clientWidth;
      const h = window.innerHeight || document.documentElement.clientHeight;
      if (w !== vw || Math.abs(h - vh) > 120) end('interrupt');
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    if (skipBtn) skipBtn.hidden = false; // スキップできる状態になってから見せる

    // 計画（画面に見えている部品を、表示順に）。canvas が使えない・計画に失敗したときは、演出をやめて全部見せる
    let plan = null;
    const byId = new Map();
    try {
      if (!canvasUsable(canvas)) throw new Error('canvas が使えません');
      const targets = introElements().map((el, i) => {
        const id = 'part-' + i;
        byId.set(id, el);
        return el.classList.contains('card') ? describeTarget(el, id) : describeLabel(el, id);
      });
      plan = buildSwarmPlan({ targets, count: swarmCount({ w: vw, h: vh }), totalMs, seed: randomSeed(), viewport: { w: vw, h: vh } });
    } catch (e) {
      end('error');
      return;
    }
    canvas.hidden = false;
    runSwarm({
      canvas,
      plan,
      signal: ctrl.signal,
      onReveal: ({ cardId }) => {
        const el = byId.get(cardId);
        if (!el) return;
        if (el.classList.contains('card')) {
          if (!el.classList.contains('is-in')) revealCard(el);
        } else {
          el.classList.add('bp-in');
        }
      },
      onTick: (t) => {
        const s = bootStage(t, totalMs);
        const st = statusAt(plan, t);
        setText(s.text);
        setCount(bootCounts(st));
        setDots(Math.min(dots.length, st.agents));
        if (s.leaving) boot.classList.add('is-leaving');
      },
      onDone: () => end('done'),
      onError: () => end('error'),
    });
  });
}

// ---- スクロールで入ったカード: IntersectionObserver で登場。短い版（約0.9秒）: 設計図の四角が広がり、
// カーソル2〜3個がハンドルをつかみ、そのあと中身が埋まる（赤い線は無し） ----
const MINI_MAX_CARDS = 3;
let miniBusy = false;
let miniTimer = null;
let miniCtrl = null;

function miniFinish(canvas) {
  miniBusy = false;
  if (miniTimer) { clearTimeout(miniTimer); miniTimer = null; }
  miniCtrl = null;
  releaseCanvas(canvas);
}

function revealBatch(els) {
  const plain = (list) => {
    const delays = staggerDelays(list.length);
    list.forEach((el, i) => {
      el.style.setProperty('--d', delays[i] + 'ms');
      revealCard(el);
    });
  };
  const canvas = document.getElementById('swarm');
  // 小さな群れは同時に1つだけ（同じ canvas を取り合わない）。動いている間の追加分は、群れ無しで従来通り登場
  if (miniBusy || !canvasUsable(canvas)) { plain(els); return; }
  try {
    const group = els.slice(0, MINI_MAX_CARDS);
    const rest = els.slice(MINI_MAX_CARDS);
    const byId = new Map();
    const targets = group.map((el, i) => {
      const id = 'mini-' + i;
      byId.set(id, el);
      return describeTarget(el, id);
    });
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const totalMs = 900 + 250 * (group.length - 1);
    const plan = buildSwarmPlan({ targets, count: group.length * 3, totalMs, seed: randomSeed(), viewport: { w: vw, h: vh }, scan: false });
    const flush = () => group.forEach((el) => { if (!el.classList.contains('is-in')) revealCard(el); });
    miniBusy = true;
    miniCtrl = new AbortController();
    canvas.hidden = false;
    runSwarm({
      canvas,
      plan,
      signal: miniCtrl.signal,
      onReveal: ({ cardId }) => {
        const el = byId.get(cardId);
        if (el && !el.classList.contains('is-in')) revealCard(el);
      },
      onDone: () => miniFinish(canvas),
      onError: () => { miniFinish(canvas); flush(); },
    });
    // 念のため: 何かで動かなくても、カードは隠れたままにしない
    miniTimer = setTimeout(() => {
      miniTimer = null;
      if (miniCtrl) miniCtrl.abort();
      flush();
      miniFinish(canvas);
    }, totalMs + 600);
    if (rest.length) plain(rest);
  } catch (e) {
    miniFinish(canvas);
    plain(els);
  }
}

// 群れのあと、まだ出ていないカード（画面の下にあったもの）は、画面に入った瞬間に登場させる。
function setupReveal(cards) {
  const pending = cards.filter((el) => !el.classList.contains('is-in'));
  if (pending.length === 0) return;
  try {
    const io = new IntersectionObserver((entries) => {
      try {
        const seen = entries.filter((e) => e.isIntersecting);
        if (seen.length === 0) return;
        seen.forEach((e) => io.unobserve(e.target));
        revealBatch(seen.map((e) => e.target));
      } catch (err) {
        pending.forEach((el) => revealNow(el));
        io.disconnect();
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    pending.forEach((el) => io.observe(el));
    // 最後の砦: observer が一度も動かなくても、画面内のカードは隠れたままにしない
    setTimeout(() => {
      try {
        const vh = window.innerHeight || document.documentElement.clientHeight;
        pending.forEach((el) => {
          if (el.classList.contains('will-reveal') && !el.classList.contains('is-in') && isInViewport(el.getBoundingClientRect(), vh)) {
            revealCard(el);
          }
        });
      } catch (err) {
        pending.forEach((el) => revealNow(el));
      }
    }, 4000);
  } catch (e) {
    pending.forEach((el) => el.classList.remove('will-reveal'));
  }
}

export async function init() {
  const grid = document.getElementById('grid');
  const links = document.getElementById('links');
  grid.innerHTML = '<p class="empty">読み込み中…</p>';
  const boot = document.getElementById('boot');
  const visited = readVisited();
  const bp = bootPlan({ visited, reducedMotion: wantsReducedMotion() });
  // 動きを減らす設定／IntersectionObserver が無い／canvas が使えない: 演出なし（群れも設計図も無く、全カードをすぐ見せる）
  const instant = shouldRevealNow(window) || !canvasUsable(document.getElementById('swarm'));
  const useBoot = !!boot && bp.show && !instant;
  if (boot) {
    // ヘッダーを隠す .is-booting はまだ付けない（tools.json の読み込みが遅くても、ヘッダーは見えたまま）
    if (useBoot) boot.hidden = false;
    else removeBoot(boot);
  }

  let r;
  try {
    r = { ok: true, v: await loadTools() };
  } catch (e) {
    r = { ok: false };
  }
  if (!r.ok) {
    removeBoot(boot);
    grid.innerHTML = '<p role="alert">読み込めませんでした</p>';
    links.innerHTML = '';
    return;
  }
  const { data, tools } = r.v;
  let cards = [];
  let safety = null;
  try {
    if (tools.length === 0) {
      grid.innerHTML = '<p class="empty">ツールがありません</p>';
    } else {
      grid.innerHTML = renderGroups(groupTools(tools, data.groups));
    }
    links.innerHTML = cleanLinks(data).map((l) => renderLink(l)).join('');

    cards = Array.from(document.querySelectorAll('#grid .card, #links .card'));
    if (!instant) cards.forEach((el) => el.classList.add('will-reveal'));
    if (useBoot && cards.length > 0) {
      // 保険: 演出の想定終了（totalMs）＋余裕のあとも終わっていなければ、強制的に終える
      safety = setTimeout(() => { if (activeIntroEnd) activeIntroEnd('error'); }, bp.totalMs + 4000);
      // カードを描き終えて、演出を始める直前にだけヘッダー・ラベルを隠す（約150msでふっと消える）。
      // 外すのは removeBoot: runIntro の end()（完了・スキップ・中断・失敗）と、下の catch の forceAllVisible の両方から必ず通る
      setBooting(true);
      await runIntro(boot, cards, bp.totalMs);
    } else {
      removeBoot(boot);
    }
    markVisited();
    if (!instant && cards.length > 0) setupReveal(cards);
  } catch (e) {
    // どこで失敗しても、全カードが見える・#boot が無い状態にする
    forceAllVisible(boot, cards);
    if (cards.length === 0) grid.innerHTML = '<p role="alert">読み込めませんでした</p>';
    markVisited();
  } finally {
    if (safety) clearTimeout(safety);
  }
}

if (typeof document !== 'undefined') {
  setupA2hs();
  init();
}
