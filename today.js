// Web Tools Arsenal - 一番上の「今日の学校の予定」帯。
// 予定データは schedule.json（tools/gen-schedule.mjs が TimeGrid から作る）。DOM に触るのは initToday だけ（他は純粋な関数なので node でテストできる）。
// CSP が style 属性を許さないので、進み具合は段（span）の数で見せる。
import { dotSvg, dotText } from './dotfont.js';

export const TIMEGRID_URL = 'https://kwnfactory2004.github.io/schoolcalendar/';
const WEEK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];
const CATEGORY = {
  normal: { cls: 'cat-normal', label: '通常授業' },
  exam: { cls: 'cat-exam', label: '試験' },
  oral: { cls: 'cat-oral', label: '口述対策' },
  event: { cls: 'cat-event', label: '行事' },
};
export const BAR_SEGMENTS = 10;

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const pad2 = (n) => String(n).padStart(2, '0');
export function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "9:10〜10:00" → [開始分, 終了分]
export function timeRange(time) {
  const m = String(time).match(/^(\d{1,2}):(\d{2})\s*[〜~-]\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
}

// schedule.json として使えるか（壊れていたら false。帯を出さないだけで、ページは動く）
export function isValidSchedule(data) {
  return Boolean(data && typeof data === 'object'
    && Array.isArray(data.periods) && data.periods.every((p) => timeRange(p.time))
    && data.days && typeof data.days === 'object'
    && data.holidays && typeof data.holidays === 'object'
    && data.winter && typeof data.winter.from === 'string' && typeof data.winter.to === 'string');
}

// ある日の状態: { kind: 'class'|'holiday'|'winter'|'off'|'weekend', label, items:[[period,title,category]], belongings }
export function dayStatus(data, date) {
  const key = dateKey(date);
  const items = (data.days[key] || []).slice();
  const holiday = data.holidays[key] || '';
  const dow = date.getDay();
  const belongings = (data.belongings && data.belongings[key]) || [];
  if (items.length > 0) return { kind: 'class', label: '', items, belongings, key };
  if (holiday) return { kind: 'holiday', label: `祝日（${holiday}）`, items, belongings, key };
  if (key >= data.winter.from && key <= data.winter.to) return { kind: 'winter', label: '冬休み', items, belongings, key };
  if (dow === 0 || dow === 6) return { kind: 'weekend', label: '週末休日', items, belongings, key };
  return { kind: 'off', label: '学校休み', items, belongings, key };
}

// 同じ授業が続くコマを1行にまとめる（例: 1〜3限 卒業試験 2）。now があれば、各行を 済み／今／次／これから に分ける
export function buildRows(data, items, nowMin) {
  const range = new Map(data.periods.map((p) => [Number(p.num), timeRange(p.time)]));
  const rows = [];
  for (const [num, title, category] of items) {
    const r = range.get(Number(num));
    if (!r) continue;
    const last = rows[rows.length - 1];
    if (last && last.title === title && last.category === category && last.to + 1 === Number(num)) {
      last.to = Number(num);
      last.end = r[1];
    } else {
      rows.push({ from: Number(num), to: Number(num), title, category, start: r[0], end: r[1] });
    }
  }
  let nextDone = false;
  for (const row of rows) {
    if (nowMin == null) { row.state = 'later'; continue; }
    if (nowMin >= row.end) row.state = 'past';
    else if (nowMin >= row.start) row.state = 'now';
    else if (!nextDone) { row.state = 'next'; nextDone = true; }
    else row.state = 'later';
  }
  return rows;
}

// 画面に出す内容。now は Date
export function buildToday(data, now) {
  const status = dayStatus(data, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const rows = buildRows(data, status.items, nowMin);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ts = dayStatus(data, tomorrow);
  const tRows = buildRows(data, ts.items, null);
  const tomorrowText = ts.kind === 'class'
    ? tRows.map((r) => `${r.from === r.to ? r.from : r.from + '〜' + r.to}限 ${r.title}`).join(' ／ ')
    : ts.label;
  return {
    date: now,
    status,
    rows,
    nowMin,
    tomorrow: { key: ts.key, text: tomorrowText, kind: ts.kind, dow: tomorrow.getDay() },
  };
}

export const fmtTime = (min) => `${Math.floor(min / 60)}:${pad2(min % 60)}`;
const periodLabel = (r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`);

function bar(row, nowMin) {
  const total = row.end - row.start;
  const filled = Math.max(1, Math.min(BAR_SEGMENTS, Math.round(((nowMin - row.start) / total) * BAR_SEGMENTS)));
  return `<span class="today-bar" aria-hidden="true">${Array.from({ length: BAR_SEGMENTS }, (_, i) => `<i class="${i < filled ? 'f' : ''}"></i>`).join('')}</span>`;
}

function renderRow(row, nowMin) {
  const cat = CATEGORY[row.category] || CATEGORY.normal;
  const stateLabel = { now: 'NOW', next: 'NEXT' }[row.state] || '';
  const remain = row.state === 'now' ? `<span class="today-remain">残り ${row.end - nowMin} 分</span>` : '';
  return `<li class="today-row is-${row.state} ${cat.cls}">
    <span class="today-per">${dotSvg(periodLabel(row), { className: 'dot-per', dot: 0.95 })}<span class="today-per-ja">限</span></span>
    <span class="today-main">
      <span class="today-title">${escapeHtml(row.title)}</span>
      <span class="today-sub">${dotSvg(`${fmtTime(row.start)}-${fmtTime(row.end)}`, { className: 'dot-time', dot: 0.95 })}${remain}</span>
      ${row.state === 'now' ? bar(row, nowMin) : ''}
    </span>
    <span class="today-tags">${stateLabel ? `<span class="today-state">${stateLabel}</span>` : ''}<span class="today-pill ${cat.cls}">${escapeHtml(cat.label)}</span></span>
  </li>`;
}

// 帯の中身（HTML文字列）
export function renderToday(vm) {
  const d = vm.date;
  const head = `<div class="today-head">
    <p class="today-label">${dotText('TODAY', { className: 'dot-today' })}<span class="today-date">${dotText(`${d.getMonth() + 1}/${d.getDate()} ${WEEK_EN[d.getDay()]}`, { className: 'dot-date' })}<span class="today-dow-ja">（${WEEK_JA[d.getDay()]}）</span></span></p>
    <a class="today-link" href="${TIMEGRID_URL}" target="_blank" rel="noopener noreferrer"><span class="cta-link">${dotText('TIMEGRID >', { className: 'dot-cta' })}</span></a>
  </div>`;

  let body;
  if (vm.status.kind === 'class') {
    const done = vm.rows.length > 0 && vm.rows.every((r) => r.state === 'past');
    body = `<ul class="today-list">${vm.rows.map((r) => renderRow(r, vm.nowMin)).join('')}</ul>${done ? '<p class="today-done">今日の授業は終わりました</p>' : ''}`;
    if (vm.status.belongings.length > 0) {
      body += `<p class="today-items">${dotText('ITEMS', { className: 'dot-items' })}<span>${vm.status.belongings.map(escapeHtml).join('・')}</span></p>`;
    }
  } else {
    body = `<p class="today-off is-${vm.status.kind}">${escapeHtml(vm.status.label)}<span>今日は授業がありません</span></p>`;
  }
  const tm = vm.tomorrow;
  const foot = `<p class="today-tomorrow">${dotText('TOMORROW', { className: 'dot-tomorrow' })}<span>${escapeHtml(tm.text)}</span></p>`;
  return head + body + foot;
}

// 画面に出す（#today が無い・schedule.json が読めない・壊れているときは、帯を出さずに終わる。ページの他の部分には影響しない）
export async function initToday(doc = document, fetchImpl = fetch, nowFn = () => new Date()) {
  const el = doc.getElementById('today');
  if (!el) return false;
  let data;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetchImpl('schedule.json', { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (!isValidSchedule(data)) throw new Error('schedule.json の形がおかしい');
  } catch (e) {
    el.hidden = true;
    return false;
  }
  // 最初の1回だけ登場アニメーション（CSS の .is-intro）。最後に出る「明日」の行が終わったら外す＝1分ごとの作り直しでは動かない。
  // 起動演出中（.is-booting）はCSS側で止まっているので、演出が終わってから始まる
  if (el.classList && el.addEventListener) {
    el.classList.add('is-intro');
    el.addEventListener('animationend', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('today-tomorrow')) el.classList.remove('is-intro');
    });
    const guard = setTimeout(() => el.classList.remove('is-intro'), 20000);
    if (guard && guard.unref) guard.unref(); // node のテストが終わるのを待たせない
  }
  const draw = () => {
    try {
      el.innerHTML = renderToday(buildToday(data, nowFn()));
      el.hidden = false;
    } catch (e) {
      el.hidden = true;
    }
  };
  draw();
  // 授業中の「残り○分」と「今／次」を1分ごとに更新。タブに戻ってきたときにも更新
  const tick = setInterval(draw, 60000);
  if (tick && tick.unref) tick.unref(); // node のテストが終わるのを待たせない（ブラウザでは何も起きない）
  if (doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') draw(); });
  return true;
}
