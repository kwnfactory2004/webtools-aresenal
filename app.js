// Web Tools Arsenal - 描画用の関数（ブラウザ専用の処理は別途追加する）
import { buildSwarmPlan, runSwarm, swarmCount, statusAt, stageOf, PHASE, STAGE_TEXT, CARD_BUILD, cardBuildTotalMs } from './swarm.js';
import { DOT_ICONS, dotIconSvg, dotSvg, dotText } from './dotfont.js';
import { initToday } from './today.js';
import { runExcelIntro } from './excel-intro.js';

// アイコンは点で描いたドットアイコン（11×11。dotfont.js の DOT_ICONS）。名前は tools.json の icon と同じ
export const ICONS = Object.fromEntries(Object.keys(DOT_ICONS).map((name) => [name, dotIconSvg(name)]));

const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 11" aria-hidden="true"></svg>';

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

const SMALL_DOT = 0.95; // 小さいドット文字は点を少し太く（tools/gen-index.mjs のブランドと同じ値）

// カード右下の小さなリンク表示（ドット文字）。開けるカードは「OPEN >」（リンクの名前と重ならないよう読み上げない）、
// 準備中は「SOON」（読み上げる）
function cardCta(soon) {
  return soon
    ? `<div class="card-cta is-soon-label">${dotSvg('SOON', { className: 'dot-cta', dot: SMALL_DOT })}</div>`
    : `<div class="card-cta"><span class="cta-link">${dotSvg('OPEN >', { className: 'dot-cta', decorative: true, dot: SMALL_DOT })}</span></div>`;
}

