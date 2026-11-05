// Web Tools Arsenal - 「大量のAIカーソルがページを組み立てる」演出
// 計画づくり（buildSwarmPlan / positionAt など）は DOM に触らない純粋な関数。node でテストできる。
// 描画（drawFrame）と時計つきループ（runSwarm）だけがブラウザ（Canvas 2D）を使う。

// ---- 時間の配分（totalMs に対する割合）----
// 出現 0〜18.75% / 組み立て（カード登場）22.5〜55% / 仕上げ（掃く→散る）70〜96% / 残りは余韻
export const PHASE = {
  spawnEnd: 0.1875,
  reveal0: 0.225,
  reveal1: 0.55,
  finish: 0.70, // 起動の READY と合わせる（app.js の bootStage と同じ割合）
  sweep: 0.12,
  exit: 0.14,
};

const COLOR_DARK = '#0F382C';
const COLOR_LIGHT = '#1F6B52';
const FLASH_MS = 300;
const TRAIL_SAMPLES = 12;
const TRAIL_STEP_MS = 26;
const FADE_IN_MS = 160;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad2 = (n) => String(n).padStart(2, '0');

// 決まった種から、いつも同じ並びの 0以上1未満の数を出す乱数
export function mulberry32(seed) {
  let a = (Number(seed) || 0) | 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function easeInOutCubic(u) {
  const x = clamp(Number(u) || 0, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// 画面の広さに比例したカーソルの数（最小16・最大64）。PC（幅900以上）で約48、スマホで約24。
export function swarmCount(view) {
  const w = Math.max(0, Number(view && view.w) || 0);
  const h = Math.max(0, Number(view && view.h) || 0);
  const per = w >= 900 ? 27000 : 13700;
  return clamp(Math.round((w * h) / per), 16, 64);
}

// 重いとき（直近の平均が24msを超えた）は約30%減らす。minCount より下には減らさない
// （もともと minCount より少ないときは、増やさずそのまま返す）。
export function adaptCount(currentCount, avgFrameMs, minCount = 16) {
  const cur = Math.max(0, Math.floor(Number(currentCount)) || 0);
  const floorN = Math.min(Math.max(0, Math.floor(Number(minCount)) || 0), cur);
  if (!(Number(avgFrameMs) > 24)) return cur;
  return Math.max(floorN, Math.floor(cur * 0.7));
}

// 性能の自動調整の1コマ分（純粋）。起動直後 warmupMs は判定しない。直近 window コマの平均が
// slowMs を超え、かつ前回の減少から intervalMs 以上あいているときだけ、約30%減らす。
// state: { frames, count, lastAdaptMs }（frames は rAF の間隔ms）。戻り値は新しい state。
export const ADAPT = { warmupMs: 1000, intervalMs: 1000, window: 20, slowMs: 24 };
export function adaptStep({ frames = [], count, tMs, lastAdaptMs = -Infinity, minCount = 16 }) {
  const recent = frames.slice(-ADAPT.window);
  if (!(tMs >= ADAPT.warmupMs)) return { frames: [], count, lastAdaptMs };
  if (recent.length < ADAPT.window) return { frames: recent, count, lastAdaptMs };
  const avg = recent.reduce((a, v) => a + v, 0) / recent.length;
  if (avg > ADAPT.slowMs && tMs - lastAdaptMs >= ADAPT.intervalMs) {
    return { frames: [], count: adaptCount(count, avg, minCount), lastAdaptMs: tMs };
  }
  return { frames: recent, count, lastAdaptMs };
}

// これより少なくは描かない数。四隅担当（カードの枠を立ち上げる役）は最後まで残す
export function essentialCount(plan, minCount = 16) {
  const corners = plan.cursors.filter((c) => c.role === 'corner').length;
  return Math.min(plan.cursors.length, Math.max(minCount, corners));
}

// ---- 計画づくり ----
// targets: [{ id, rect:{x,y,w,h}, title?:{x,y,w,h}, descEnd?:{x,y}, typing?:{titleMs,totalMs} }]（カードの表示順）
// 戻り値: { seed, totalMs, viewport, scan, finishAt, cursors, reveals }
export function buildSwarmPlan({ targets = [], count = 48, totalMs = 8000, seed = 1, viewport, scan = true } = {}) {
  const T = Math.max(300, Number(totalMs) || 8000);
  const W = Math.max(100, Number(viewport && viewport.w) || 1280);
  const H = Math.max(100, Number(viewport && viewport.h) || 800);
  const list = (Array.isArray(targets) ? targets : []).filter((t) => {
    const r = t && t.rect;
    return r && [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v));
  });
  const n = list.length;
  const rnd = mulberry32(seed);
  const scale = clamp(T / 8000, 0.3, 1);
  const total = Math.max(Math.floor(Number(count)) || 0, n * 4);
  const typistN = Math.min(n, Math.max(0, total - n * 4));
  const finishAt = T * PHASE.finish;
  const cap = finishAt - 20;

  const cx = W / 2;
  const cy = H / 2;
  const inView = (p, m = 6) => ({ x: clamp(p.x, m, W - m), y: clamp(p.y, m, H - m) });

  const spawnPoint = () => {
    const edge = Math.floor(rnd() * 4);
    if (edge === 0) return { x: rnd() * W, y: -14 };
    if (edge === 1) return { x: W + 14, y: rnd() * H };
    if (edge === 2) return { x: rnd() * W, y: H + 14 };
    return { x: -14, y: rnd() * H };
  };

  // 時刻が昇順（同時刻は可）で、capを超えないように整える
  const tidy = (pts) => {
    let prev = 0;
    const out = pts.map((p) => {
      const t = Math.max(prev, Math.max(0, p.t));
      prev = t;
      return { ...p, t };
    });
    for (let k = out.length - 1; k >= 0; k--) {
      const lim = cap - (out.length - 1 - k) * 4;
      if (out[k].t > lim) out[k].t = Math.max(0, lim);
    }
    return out;
  };

  // spawn から holds（決まった場所・時刻）まで、画面の中をうろうろしてから向かう道すじ
  const route = (spawnAt, holds, anchor) => {
    const t0 = holds[0].t;
    const avail = t0 - spawnAt;
    const wps = [];
    if (avail >= 0.3 * T) {
      const flight = Math.min(avail * 0.45, 0.12 * T * (0.8 + 0.5 * rnd()));
      const span = avail - flight;
      const nW = clamp(Math.floor(span / (0.16 * T)), 1, 6);
      for (let k = 0; k < nW; k++) {
        const w = 0.2 + 0.6 * ((k + 1) / nW);
        const rp = { x: 12 + rnd() * (W - 24), y: 12 + rnd() * (H - 24) };
        const p = inView({ x: rp.x + (anchor.x - rp.x) * w, y: rp.y + (anchor.y - rp.y) * w }, 8);
        wps.push({ x: p.x, y: p.y, t: spawnAt + (span * (k + 1)) / nW });
      }
    }
    return tidy(wps.concat(holds));
  };

  // cursors の並びは「全カードの四隅担当 → 打ち込み担当 → 浮遊担当」。重いときは後ろから間引くので、
  // 浮遊・打ち込みから先に消え、四隅担当は最後まで残る（drawFrame は先頭から drawCount 個を描く）。
  const cursors = [];
  let serial = 0;
  const push = ({ role, cardId, anchor, holds, aim, flashAt }) => {
    serial += 1;
    const spawn = spawnPoint();
    const t0 = holds[0].t;
    const spawnAt = Math.min(rnd() * PHASE.spawnEnd * T, Math.max(0, t0 - 120 * scale));
    const waypoints = route(spawnAt, holds, anchor);
    const last = waypoints[waypoints.length - 1];
    const target = { x: last.x, y: last.y };
    // 仕上げ: 掃き線が通ったら、中心から外へ散る
    const leaveAt = Math.max(last.t, scan
      ? finishAt + PHASE.sweep * T * clamp(target.x / W, 0, 1)
      : finishAt + 0.06 * T * rnd());
    const exitAt = leaveAt + PHASE.exit * T;
    let dx = target.x - cx;
    let dy = target.y - cy;
    let len = Math.hypot(dx, dy);
    if (len < 1) { const a = rnd() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
    const far = 0.35 * Math.max(W, H) + 40;
    cursors.push({
      id: 'c' + pad2(serial),
      label: 'AGENT-' + pad2(serial),
      role,
      cardId,
      spawn,
      spawnAt,
      waypoints,
      arriveAt: last.t,
      target,
      aim: aim || target,
      flashAt: flashAt == null ? last.t : flashAt,
      leaveAt,
      exitAt,
      exit: { x: target.x + (dx / len) * far, y: target.y + (dy / len) * far },
      bend: (rnd() - 0.5) * 0.4,
    });
  };

  const stagger = 90 * scale;
  const revealAt = (i) => T * (PHASE.reveal0 + (n > 1 ? ((PHASE.reveal1 - PHASE.reveal0) * i) / (n - 1) : 0));

  // 1) 四隅担当（左上→右上→右下→左下の順に着く）
  list.forEach((tg, i) => {
    const r = tg.rect;
    const corners = [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ];
    corners.forEach((c, j) => {
      const p = inView(c, 4);
      push({ role: 'corner', cardId: tg.id, anchor: p, holds: [{ x: p.x, y: p.y, t: revealAt(i) + j * stagger }] });
    });
  });

  // 2) 打ち込み担当（文字が打たれる位置の少し先を追う。文字の上に居座らない）
  list.slice(0, typistN).forEach((tg, i) => {
    const r = tg.rect;
    const title = tg.title || { x: r.x + 22, y: r.y + 66, w: Math.min(200, Math.max(40, r.w - 44)), h: 24 };
    const typing = tg.typing || { titleMs: 420, totalMs: 1000 };
    const R = revealAt(i);
    const p1 = inView({ x: title.x + 6, y: title.y - 2 }, 4);
    const p2 = inView({ x: Math.min(title.x + title.w + 10, r.x + r.w - 8), y: title.y - 2 }, 4);
    const tTitle0 = R + 120;
    const tTitleEnd = R + 150 + Math.max(60, Number(typing.titleMs) || 0);
    let holds;
    if (cap - tTitle0 < 250) {
      holds = [{ x: p1.x, y: p1.y, t: Math.min(tTitle0, cap) }];
    } else {
      holds = [{ x: p1.x, y: p1.y, t: tTitle0 }, { x: p2.x, y: p2.y, t: tTitleEnd }];
      let tNext = tTitleEnd;
      if (tg.descEnd && Number.isFinite(tg.descEnd.x) && Number.isFinite(tg.descEnd.y)) {
        const pd = inView({ x: tg.descEnd.x + 10, y: tg.descEnd.y - 2 }, 4);
        tNext = Math.max(tTitleEnd + 60, R + 150 + (Number(typing.totalMs) || 0));
        holds.push({ x: pd.x, y: pd.y, t: tNext });
      }
      const park = inView({ x: r.x + 14, y: r.y + r.h - 18 }, 4);
      holds.push({ x: park.x, y: park.y, t: tNext + 400 });
    }
    push({ role: 'typist', cardId: tg.id, anchor: p1, holds: tidy(holds), aim: p1, flashAt: tidy(holds)[0].t });
  });

  // 3) 浮遊担当（カードのすき間をうろうろして、最後に端に止まる）
  const floaters = total - n * 4 - typistN;
  for (let k = 0; k < floaters; k++) {
    let p;
    if (n > 0) {
      const r = list[Math.floor(rnd() * n)].rect;
      const side = Math.floor(rnd() * 4);
      if (side === 0) p = { x: r.x + rnd() * r.w, y: r.y - 10 };
      else if (side === 1) p = { x: r.x + r.w + 10, y: r.y + rnd() * r.h };
      else if (side === 2) p = { x: r.x + rnd() * r.w, y: r.y + r.h + 10 };
      else p = { x: r.x - 10, y: r.y + rnd() * r.h };
    } else {
      p = { x: 12 + rnd() * (W - 24), y: 12 + rnd() * (H - 24) };
    }
    p = inView(p, 4);
    push({ role: 'float', cardId: null, anchor: p, holds: [{ x: p.x, y: p.y, t: T * (0.3 + 0.3 * rnd()) }] });
  }

  const reveals = list.map((tg) => {
    const own = cursors.filter((c) => c.cardId === tg.id && c.role === 'corner');
    return { cardId: tg.id, atMs: Math.min(...own.map((c) => c.arriveAt)) };
  });

  return { seed, totalMs: T, viewport: { w: W, h: H }, scan: !!scan, finishAt, cursors, reveals };
}

// ---- 位置 ----
function nodesOf(c) {
  return [
    { x: c.spawn.x, y: c.spawn.y, t: c.spawnAt },
    ...c.waypoints,
    { x: c.target.x, y: c.target.y, t: c.leaveAt },
    { x: c.exit.x, y: c.exit.y, t: c.exitAt },
  ];
}

// 時刻 tMs のカーソルの位置と濃さ。spawn → waypoints → target（到着後は止まる）→ 散る位置
export function positionAt(c, tMs) {
  const nodes = nodesOf(c);
  const t = Number(tMs) || 0;
  let x;
  let y;
  if (t <= nodes[0].t) {
    x = nodes[0].x; y = nodes[0].y;
  } else if (t >= nodes[nodes.length - 1].t) {
    const e = nodes[nodes.length - 1];
    x = e.x; y = e.y;
  } else {
    let k = 0;
    while (k < nodes.length - 2 && t >= nodes[k + 1].t) k++;
    const a = nodes[k];
    const b = nodes[k + 1];
    const span = b.t - a.t;
    const e = span > 0 ? easeInOutCubic((t - a.t) / span) : 1;
    x = a.x + (b.x - a.x) * e;
    y = a.y + (b.y - a.y) * e;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist > 40) {
      // 直線ではなく、ゆるく弧を描く（端では 0）
      const bump = Math.sin(Math.PI * e) * (c.bend || 0) * dist;
      x += (-(b.y - a.y) / dist) * bump;
      y += ((b.x - a.x) / dist) * bump;
    }
  }
  const fadeIn = clamp((t - c.spawnAt) / FADE_IN_MS, 0, 1);
  const outSpan = Math.max(1, (c.exitAt - c.leaveAt) * 0.4);
  const fadeOut = clamp((c.exitAt - t) / outSpan, 0, 1);
  return { x, y, alpha: Math.min(fadeIn, fadeOut) };
}

// ---- 描画 ----
function arrowPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 15);
  ctx.lineTo(3.6, 11.8);
  ctx.lineTo(6.2, 17.6);
  ctx.lineTo(8.6, 16.6);
  ctx.lineTo(6.1, 10.9);
  ctx.lineTo(10.8, 10.9);
  ctx.closePath();
}

