// Excelオープニング（試作）: 5人のAIカーソルが、本番のページの部品を Excel のように作っていく。
// 作った瞬間に「本物の部品」が現れる（本物のカードが、薄い色の四角と入れ替わる）。ページ本体の見た目や並びは触らない。
const AGENTS = [
  { color: '#0F382C', label: 'AGENT 1', f: 0.9 },
  { color: '#1F9D6B', label: 'AGENT 2', f: 0.8 },
  { color: '#2F6FDE', label: 'AGENT 3', f: 1.0 },
  { color: '#E0702B', label: 'AGENT 4', f: 0.85 },
  { color: '#8B4FD0', label: 'AGENT 5', f: 0.95 },
];
const CW = 120, CH = 32, HEAD_W = 28, TOP = 64;

const letters = (n) => {
  let s = ''; n++;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const mk = (tag, cls, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const place = (el, r) => {
  el.style.left = r.x + 'px'; el.style.top = r.y + 'px';
  el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
};

function textOf(el, kind) {
  if (kind === 'card') {
    const t = el.querySelector('.card-title') || el.querySelector('.card-handle');
    return (t ? t.textContent : el.textContent).trim();
  }
  if (kind === 'label') {
    const s = el.querySelector('[aria-label]');
    return s ? s.getAttribute('aria-label') : el.textContent.trim();
  }
  if (kind === 'today') return 'TODAY';
  return 'WEB TOOLS ARSENAL';
}

// 画面に見えている部品を、作る順番（上から下・左から右）に並べる
function planJobs() {
  const vh = innerHeight, vw = innerWidth;
  const vis = (r) => r.w > 0 && r.h > 0 && r.y < vh && r.y + r.h > TOP && r.x < vw && r.x + r.w > 0;
  const jobs = [];
  const push = (sel, kind) => document.querySelectorAll(sel).forEach((el) => {
    if (kind === 'today' && el.hidden) return;
    const rect = rectOf(el);
    if (vis(rect)) jobs.push({ kind, el, rect, text: textOf(el, kind) });
  });
  push('#today', 'today');
  push('.section-label', 'label');
  push('#grid .card, #links .card', 'card');
  jobs.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const header = document.querySelector('.site-header');
  const title = document.querySelector('.site-title');
  if (header && title) {
    jobs.unshift({ kind: 'header', el: header, rect: rectOf(header), titleRect: rectOf(title), text: 'WEB TOOLS ARSENAL' });
  }
  return jobs;
}

export async function runExcelIntro({ revealCard, revealNow, setBooting, onPlan }) {
  const root = document.documentElement;
  let skipped = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, skipped ? 0 : ms));

  window.scrollTo(0, 0);
  const lines = mk('div'); lines.id = 'xl-lines'; root.appendChild(lines);
  const xl = mk('div'); xl.id = 'xl'; root.appendChild(xl);
  const chrome = mk('div', 'xl-chrome', xl);
  const formula = mk('div', 'xl-formula', chrome);
  const namebox = mk('span', 'xl-namebox', formula); namebox.textContent = 'A1';
  mk('span', 'xl-fx', formula).textContent = 'fx';
  const fbar = mk('span', 'xl-fbar', formula);
  mk('div', 'xl-corner', chrome);
  const colheads = mk('div', 'xl-colheads', chrome);
  const rowheads = mk('div', 'xl-rowheads', chrome);
  const nc = Math.ceil((innerWidth - HEAD_W) / CW) + 1, nr = Math.ceil((innerHeight - TOP) / CH) + 1;
  for (let i = 0; i < nc; i++) mk('div', '', colheads).textContent = letters(i);
  for (let i = 0; i < nr; i++) mk('div', '', rowheads).textContent = String(i + 1);
  const stage = mk('div', 'xl-stage', xl);
  const btns = mk('div', 'xl-btns', xl);
  const skipBtn = mk('button', '', btns); skipBtn.type = 'button'; skipBtn.textContent = 'スキップ';
  btns.style.pointerEvents = 'auto';
  const doSkip = () => { skipped = true; xl.classList.add('xl-instant'); root.classList.add('xl-instant'); };
  skipBtn.addEventListener('click', doSkip);
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') doSkip(); };
  addEventListener('keydown', onKey);

  const agents = AGENTS.map((def) => {
    const cur = mk('div', 'xl-cursor hide', stage);
    cur.style.setProperty('--wc', def.color);
    cur.innerHTML = '<svg viewBox="0 0 20 24" aria-hidden="true"><path d="M1 1 L1 18 L5.5 14 L8.8 21.5 L11.6 20.3 L8.3 13 L14 13 Z"/></svg><span class="tag"></span>';
    cur.querySelector('.tag').textContent = def.label;
    const sel = mk('div', 'xl-sel hide', stage);
    sel.style.setProperty('--wc', def.color);
    mk('i', '', sel);
    return { ...def, cur, sel, rect: null };
  });

  const edge = (i) => {
    const W = innerWidth, H = innerHeight;
    return [[W - 100, H * 0.3], [W - 80, H - 90], [W * 0.5, H - 70], [W * 0.15, H - 100], [W - 300, H * 0.6]][i];
  };
  const moveCursor = (wk, x, y, d) => {
    wk.cur.style.setProperty('--cd', d + 's');
    wk.cur.style.left = x + 'px';
    wk.cur.style.top = y + 'px';
  };
  const click = async (wk) => { wk.cur.classList.add('click'); await sleep(120 * wk.f); wk.cur.classList.remove('click'); };

  function updateHeads() {
    const act = agents.filter((w) => w.rect);
    [...colheads.children].forEach((e, i) => {
      const a = HEAD_W + i * CW, b = a + CW;
      e.classList.toggle('on', act.some((w) => w.rect.x < b && w.rect.x + w.rect.w > a));
    });
    [...rowheads.children].forEach((e, i) => {
      const a = TOP + i * CH, b = a + CH;
      e.classList.toggle('on', act.some((w) => w.rect.y < b && w.rect.y + w.rect.h > a));
    });
  }
  function setSel(wk, r) {
    wk.sel.style.setProperty('--sp', wk.f);
    place(wk.sel, r);
    wk.sel.classList.remove('hide');
    wk.rect = r;
    updateHeads();
    const col = Math.max(0, Math.floor((r.x - HEAD_W) / CW)), row = Math.max(0, Math.floor((r.y - TOP) / CH)) + 1;
    namebox.textContent = letters(col) + row;
  }
  function endSel(wk) { wk.sel.classList.add('hide'); wk.rect = null; updateHeads(); }

  async function typeInto(el, text, delay) {
    if (skipped) { el.textContent = text; fbar.textContent = text; return; }
    for (let i = 1; i <= text.length; i++) {
      el.textContent = text.slice(0, i); fbar.textContent = text.slice(0, i);
      await sleep(delay);
    }
  }
  const fakeText = (cell, wk) => {
    const t = mk('div', 'xl-text', stage);
    t.style.setProperty('--wc', wk.color);
    place(t, cell);
    t.style.lineHeight = cell.h + 'px';
    return t;
  };
  async function goClick(wk, cell) {
    moveCursor(wk, cell.x + cell.w * 0.8, cell.y + cell.h * 0.75, 0.5 * wk.f);
    await sleep(540 * wk.f);
    await click(wk);
  }
  // つまみを持って、選択枠を目的の大きさまで引っぱる
  async function dragTo(wk, from, to) {
    const f = wk.f;
    moveCursor(wk, from.x + from.w, from.y + from.h, 0.22 * f);
    await sleep(250 * f);
    wk.cur.classList.add('press');
    setSel(wk, to);
    moveCursor(wk, to.x + to.w, to.y + to.h, 0.35 * f);
    await sleep(380 * f);
  }

  async function doHeader(wk, job) {
    const f = wk.f, t = job.titleRect;
    const cell = { x: t.x, y: t.y + (t.h - CH) / 2, w: Math.min(220, Math.max(160, t.w)), h: CH };
    await goClick(wk, cell);
    setSel(wk, cell);
    await sleep(150 * f);
    const txt = fakeText(cell, wk);
    await typeInto(txt, job.text, 40 * f);
    await sleep(150 * f);
    await dragTo(wk, cell, job.rect);               // タイトルのセルから、ヘッダー全体へ広げる
    root.classList.add('xl-band-on');               // 深緑の帯がふわっと出る
    document.querySelectorAll('.site-logo, .site-brand, .site-title').forEach((e) => e.classList.add('bp-in'));
    txt.classList.add('gone');
    await sleep(300 * f);
    wk.cur.classList.remove('press');
    endSel(wk);
    setTimeout(() => txt.remove(), 700);
  }

  async function doLabel(wk, job) {
    const f = wk.f, r = job.rect;
    const cell = { x: r.x, y: r.y + (r.h - CH) / 2, w: Math.max(150, Math.min(r.w, 220)), h: CH };
    await goClick(wk, cell);
    setSel(wk, cell);
    await sleep(120 * f);
    const txt = fakeText(cell, wk);
    await typeInto(txt, job.text, 40 * f);
    await sleep(120 * f);
    job.el.classList.add('bp-in');
    txt.classList.add('gone');
    endSel(wk);
    setTimeout(() => txt.remove(), 700);
  }

  // カード・今日の予定の帯: セルに名前を打つ → つまみを引っぱって四角を広げる → 本物に入れ替わる
  async function doBlock(wk, job) {
    const f = wk.f, r = job.rect;
    const cell = { x: r.x, y: r.y, w: Math.min(r.w, CW * 1.4), h: CH };
    const block = mk('div', 'xl-block', stage);
    block.style.setProperty('--wc', wk.color);
    place(block, r);
    await goClick(wk, cell);
    setSel(wk, cell);
    await sleep(120 * f);
    const txt = fakeText(cell, wk);
    await typeInto(txt, job.text, 45 * f);
    await sleep(120 * f);
    block.classList.add('show');
    await dragTo(wk, cell, r);
    txt.remove();
    if (job.kind === 'card') {
      (skipped ? revealNow : revealCard)(job.el);   // 本物のカードが登場（文字が打ち込まれる）
      block.classList.add('gone');
      setTimeout(() => block.remove(), 700);
    } else {
      job.block = block;                            // 今日の帯は、最後に本物が登場するまで四角を残す
    }
    await sleep(200 * f);
    wk.cur.classList.remove('press');
    endSel(wk);
  }

  let jobs = [];
  try {
    root.classList.add('xl-on');
    void document.body.offsetHeight;      // ずらしたあとの位置で測る
    jobs = planJobs();
    onPlan(jobs.filter((j) => j.kind === 'card').map((j) => j.el));

    agents.forEach((wk, i) => { const [x, y] = edge(i); moveCursor(wk, x, y, 0); });
    await sleep(350);
    const queue = jobs.slice();
    await Promise.all(agents.map(async (wk, idx) => {
      wk.cur.classList.remove('hide');
      await sleep(idx * 110);
      for (;;) {
        const job = queue.shift();
        if (!job) break;
        try {
          if (job.kind === 'header') await doHeader(wk, job);
          else if (job.kind === 'label') await doLabel(wk, job);
          else await doBlock(wk, job);
        } catch (e) {
          // 1つ失敗しても、ほかの仕事は続ける（あとで全部見えるようにする）
          try { if (job.kind === 'card') revealNow(job.el); job.el.classList.add('bp-in'); } catch (e2) { /* 次へ */ }
        }
      }
      const [x, y] = edge(idx);
      moveCursor(wk, x, y, 0.8);
    }));

    // 仕上げ: 打ち込みが終わるのを待ち、カーソル・方眼・見出しを消して、ページを元の位置へすっと戻す
    await sleep(900);
    agents.forEach((wk) => wk.cur.classList.add('hide'));
    fbar.textContent = ''; namebox.textContent = '';
    xl.classList.add('xl-fade'); lines.classList.add('xl-fade');
    await sleep(700);
    root.classList.add('xl-settle');
    root.classList.remove('xl-on');
    setBooting(false);                    // 今日の予定の帯が、ここで登場する
    jobs.forEach((j) => { if (j.block) { j.block.classList.add('gone'); } });
    await sleep(700);
  } finally {
    removeEventListener('keydown', onKey);
    try { xl.remove(); lines.remove(); } catch (e) { /* 次へ */ }
    root.classList.remove('xl-on', 'xl-settle', 'xl-instant');
    try { setBooting(false); } catch (e) { /* 次へ */ }
    // 帯が見えないまま残らないように
    root.classList.add('xl-band-on');
  }
}