export function renderCard(tool) {
  const name = escapeHtml(tool.name);
  const desc = escapeHtml(tool.description);
  const classes = ['card'];
  if (tool.size === 'large') classes.push('card--large');
  const badge = tool.status === 'beta' ? '<span class="badge">β</span>' : '';
  const soon = tool.status === 'soon' || !isSafeUrl(tool.url);
  const inner =
    `<div class="card-icon">${iconSvg(tool.icon)}</div>` +
    `<h2 class="card-title">${name}${badge}</h2>` +
    `<p class="card-desc">${desc}</p>` +
    cardCta(soon);
  if (soon) {
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
      const label = sec.label ? `<p class="section-label">${dotText(sec.label, { className: 'dot-label' })}</p>` : '';
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
    cardCta(!isSafeUrl(link.url));
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
    const cta = card.querySelector('.card-cta svg');
    if (cta) parts.push(toBox(cta.getBoundingClientRect()));
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

// 見出し・ラベルなどの設計図: 文字（またはドット文字の SVG）の部分だけの外枠。画像や、測れないときは要素の枠。
// tone: 深緑のヘッダー帯の中の部品は 'dark'（設計図を白で描く）
function contentBox(el) {
  try {
    if (el.tagName === 'IMG') return null;
    const hasText = Array.from(el.querySelectorAll('*')).concat(el).some((n) => n.namespaceURI !== 'http://www.w3.org/2000/svg'
      && Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.data.trim()));
    const rects = hasText ? textBox(el) : [];
    if (rects.length) return unionBox(rects);
    const svgs = Array.from(el.querySelectorAll('svg')).map((s) => s.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    return unionBox(svgs);
  } catch (e) {
    return null;
  }
}
function describeLabel(el, id) {
  const box = contentBox(el);
  const dark = !!(el.closest && el.closest('.site-header'));
  return { id, kind: 'label', rect: box || toBox(el.getBoundingClientRect()), ...(dark ? { tone: 'dark' } : {}) };
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
let introRunning = false; // 起動演出の群れが動いている間 true（この間に見えたカードの小さな群れは、2枚目の canvas を使う）

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
    introRunning = true;
    // 段階名はドット文字（状態バーは aria-hidden なので読み上げない）。中身は STAGE_TEXT の決まった文字だけ
    const setText = (t) => { if (text && t !== lastText) { text.innerHTML = dotSvg(t, { className: 'dot-stage', decorative: true }); lastText = t; } };
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
      introRunning = false;
      if (mode !== 'done') cancelTour(); // スキップ・中断・失敗のときは、見学ツアーも止める
      ctrl.abort();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      const focusWasInBoot = boot.contains(document.activeElement);
      try {
        if (mode === 'skip' || mode === 'error') restoreAllTypings();
        const vh2 = window.innerHeight || document.documentElement.clientHeight;
        // 見学ツアーで自動スクロール中は、画面に入ったカードを一斉に出さない（群れの順番待ちのカードは、1枚ずつ作られる）
        const planned = new Set(byId.values());
        const leaveToTour = (el) => tourDriving() && !planned.has(el);
        const states = cards.map((el) => ({ revealed: el.classList.contains('is-in'), inView: isInViewport(el.getBoundingClientRect(), vh2) && !leaveToTour(el) }));
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
      resolve(mode);
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
    function onScroll() { if (tourDriving()) return; if (Math.abs((window.scrollY || 0) - startScroll) > 24) end('interrupt'); } // 見学ツアーの自動スクロールでは止めない
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
    // カーソルが最初のカードの設計図を広げ始めたとき、同時にスクロール（見学ツアー）を始める
    const firstCard = (plan.boxes || []).find((b) => b.kind === 'card');
    const tourStartAt = firstCard ? firstCard.appearAt : totalMs * PHASE.scanEnd;
    let tourStarted = false;
    canvas.hidden = false;
    runSwarm({
      canvas,
      plan,
      signal: ctrl.signal,
      followScroll: true, // スクロールしても、群れの絵はカードに付いて動く
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
        if (!tourStarted && t >= tourStartAt) { tourStarted = true; startTour(); }
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
  drainMiniQueue();
}

// 見学ツアー中に、群れが動いている間に見えたカード。順番を待って、次の群れで作る（画面から外れたものは、すぐ普通に出す）
let miniQueue = [];
function drainMiniQueue() {
  if (miniQueue.length === 0) return;
  const list = miniQueue.filter((el) => !el.classList.contains('is-in'));
  miniQueue = [];
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const seen = list.filter((el) => isInViewport(el.getBoundingClientRect(), vh));
  list.filter((el) => !seen.includes(el)).forEach(revealNow);
  if (seen.length) setTimeout(() => revealBatch(seen), 0);
}

function revealBatch(els) {
  // 起動演出の群れが動いている間は、同じ canvas を取り合わないよう、2枚目（swarm2）で小さな群れを動かす
  const plain = (list) => {
    const delays = staggerDelays(list.length);
    list.forEach((el, i) => {
      el.style.setProperty('--d', delays[i] + 'ms');
      revealCard(el);
    });
  };
  const canvas = document.getElementById(introRunning ? 'swarm2' : 'swarm');
  // 小さな群れは同時に1つだけ（同じ canvas を取り合わない）。動いている間の追加分は、群れ無しで従来通り登場
  if (miniBusy && tourActive) { miniQueue.push(...els); return; }
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
    // どのカードも同じ時間・同じカーソルの速さで作る（枚数が増えても1枚あたりは変わらない）
    const totalMs = cardBuildTotalMs(group.length);
    const plan = buildSwarmPlan({ targets, count: Math.max(6, group.length * 3), totalMs, seed: randomSeed(), viewport: { w: vw, h: vh }, scan: false, uniform: CARD_BUILD });
    const flush = () => group.forEach((el) => { if (!el.classList.contains('is-in')) revealCard(el); });
    miniBusy = true;
    miniCtrl = new AbortController();
    canvas.hidden = false;
    runSwarm({
      canvas,
      plan,
      signal: miniCtrl.signal,
      followScroll: true, // スクロールしながらでも、カードの上に出る
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
function setupReveal(cards, skip = null) {
  // skip: 起動演出の群れが作る部品（観察しない）
  const pending = cards.filter((el) => !el.classList.contains('is-in') && !(skip && skip.has(el)));
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
        if (miniBusy) return; // 小さな群れが動いている間は、そちらに任せる（observer は動いている）
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

// ---- 見学ツアー: 起動演出の群れが最初のカードを作り始めたと同時に、止まらずゆっくり下までスクロール（見えたカードは、その場で短い登場で作られる）→ 一番下 → 最後に上へ戻る ----
// 動きは「ゆっくり加速 → 一定の速さ → ゆっくり減速」の1本の流れ。群れの絵はスクロールに付いて動くので、止まらなくてもカードの上に出る。
// 画面に触れたら（ホイール・タッチ・クリック・キー）その場でやめる（上には戻さない）。動きを減らす設定・スキップ・失敗のときは始めない。
// 今日の予定の帯（TimeGrid）は、一番上に戻ってきたあと、最後に群れが作る（それまでは .is-touring で隠す）。
const TOUR_DOWN_SPEED = 260; // 下へ: 1秒に進む px
const TOUR_DOWN_MIN_MS = 2800;
const TOUR_UP_SPEED = 750; // 上へ戻る: 1秒に進む px
const TOUR_UP_MIN_MS = 1600;
let tourActive = false;
let tourCancelled = false;
let tourCancel = null;

// 動かす時間（ms）。近すぎる（24px以内）なら 0＝動かさない
export function tourDuration(distance, speed, minMs) {
  const d = Math.abs(Number(distance)) || 0;
  if (!(d > 24) || !(speed > 0)) return 0;
  return Math.max(Number(minMs) || 0, Math.round((d / speed) * 1000));
}

// 台形の速さ（ゆっくり加速 → 一定 → ゆっくり減速）で、0〜1 の時間を 0〜1 の進み具合にする。途中で止まらない
export function glideEase(k, ramp = 0.2) {
  const t = Math.min(1, Math.max(0, Number(k) || 0));
  const a = Math.min(0.5, Math.max(0.01, ramp));
  const v = 1 / (1 - a);
  if (t < a) return (v * t * t) / (2 * a);
  if (t < 1 - a) return v * (a / 2 + (t - a));
  return 1 - (v * (1 - t) * (1 - t)) / (2 * a);
}

// 今日の予定の帯の設計図: 外枠＋中の部品（ラベル・リンク・授業の行・持ち物・明日）
function describeBanner(el) {
  const target = { id: 'today', kind: 'card', rect: toBox(el.getBoundingClientRect()) };
  try {
    target.parts = Array.from(el.querySelectorAll('.today-label, .today-link, .today-row, .today-off, .today-done, .today-items, .today-tomorrow'))
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map(toBox);
  } catch (e) {
    target.parts = [];
  }
  return target;
}

// 一番上に戻ってきたあと、最後に今日の予定の帯（TimeGrid）を、カーソルの群れが組み立てる。
// 設計図の枠が広がり、部品が出て、帯が現れる（帯の登場アニメーションは .is-touring が外れた瞬間に始まる）。
// canvas が使えない・失敗しても、帯は必ず出す
function buildBannerFinale() {
  return new Promise((resolve) => {
    const root = document.documentElement;
    const el = document.getElementById('today');
    const canvas = document.getElementById('swarm');
    let shown = false;
    const show = () => { if (!shown) { shown = true; root.classList.remove('is-touring'); } };
    if (!el || el.hidden || miniBusy || !canvasUsable(canvas)) { show(); resolve(); return; }
    try {
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // 帯も、ほかのカードと同じ時間・同じカーソルの速さで作る
      const finaleMs = cardBuildTotalMs(1);
      const plan = buildSwarmPlan({ targets: [describeBanner(el)], count: Math.max(10, Math.min(18, swarmCount({ w: vw, h: vh }))), totalMs: finaleMs, seed: randomSeed(), viewport: { w: vw, h: vh }, scan: false, uniform: CARD_BUILD });
      miniBusy = true;
      miniCtrl = new AbortController();
      canvas.hidden = false;
      const finish = () => { show(); miniFinish(canvas); resolve(); };
      runSwarm({ canvas, plan, signal: miniCtrl.signal, followScroll: true, onReveal: show, onDone: finish, onError: finish });
      // 念のため: 何かで動かなくても、帯は隠れたままにしない
      miniTimer = setTimeout(() => { miniTimer = null; if (miniCtrl) miniCtrl.abort(); finish(); }, finaleMs + 800);
    } catch (e) {
      show();
      miniFinish(canvas);
      resolve();
    }
  });
}

const tourDriving = () => tourActive && !tourCancelled; // 自動スクロール中（ユーザーがまだ触っていない）
function cancelTour() { if (tourCancel) tourCancel(); }

function startTour() {
  if (tourActive) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = document.documentElement;
  let released = false;
  const release = () => { if (!released) { released = true; root.classList.remove('is-touring'); } };
  const cancel = () => { tourCancelled = true; };
  tourCancelled = false;
  tourCancel = cancel;
  tourActive = true;
  root.classList.add('is-touring');
  const events = ['wheel', 'touchstart', 'mousedown', 'keydown'];
  events.forEach((n) => window.addEventListener(n, cancel, { capture: true, passive: true }));

  const glide = (to, ms, onProgress) => new Promise((resolve) => {
    const from = window.scrollY || 0;
    const t0 = performance.now();
    const frame = (now) => {
      if (tourCancelled) { resolve(false); return; }
      const k = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, from + (to - from) * glideEase(k));
      if (onProgress) onProgress(k);
      if (k < 1) requestAnimationFrame(frame); else resolve(true);
    };
    requestAnimationFrame(frame);
  });
  // 一番下に着いたら、起動演出の群れ・最後の小さな群れが終わるまで待つ（最大 14 秒）
  const settle = async () => {
    for (let i = 0; i < 140 && (introRunning || miniBusy || miniQueue.length > 0) && !tourCancelled; i++) await sleep(100);
    if (!tourCancelled) await sleep(500);
  };

  (async () => {
    try {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const maxY = Math.max(0, document.documentElement.scrollHeight - vh);
      const downMs = tourDuration(maxY - (window.scrollY || 0), TOUR_DOWN_SPEED, TOUR_DOWN_MIN_MS);
      if (downMs === 0) return;
      if (!(await glide(maxY, downMs))) return;
      await settle();
      if (tourCancelled) return;
      const back = await glide(0, tourDuration(maxY, TOUR_UP_SPEED, TOUR_UP_MIN_MS));
      if (back && !tourCancelled) await buildBannerFinale(); // 最後に、TimeGrid の帯を作る
    } catch (e) {
      // 何があっても、ページはそのまま使える
    } finally {
      release();
      tourActive = false;
      tourCancel = null;
      events.forEach((n) => window.removeEventListener(n, cancel, true));
      drainMiniQueue(); // 待たせていたカードが残っていたら、すぐ出す
    }
  })();
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
  const useExcel = bp.show && !instant; // 試作: 起動演出は Excel 風（excel-intro.js）。従来の #boot は使わない
  const useBoot = false;
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
  let earlyReveal = false;
  try {
    if (tools.length === 0) {
      grid.innerHTML = '<p class="empty">ツールがありません</p>';
    } else {
      grid.innerHTML = renderGroups(groupTools(tools, data.groups));
    }
    links.innerHTML = cleanLinks(data).map((l) => renderLink(l)).join('');

    cards = Array.from(document.querySelectorAll('#grid .card, #links .card'));
    if (!instant) cards.forEach((el) => el.classList.add('will-reveal'));
    if (useExcel && cards.length > 0) {
      // 今日の予定の帯が出てから測る（帯が遅れて出ると、カードの位置がずれるため）
      await new Promise((res) => {
        const t0 = Date.now();
        const tick = () => {
          const el = document.getElementById('today');
          if (!el || !el.hidden || Date.now() - t0 > 1200) res(); else setTimeout(tick, 50);
        };
        tick();
      });
      earlyReveal = true;
      setBooting(true); // ヘッダーの文字・ラベル・今日の帯を、AIが作るまで隠す
      await runExcelIntro({
        revealCard,
        revealNow,
        setBooting,
        // 画面の下にあるカードは、これまでどおり「見えた瞬間に登場」。Excelで作るカードは観察しない
        onPlan: (els) => setupReveal(cards, new Set(els)),
      });
    } else {
      removeBoot(boot);
    }
    markVisited();
    if (!instant && cards.length > 0 && !earlyReveal) setupReveal(cards);
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
  initToday(); // 一番上の「今日の学校の予定」。失敗しても帯が出ないだけで、他には影響しない
  init();
}