// 任意の時刻 tMs の1コマを描く（同じ plan と t なら、いつでも同じ絵になる）
// view: { w, h, dpr, drawCount }（w/h は CSS ピクセル）
export function drawFrame(ctx, plan, tMs, view = {}) {
  const w = view.w || plan.viewport.w;
  const h = view.h || plan.viewport.h;
  const dpr = view.dpr || 1;
  const t = Number(tMs) || 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const shown = Math.max(0, Math.min(plan.cursors.length, view.drawCount == null ? plan.cursors.length : view.drawCount));
  const list = plan.cursors.slice(0, shown);
  const states = list.map((c) => ({ c, p: positionAt(c, t) })).filter((s) => s.p.alpha > 0.01);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 掃き線（仕上げ）
  if (plan.scan && t >= plan.finishAt && t <= plan.finishAt + PHASE.sweep * plan.totalMs) {
    const x = w * clamp((t - plan.finishAt) / (PHASE.sweep * plan.totalMs), 0, 1);
    const g = ctx.createLinearGradient(x - 70, 0, x, 0);
    g.addColorStop(0, 'rgba(31,107,82,0)');
    g.addColorStop(1, 'rgba(31,107,82,0.09)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, 0, 70, h);
    ctx.strokeStyle = 'rgba(31,107,82,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
    ctx.stroke();
  }

  // 軌跡と、目標への細い線
  for (const { c, p } of states) {
    const moving = t > c.spawnAt && !(t >= c.arriveAt && t < c.leaveAt);
    if (moving) {
      let prev = p;
      for (let k = 1; k <= TRAIL_SAMPLES; k++) {
        const q = positionAt(c, t - k * TRAIL_STEP_MS);
        const a = 0.5 * Math.min(p.alpha, q.alpha) * (1 - k / (TRAIL_SAMPLES + 1));
        if (a > 0.01 && (Math.abs(prev.x - q.x) + Math.abs(prev.y - q.y)) > 0.3) {
          ctx.strokeStyle = 'rgba(31,107,82,' + a.toFixed(3) + ')';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        prev = q;
      }
    }
    if (t < c.flashAt && Math.hypot(c.aim.x - p.x, c.aim.y - p.y) < 240) {
      ctx.strokeStyle = 'rgba(31,107,82,' + (0.35 * p.alpha).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(c.aim.x, c.aim.y);
      ctx.stroke();
    }
  }

  // 到着の照準（□が広がって消える）
  for (const { c } of states) {
    const u = (t - c.flashAt) / FLASH_MS;
    if (u < 0 || u >= 1) continue;
    const half = 4 + 14 * (1 - Math.pow(1 - u, 3));
    const a = 1 - u;
    ctx.save();
    ctx.shadowColor = 'rgba(31,107,82,0.7)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(31,107,82,' + a.toFixed(3) + ')';
    ctx.fillStyle = 'rgba(31,107,82,' + (0.12 * a).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.fillRect(c.aim.x - half, c.aim.y - half, half * 2, half * 2);
    ctx.strokeRect(c.aim.x - half + 0.5, c.aim.y - half + 0.5, half * 2, half * 2);
    ctx.beginPath();
    ctx.moveTo(c.aim.x - half - 4, c.aim.y); ctx.lineTo(c.aim.x - half + 3, c.aim.y);
    ctx.moveTo(c.aim.x + half - 3, c.aim.y); ctx.lineTo(c.aim.x + half + 4, c.aim.y);
    ctx.moveTo(c.aim.x, c.aim.y - half - 4); ctx.lineTo(c.aim.x, c.aim.y - half + 3);
    ctx.moveTo(c.aim.x, c.aim.y + half - 3); ctx.lineTo(c.aim.x, c.aim.y + half + 4);
    ctx.stroke();
    ctx.restore();
  }

  // カーソル本体と名札
  ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  const labelW = ctx.measureText('AGENT-00').width + 6;
  for (const { c, p } of states) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    arrowPath(ctx);
    ctx.fillStyle = COLOR_DARK;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    const typing = c.role === 'typist' && t >= c.flashAt && t < c.arriveAt;
    if (!typing) {
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.fillRect(11, 14, labelW, 11);
      ctx.strokeStyle = 'rgba(15,56,44,0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(11.5, 14.5, labelW - 1, 10);
      ctx.fillStyle = COLOR_DARK;
      ctx.fillText(c.label, 14, 19.5);
    }
    ctx.restore();
  }
}

// ---- 時計つきループ ----
// canvas が null のときは描かずに時計だけ動かす（onTick / onReveal / onDone は同じ）。
// 時間は rAF の差分で進め、タブが隠れている間は進めない。signal で即中止（onDone は呼ばない）。
export function runSwarm({ canvas, plan, onReveal, onTick, onDone, onError, signal } = {}) {
  let stopped = false;
  let raf = 0;
  let t = 0;
  let last = null;
  let revealIdx = 0;
  let frames = [];
  let lastAdaptMs = -Infinity;
  let drawCount = plan.cursors.length;
  const minCount = essentialCount(plan);
  let ctx = null;
  let view = null;

  const fit = () => {
    if (!canvas) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const w = canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : plan.viewport.w);
    const h = canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : plan.viewport.h);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    view = { w, h, dpr };
  };
  const onVis = () => { last = null; };
  const onResize = () => { try { fit(); } catch (e) { fail(e); } };

  function clear() {
    if (ctx && view) { ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.clearRect(0, 0, view.w, view.h); }
  }
  function cleanup() {
    stopped = true;
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  function stop() { if (!stopped) { cleanup(); try { clear(); } catch (e) { /* 何もしない */ } } }
  function onAbort() { stop(); }
  function fail(e) { if (stopped) return; stop(); if (onError) onError(e); }

  function frame(now) {
    if (stopped) return;
    try {
      if (last === null) last = now;
      const dt = clamp(now - last, 0, 100);
      last = now;
      t += dt;
      frames.push(dt);
      const st = adaptStep({ frames, count: drawCount, tMs: t, lastAdaptMs, minCount });
      frames = st.frames;
      drawCount = st.count;
      lastAdaptMs = st.lastAdaptMs;
      while (revealIdx < plan.reveals.length && plan.reveals[revealIdx].atMs <= t) {
        const r = plan.reveals[revealIdx++];
        if (onReveal) onReveal(r);
      }
      if (onTick) onTick(Math.min(t, plan.totalMs));
      if (t >= plan.totalMs) {
        stop();
        if (onDone) onDone();
        return;
      }
      if (ctx) drawFrame(ctx, plan, t, { ...view, drawCount });
      raf = requestAnimationFrame(frame);
    } catch (e) {
      fail(e);
    }
  }

  try {
    if (signal && signal.aborted) { stopped = true; return { stop }; }
    if (canvas) {
      ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d が使えません');
      fit();
      window.addEventListener('resize', onResize);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    if (signal) signal.addEventListener('abort', onAbort);
    raf = requestAnimationFrame(frame);
  } catch (e) {
    fail(e);
  }
  return { stop };
}
