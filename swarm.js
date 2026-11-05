// Web Tools Arsenal - 「AIカーソルがページを組み立てる」演出（設計図 → 中身の2段階）
// 流れ: ①中央でカーソルが渦を巻く（SCANNING PAGE...） ②部品ごとに設計図の四角が広がる（BUILDING LAYOUT）
//       ③赤い縦線が左→右へ通り、通った所から中身が埋まる（FILLING CONTENT） ④散って終わる（READY）
// 計画づくり（buildSwarmPlan / positionAt / boxAt / lineX / statusAt など）は DOM に触らない純粋な関数。node でテストできる。
// 描画（drawFrame）と時計つきループ（runSwarm）だけがブラウザ（Canvas 2D）を使う。

// ---- 時間の配分（totalMs に対する割合）----
export const PHASE = {
  scanEnd: 0.17, // 0〜17%: 中央の渦（SCANNING PAGE...）
  scoutSpawnEnd: 0.09, // 渦のカーソル（約8個）がこの時刻までに出そろう
  layout1: 0.46, // 17〜46%: 設計図の四角が順に広がる（BUILDING LAYOUT）
  agentsFull: 0.40, // エージェント数がこの時刻に最終の数になる
  fill0: 0.46, // 46%〜: 赤い前線が左から右へ（FILLING CONTENT）
  lineEnd: 0.75, // 前線が右端に着く
  rowShift: 0.02, // 同じ列の帯は行ごとに約70msずらす（最大このぶん＝7秒で140ms。線が通ってから出るまでの遅れを短く）
  rowStepMs: 70,
  ready: 0.86, // 86%〜: READY（補助線・カーソルが消える）
  leave: 0.93, // 状態バーがフェードアウトを始める
  fade: 0.09, // 中身が出てから設計図の四角が消えるまで
  fill: 0.05, // 1つの部品の「レイヤー数」が加算され終わるまで
  exit: 0.08, // カーソルが画面の外へ散る時間
  leaveJitter: 0.04,
};
// スクロールで入ったカード用の短い版（赤い線・渦なし）
export const MINI = { layout0: 0.22, layout1: 0.62, reveal: 0.06, ready: 0.72, fade: 0.25, exit: 0.16, leaveJitter: 0.05 };

export const STAGE_TEXT = { scan: 'SCANNING PAGE...', layout: 'BUILDING LAYOUT', fill: 'FILLING CONTENT', ready: 'READY' };
export const AGENT_COLORS = ['#0F382C', '#0E9AA7', '#2F6FDE', '#D6467F', '#7B55D9'];

const BASE_MS = 7000;
const SCOUTS = 8;
const START_BOX = 24; // 設計図の四角は、左上の約24×24から広がる
const TYPE_START_MS = 150; // app.js の打ち込み開始の遅れと同じ
const TRAIL_SAMPLES = 6;
const TRAIL_STEP_MS = 12;
const TRAIL_MAX_PX = 48; // 軌跡は短く（速く動いても約48pxまで）
const FADE_IN_MS = 160;
const GREEN = [31, 107, 82]; // #1F6B52
const DEEP = [15, 56, 44]; // #0F382C
const RED = [229, 72, 77]; // #E5484D

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad2 = (n) => String(n).padStart(2, '0');
const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')';
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const AGENT_RGB = AGENT_COLORS.map(hexRgb);
const snap = (v) => Math.round(v) + 0.5;

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

// 画面の広さに比例したエージェント（カーソル）の数（最小10・最大40）。PC 1440×900 で36、スマホ 390×844 で18。
export function swarmCount(view) {
  const w = Math.max(0, Number(view && view.w) || 0);
  const h = Math.max(0, Number(view && view.h) || 0);
  const per = w >= 900 ? 36000 : 18000;
  return clamp(Math.round((w * h) / per), 10, 40);
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

// これより少なくは描かないカーソルの数（渦のカーソル約8個）。設計図の四角はカーソルと別に描くので、間引いても消えない
export function essentialCount(plan, minCount = SCOUTS) {
  const n = plan && Array.isArray(plan.cursors) ? plan.cursors.length : 0;
  return Math.min(n, Math.max(0, Math.floor(Number(minCount)) || 0));
}

// 渦の位置（中央のまわりを回る。半径はゆっくり伸び縮み）
function swirlPos(s, t) {
  const ang = s.a0 + s.omega * t;
  const r = s.r * (1 + 0.22 * Math.sin(t * s.wob + s.ph));
  return { x: s.cx + Math.cos(ang) * r, y: s.cy + Math.sin(ang) * r * 0.82 };
}

// 赤い前線が x を通る時刻
function lineTimeAt(T, W, x) {
  return T * (PHASE.fill0 + (PHASE.lineEnd - PHASE.fill0) * clamp(x / W, 0, 1));
}

// ---- 計画づくり ----
// targets: [{ id, kind?:'card'|'label', rect:{x,y,w,h}, parts?:[{x,y,w,h}], title?:{x,y,w,h}, body?:[{x,y,w,h}],
//             descEnd?:{x,y}, typing?:{titleMs,totalMs} }]（表示順）
// scan=true: 起動のフル版（渦・赤い前線あり）。scan=false: スクロール登場の短い版。
// 戻り値: { seed, totalMs, viewport, scan, readyAt, lineStart, lineEnd, boxes, cursors, reveals }
export function buildSwarmPlan({ targets = [], count = 32, totalMs = BASE_MS, seed = 1, viewport, scan = true } = {}) {
  const T = Math.max(300, Number(totalMs) || BASE_MS);
  const W = Math.max(100, Number(viewport && viewport.w) || 1280);
  const H = Math.max(100, Number(viewport && viewport.h) || 800);
  const isScan = !!scan;
  const list = (Array.isArray(targets) ? targets : []).filter((t) => {
    const r = t && t.rect;
    return r && [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v));
  });
  const n = list.length;
  const rnd = mulberry32(seed);
  const scale = clamp(T / BASE_MS, 0.12, 1);
  const N = Math.max(0, Math.floor(Number(count)) || 0);
  const cx = W / 2;
  const cy = H / 2;
  const inView = (p, m = 4) => ({ x: clamp(p.x, m, W - m), y: clamp(p.y, m, H - m) });
  const finiteBox = (r) => r && [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v));

  const L0 = (isScan ? PHASE.scanEnd : MINI.layout0) * T;
  const L1 = (isScan ? PHASE.layout1 : MINI.layout1) * T;
  const grow = isScan ? Math.min(450, 0.07 * T) : Math.min(320, 0.3 * T);
  const readyAt = (isScan ? PHASE.ready : MINI.ready) * T;
  const lineStart = PHASE.fill0 * T;
  const lineEnd = PHASE.lineEnd * T;

  // 同じ列（左端の x がほぼ同じ）の中での行の番号。同じ列の部品は、上の行から少しずつ遅れて埋まる。
  // 1行あたり約70ms。ただし列の行が多いときは、合計が rowShift（0.02T）に収まるように間隔を詰める
  const sameCol = (a, b) => Math.abs(a.rect.x - b.rect.x) <= 12;
  const rowOf = list.map((tg, i) => list.filter((o, j) => j !== i && sameCol(o, tg)
    && (o.rect.y < tg.rect.y - 8 || (Math.abs(o.rect.y - tg.rect.y) <= 8 && j < i))).length);
  const rowStep = list.map((tg) => {
    const rows = list.filter((o) => sameCol(o, tg)).length;
    return Math.min(PHASE.rowStepMs * scale, (PHASE.rowShift * T) / Math.max(1, rows - 1));
  });

  // 1) 設計図の四角（表示順に広がり、前線が通ったら中身が埋まって消える）
  const span = Math.max(0, L1 - L0 - grow);
  const boxes = list.map((tg, i) => {
    const r = { x: tg.rect.x, y: tg.rect.y, w: Math.max(0, tg.rect.w), h: Math.max(0, tg.rect.h) };
    const appearAt = L0 + (n > 1 ? (span * i) / (n - 1) : 0);
    const growEnd = appearAt + grow;
    const revealAt = isScan
      ? Math.max(growEnd, lineTimeAt(T, W, r.x) + Math.min(rowOf[i] * rowStep[i], PHASE.rowShift * T))
      : growEnd + MINI.reveal * T;
    const fadeEnd = Math.max(revealAt + 1, Math.min(revealAt + (isScan ? PHASE.fade : MINI.fade) * T, 0.95 * T));
    const kind = tg.kind === 'label' ? 'label' : 'card';
    const parts = (Array.isArray(tg.parts) ? tg.parts : []).filter(finiteBox).map((p, k) => {
      const a = growEnd + k * 70 * scale;
      return { rect: { x: p.x, y: p.y, w: Math.max(0, p.w), h: Math.max(0, p.h) }, appearAt: a, growEnd: a + 180 * scale };
    }).filter((p) => p.appearAt < revealAt);
    const box = {
      id: tg.id,
      kind,
      rect: r,
      appearAt,
      growEnd,
      revealAt,
      fadeEnd,
      redMs: isScan ? 300 * scale : 0,
      fillMs: Math.max(1, Math.min(PHASE.fill * T, readyAt - revealAt)),
      layers: kind === 'card' ? 8 : 3,
      parts,
    };
    if (finiteBox(tg.title)) box.title = { ...tg.title };
    if (Array.isArray(tg.body)) box.body = tg.body.filter(finiteBox).map((b) => ({ ...b }));
    if (tg.typing && Number.isFinite(tg.typing.totalMs)) {
      box.typing = { startMs: TYPE_START_MS, titleMs: Math.max(0, Number(tg.typing.titleMs) || 0), totalMs: Math.max(0, tg.typing.totalMs) };
    }
    if (tg.descEnd && Number.isFinite(tg.descEnd.x) && Number.isFinite(tg.descEnd.y)) box.descEnd = { x: tg.descEnd.x, y: tg.descEnd.y };
    return box;
  });

  // 2) カーソル（先頭の約8個が渦のカーソル。残りは BUILDING LAYOUT の間に順に増える）
  const speed = 1.1 / Math.max(scale, 0.45); // px / ms（短い版でも速くなりすぎない）
  const minHop = 160 * scale;
  // 遠い移動ほど速く（200px→1倍、600px以上→約2.3倍）。渦から画面の端の四角へも、広がりの途中で追いつける
  const travel = (a, b) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.max(minHop, d / (speed * (1 + 1.3 * clamp((d - 200) / 400, 0, 1))));
  };
  const scouts = isScan ? Math.min(SCOUTS, N) : 0;
  const st = [];
  for (let i = 0; i < N; i++) {
    let spawnAt;
    let spawn;
    let swirl = null;
    let start;
    if (i < scouts) {
      spawnAt = (PHASE.scoutSpawnEnd * T * (i + 1)) / scouts;
      swirl = {
        cx, cy,
        r: 16 + 46 * rnd(),
        a0: rnd() * Math.PI * 2,
        omega: ((Math.PI * 2) / 1300) * (0.75 + 0.5 * rnd()),
        wob: 0.004 + 0.004 * rnd(),
        ph: rnd() * Math.PI * 2,
        end: 0,
      };
      // SCANNING PAGE... の表示が終わる（0.17T）まで渦を続け、そのあと外へばらける
      swirl.end = Math.max(spawnAt + 40 * scale, T * (PHASE.scanEnd + 0.005 * rnd()));
      spawn = swirlPos(swirl, spawnAt);
      const p = swirlPos(swirl, swirl.end);
      start = { x: p.x, y: p.y, t: swirl.end };
    } else if (isScan) {
      const rest = N - scouts;
      spawnAt = L0 + ((PHASE.agentsFull * T - L0) * (i - scouts + 1)) / rest;
      spawn = { x: cx + (rnd() - 0.5) * 30, y: cy + (rnd() - 0.5) * 30 };
      start = { x: spawn.x, y: spawn.y, t: spawnAt };
    } else {
      // 短い版: 対象のカードに一番近い画面の端の外から入ってくる
      spawnAt = rnd() * 0.06 * T;
      const r = n > 0 ? boxes[i % n].rect : { x: cx, y: cy, w: 0, h: 0 };
      const mx = clamp(r.x + r.w * rnd(), 0, W);
      const my = clamp(r.y + r.h * rnd(), 0, H);
      const d = [my, W - mx, H - my, mx];
      const e = d.indexOf(Math.min(...d));
      spawn = e === 0 ? { x: mx, y: -14 } : e === 1 ? { x: W + 14, y: my } : e === 2 ? { x: mx, y: H + 14 } : { x: -14, y: my };
      start = { x: spawn.x, y: spawn.y, t: spawnAt };
    }
    st.push({ spawnAt, spawn, swirl, start, pos: { x: start.x, y: start.y }, freeAt: start.t, keys: [], used: 0 });
  }

  // 空いている時間に、四角のハンドルのまわりや画面の中をうろうろする
  const wanderPoint = (tNow) => {
    const ready = boxes.filter((b) => b.appearAt <= tNow && b.fadeEnd > tNow);
    if (ready.length && rnd() < 0.8) {
      const r = ready[Math.floor(rnd() * ready.length)].rect;
      const hx = [r.x, r.x + r.w / 2, r.x + r.w][Math.floor(rnd() * 3)];
      const hy = [r.y, r.y + r.h / 2, r.y + r.h][Math.floor(rnd() * 3)];
      return inView({ x: hx + (rnd() - 0.5) * 36, y: hy + (rnd() - 0.5) * 36 }, 8);
    }
    return { x: 16 + rnd() * (W - 32), y: 16 + rnd() * (H - 32) };
  };
  const wanderUntil = (s, at, next) => {
    for (let guard = 0; guard < 40; guard++) {
      if (at - s.freeAt - travel(s.pos, next) < 650 * scale) return;
      const wp = wanderPoint(s.freeAt + 300 * scale);
      const tw = s.freeAt + Math.max(travel(s.pos, wp), (380 + 320 * rnd()) * scale);
      if (tw + travel(wp, next) > at) return;
      s.keys.push({ x: wp.x, y: wp.y, t: tw });
      s.pos = wp;
      s.freeAt = tw;
      const pause = (120 + 220 * rnd()) * scale;
      if (s.freeAt + pause + travel(wp, next) <= at) {
        s.freeAt += pause;
        s.keys.push({ x: wp.x, y: wp.y, t: s.freeAt });
      }
    }
  };
  const pick = (pos, at, avoid) => {
    let best = -1;
    let bestScore = Infinity;
    st.forEach((s, j) => {
      if (avoid && avoid.has(j)) return;
      if (s.spawnAt > at - minHop) return;
      if (s.freeAt + travel(s.pos, pos) > at) return;
      const score = Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) + s.used * 60 + rnd() * 30;
      if (score < bestScore) { bestScore = score; best = j; }
    });
    return best;
  };
  const go = (j, pos, at, drag) => {
    const s = st[j];
    wanderUntil(s, at, pos);
    s.keys.push({ x: pos.x, y: pos.y, t: at, ...(drag ? { drag } : {}) });
    s.pos = { x: pos.x, y: pos.y };
    s.freeAt = at;
  };
  const hold = (j, ms) => {
    const s = st[j];
    s.freeAt += Math.max(0, ms);
    s.keys.push({ x: s.pos.x, y: s.pos.y, t: s.freeAt });
  };

  // 2a) 四角を広げる係: 右下のハンドルをつかんで一緒に動く。手伝い係がほかのハンドルのそばに来る
  boxes.forEach((b) => {
    const r = b.rect;
    const p0 = inView({ x: r.x + Math.min(START_BOX, r.w), y: r.y + Math.min(START_BOX, r.h) });
    const p1 = inView({ x: r.x + r.w, y: r.y + r.h });
    const used = new Set();
    // 間に合わないときは、広がっている途中のハンドルに追いついて、そこから一緒に動く
    const drag = { t0: b.appearAt, x0: p0.x, y0: p0.y };
    for (const f of [0, 0.3, 0.55, 0.8]) {
      const tj = b.appearAt + f * (b.growEnd - b.appearAt);
      const e = easeInOutCubic(f);
      const pj = { x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e };
      const g = pick(pj, tj, used);
      if (g < 0) continue;
      used.add(g);
      st[g].used += 1;
      go(g, pj, tj);
      go(g, p1, b.growEnd, drag);
      hold(g, 120 * scale);
      break;
    }
    const helpers = isScan ? (rnd() < 0.7 ? 1 : 0) : 2;
    for (let k = 0; k < helpers; k++) {
      let pos;
      let at;
      if (isScan) {
        const hx = [r.x, r.x + r.w / 2, r.x + r.w][Math.floor(rnd() * 3)];
        const hy = [r.y, r.y + r.h][Math.floor(rnd() * 2)];
        pos = inView({ x: hx, y: hy });
        at = b.growEnd + rnd() * 150 * scale;
      } else if (k === 0) {
        pos = inView({ x: r.x, y: r.y });
        at = b.appearAt;
      } else {
        pos = inView({ x: r.x + r.w, y: r.y });
        at = b.growEnd;
      }
      const j = pick(pos, at, used);
      if (j < 0) continue;
      used.add(j);
      st[j].used += 1;
      go(j, pos, at);
      hold(j, isScan ? (250 + 200 * rnd()) * scale : Math.max(100 * scale, b.growEnd + 100 * scale - at));
    }
  });

  // 2b) 打ち込み係: 中身が埋まるカードの、文字が打たれる位置の少し先を追う（READY より後にははみ出さない）
  if (isScan) {
    boxes
      .filter((b) => b.kind === 'card' && b.title && b.typing)
      .sort((a, b) => a.revealAt - b.revealAt)
      .forEach((b) => {
        const t0 = b.revealAt + b.typing.startMs;
        const tTitle = t0 + Math.max(60 * scale, b.typing.titleMs);
        if (tTitle > readyAt - 100 * scale) return;
        const p1 = inView({ x: b.title.x + 4, y: b.title.y - 2 });
        const p2 = inView({ x: b.title.x + b.title.w + 10, y: b.title.y - 2 });
        const j = pick(p1, t0);
        if (j < 0) return;
        st[j].used += 1;
        go(j, p1, t0);
        go(j, p2, tTitle);
        const tDesc = t0 + b.typing.totalMs;
        if (b.descEnd && tDesc > tTitle + 60 * scale && tDesc <= readyAt - 100 * scale) {
          go(j, inView({ x: b.descEnd.x + 10, y: b.descEnd.y - 2 }), tDesc);
        }
      });
  }

  // 2c) 最後: READY のあと、中央から外へ散る
  const exitMs = (isScan ? PHASE.exit : MINI.exit) * T;
  const jitter = (isScan ? PHASE.leaveJitter : MINI.leaveJitter) * T;
  const cursors = st.map((s, i) => {
    let leaveAt = readyAt + rnd() * jitter;
    leaveAt = Math.max(s.start.t, Math.min(Math.max(leaveAt, s.freeAt), T - exitMs));
    wanderUntil(s, leaveAt, s.pos);
    // 時刻が昇順（同時刻は可）で、leaveAt を超えないように整える
    let prev = s.start.t;
    const waypoints = s.keys.map((k) => {
      const t = clamp(Math.max(prev, k.t), prev, leaveAt);
      prev = t;
      return { ...k, t };
    });
    const last = waypoints.length ? waypoints[waypoints.length - 1] : s.start;
    waypoints.push({ x: last.x, y: last.y, t: leaveAt });
    const target = { x: last.x, y: last.y };
    let dx = target.x - cx;
    let dy = target.y - cy;
    let len = Math.hypot(dx, dy);
    if (len < 1) { const a = rnd() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
    const far = 0.6 * Math.max(W, H) + 40;
    return {
      id: 'c' + pad2(i + 1),
      role: s.swirl ? 'scout' : 'agent',
      color: AGENT_COLORS[i % AGENT_COLORS.length],
      colorIndex: i % AGENT_COLORS.length,
      spawn: s.spawn,
      spawnAt: s.spawnAt,
      swirl: s.swirl,
      start: s.start,
      waypoints,
      target,
      leaveAt,
      exitAt: leaveAt + exitMs,
      exit: { x: target.x + (dx / len) * far, y: target.y + (dy / len) * far },
      bend: (rnd() - 0.5) * 0.35,
    };
  });

  const reveals = boxes
    .map((b) => ({ cardId: b.id, kind: b.kind, atMs: b.revealAt }))
    .sort((a, b) => a.atMs - b.atMs);

  return { seed, totalMs: T, viewport: { w: W, h: H }, scan: isScan, readyAt, lineStart, lineEnd, boxes, cursors, reveals };
}

// ---- 位置・形 ----
// 赤い前線の x（0〜画面の幅。時間とともに増えるだけ）
export function lineX(plan, tMs) {
  if (!plan || typeof plan !== 'object') return 0; // null / undefined / NaN などでも落ちない
  const W = Number(plan.viewport && plan.viewport.w) || 0;
  const a = Number(plan.lineStart);
  const b = Number(plan.lineEnd);
  if (!(W > 0) || !(b > a)) return 0;
  return W * clamp(((Number(tMs) || 0) - a) / (b - a), 0, 1);
}

// 時刻 tMs の設計図の四角。見えない時刻は null。
// 戻り値: { x, y, w, h, a（輪郭の濃さ 0..1）, fillA（塗りの濃さ）, red（赤い縁の強さ）, u（広がり 0..1） }
export function boxAt(b, tMs) {
  const t = Number(tMs) || 0;
  if (!b || t < b.appearAt || t >= b.fadeEnd) return null;
  const r = b.rect;
  const w0 = Math.min(START_BOX, r.w);
  const h0 = Math.min(START_BOX, r.h);
  const u = b.growEnd > b.appearAt ? easeInOutCubic((t - b.appearAt) / (b.growEnd - b.appearAt)) : 1;
  let a = Math.min(1, 0.35 + (t - b.appearAt) / 90);
  let fillA = 1;
  let red = 0;
  if (t >= b.revealAt) {
    const v = clamp((t - b.revealAt) / (b.fadeEnd - b.revealAt), 0, 1);
    a *= Math.pow(1 - v, 1.4);
    fillA = Math.pow(1 - v, 3);
    red = b.redMs > 0 ? clamp(1 - (t - b.revealAt) / b.redMs, 0, 1) : 0;
  }
  return { x: r.x, y: r.y, w: w0 + (r.w - w0) * u, h: h0 + (r.h - h0) * u, a, fillA, red, u };
}

function nodesOf(c) {
  return [
    { x: c.start.x, y: c.start.y, t: c.start.t },
    ...c.waypoints,
    { x: c.exit.x, y: c.exit.y, t: c.exitAt },
  ];
}

// 時刻 tMs のカーソルの位置と濃さ。渦（あれば）→ 道すじ（drag の区間は四角の角と同じ動き）→ 散る位置
export function positionAt(c, tMs) {
  const t = Number(tMs) || 0;
  let x;
  let y;
  if (c.swirl && t < c.swirl.end) {
    const p = swirlPos(c.swirl, Math.max(t, c.spawnAt));
    x = p.x; y = p.y;
  } else {
    const nodes = nodesOf(c);
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
      // drag の区間は四角の広がりと同じ easing（角のハンドルにぴったり付く）。移動はなめらかな sine（最高速を抑える）
      const u = span > 0 ? (t - a.t) / span : 1;
      const d = b.drag;
      if (d) {
        // 角をつかんでいる区間: 四角の広がり（d.t0〜b.t）と同じ式。途中から追いついた場合も、ぴったり重なる
        const e = b.t > d.t0 ? easeInOutCubic((t - d.t0) / (b.t - d.t0)) : 1;
        x = d.x0 + (b.x - d.x0) * e;
        y = d.y0 + (b.y - d.y0) * e;
      } else {
        const e = (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2;
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
    }
  }
  const fadeIn = clamp((t - c.spawnAt) / FADE_IN_MS, 0, 1);
  const outSpan = Math.max(1, (c.exitAt - c.leaveAt) * 0.4);
  const fadeOut = clamp((c.exitAt - t) / outSpan, 0, 1);
  return { x, y, alpha: Math.min(fadeIn, fadeOut) };
}

// 状態バーの中身（エージェント数・完成レイヤー数は時間とともに増えるだけ）
export function stageOf(p) {
  if (p < PHASE.scanEnd) return 'scan';
  if (p < PHASE.fill0) return 'layout';
  if (p < PHASE.ready) return 'fill';
  return 'ready';
}
export function statusAt(plan, tMs) {
  const T = (plan && plan.totalMs) || 0;
  const t = clamp(Number(tMs) || 0, 0, T);
  const stage = T > 0 ? stageOf(t / T) : 'ready';
  const cursors = (plan && Array.isArray(plan.cursors)) ? plan.cursors : [];
  const boxes = (plan && Array.isArray(plan.boxes)) ? plan.boxes : [];
  const spawned = cursors.filter((c) => c.spawnAt <= t);
  let layers = 0;
  let totalLayers = 0;
  for (const b of boxes) {
    const n = b.layers || 0;
    totalLayers += n;
    layers += Math.round(n * clamp((t - b.revealAt) / (b.fillMs || 1), 0, 1));
  }
  return {
    stage,
    text: STAGE_TEXT[stage],
    agents: spawned.length,
    layers,
    totalLayers,
    colors: spawned.slice(0, 6).map((c) => c.color),
  };
}

// ---- 描画 ----
function arrowPath(ctx) {
  // 約12pxの小さな矢印
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 10.2);
  ctx.lineTo(2.5, 8);
  ctx.lineTo(4.3, 12);
  ctx.lineTo(5.9, 11.3);
  ctx.lineTo(4.2, 7.4);
  ctx.lineTo(7.4, 7.4);
  ctx.closePath();
}

function drawHex(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// 打ち込み中の文字の範囲に、選択範囲のような薄いハイライトを、打ち込みの進み具合に合わせて伸ばす
function drawHighlight(ctx, b, t) {
  const ty = b.typing;
  if (!ty || !b.title) return;
  const t0 = b.revealAt + ty.startMs;
  if (t < t0) return;
  const total = Math.max(1, ty.totalMs);
  const fade = clamp(1 - (t - (t0 + total + 250)) / 250, 0, 1);
  if (fade <= 0) return;
  ctx.fillStyle = rgba(DEEP, 0.14 * fade);
  const tm = Math.max(1, ty.titleMs);
  const u1 = clamp((t - t0) / tm, 0, 1);
  ctx.fillRect(b.title.x, b.title.y, b.title.w * u1, b.title.h);
  const body = b.body || [];
  if (body.length && t > t0 + tm) {
    const v = clamp((t - t0 - tm) / Math.max(1, total - tm), 0, 1);
    let left = v * body.reduce((s, r) => s + r.w, 0);
    for (const r of body) {
      const ww = Math.min(r.w, left);
      if (ww <= 0) break;
      ctx.fillRect(r.x, r.y, ww, r.h);
      left -= ww;
    }
  }
}

// 任意の時刻 tMs の1コマを描く（同じ plan と t なら、いつでも同じ絵になる）
// view: { w, h, dpr, drawCount, lite }（w/h は CSS ピクセル。lite=true のときは補助線・寸法ラベル・軌跡・影を省く）
export function drawFrame(ctx, plan, tMs, view = {}) {
  const w = view.w || plan.viewport.w;
  const h = view.h || plan.viewport.h;
  const dpr = view.dpr || 1;
  const t = Number(tMs) || 0;
  const lite = !!view.lite;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  const shownBoxes = (plan.boxes || []).map((b) => ({ b, s: boxAt(b, t) })).filter((x) => x.s && x.s.a > 0.005);

  // 補助線（四角の上下左右の辺から、画面の端まで）
  if (!lite) {
    ctx.lineWidth = 1;
    for (const { s } of shownBoxes) {
      const a = 0.22 * s.a * s.a;
      if (a < 0.01) continue;
      ctx.strokeStyle = rgba(GREEN, a);
      ctx.beginPath();
      const L = snap(s.x); const R = snap(s.x + s.w); const Tp = snap(s.y); const B = snap(s.y + s.h);
      ctx.moveTo(0, Tp); ctx.lineTo(w, Tp);
      ctx.moveTo(0, B); ctx.lineTo(w, B);
      ctx.moveTo(L, 0); ctx.lineTo(L, h);
      ctx.moveTo(R, 0); ctx.lineTo(R, h);
      ctx.stroke();
    }
  }

  // 四角（薄い塗り＋細い輪郭）と、中の部品（見出し・段落・アイコン）の小さな四角
  for (const { b, s } of shownBoxes) {
    ctx.fillStyle = rgba(GREEN, 0.08 * s.fillA * s.a);
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = s.red > 0 ? rgba(RED, 0.25 + 0.65 * s.red) : rgba(GREEN, 0.7 * s.a);
    ctx.strokeRect(snap(s.x), snap(s.y), Math.max(0, Math.round(s.w) - 1), Math.max(0, Math.round(s.h) - 1));
    for (const p of b.parts) {
      if (t < p.appearAt) continue;
      const u = p.growEnd > p.appearAt ? easeInOutCubic((t - p.appearAt) / (p.growEnd - p.appearAt)) : 1;
      const pw = Math.min(8, p.rect.w) + (p.rect.w - Math.min(8, p.rect.w)) * u;
      const ph = Math.min(8, p.rect.h) + (p.rect.h - Math.min(8, p.rect.h)) * u;
      ctx.fillStyle = rgba(GREEN, 0.06 * s.fillA * s.a);
      ctx.fillRect(p.rect.x, p.rect.y, pw, ph);
      ctx.strokeStyle = s.red > 0 ? rgba(RED, 0.2 + 0.6 * s.red) : rgba(GREEN, 0.5 * s.a);
      ctx.strokeRect(snap(p.rect.x), snap(p.rect.y), Math.max(0, Math.round(pw) - 1), Math.max(0, Math.round(ph) - 1));
    }
  }

  // 打ち込み中の選択ハイライト
  for (const b of plan.boxes || []) drawHighlight(ctx, b, t);

  // 赤い前線（細い線＋弱いグロー。通った後ろに薄い帯）
  if (plan.scan && t >= plan.lineStart && t <= plan.lineEnd) {
    const x = snap(lineX(plan, t));
    const g = ctx.createLinearGradient(x - 60, 0, x, 0);
    g.addColorStop(0, rgba(RED, 0));
    g.addColorStop(1, rgba(RED, 0.06));
    ctx.fillStyle = g;
    ctx.fillRect(x - 60, 0, 60, h);
    ctx.strokeStyle = rgba(RED, 0.16);
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.strokeStyle = rgba(RED, 0.95);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }

  // 選択ハンドル（角と辺の中点の 5px の■）
  ctx.lineWidth = 1;
  for (const { s } of shownBoxes) {
    const a = s.a * s.a;
    if (a < 0.02) continue;
    const xs = [s.x, s.x + s.w / 2, s.x + s.w];
    const ys = [s.y, s.y + s.h / 2, s.y + s.h];
    ctx.fillStyle = rgba([255, 255, 255], a);
    ctx.strokeStyle = s.red > 0 ? rgba(RED, a) : rgba(GREEN, a);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === 1 && j === 1) continue;
        const px = Math.round(xs[i]) - 2;
        const py = Math.round(ys[j]) - 2;
        ctx.fillRect(px, py, 5, 5);
        ctx.strokeRect(px + 0.5, py + 0.5, 4, 4);
      }
    }
  }

  // 寸法ラベル（W×H。四角が広がる間は数字も増える）
  if (!lite && shownBoxes.length) {
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    for (const { s } of shownBoxes) {
      const a = s.a * s.a;
      if (a < 0.03) continue;
      const text = Math.round(s.w) + '×' + Math.round(s.h);
      const tw = Math.ceil(ctx.measureText(text).width) + 6;
      const lx = clamp(Math.round(s.x + s.w - tw), 2, Math.max(2, w - tw - 2));
      let ly = Math.round(s.y + s.h + 4);
      if (ly + 12 > h - 2) ly = Math.round(s.y + s.h - 16);
      ctx.fillStyle = rgba(GREEN, 0.9 * a);
      ctx.fillRect(lx, ly, tw, 12);
      ctx.fillStyle = rgba([255, 255, 255], a);
      ctx.fillText(text, lx + 3, ly + 6.5);
    }
  }

  // 中央の小さな六角形（スキャン中）
  if (plan.scan) {
    const T = plan.totalMs;
    const ha = 1 - clamp((t - PHASE.scanEnd * T) / (0.05 * T), 0, 1);
    if (ha > 0.01) {
      const hx = w / 2;
      const hy = h / 2;
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = rgba(GREEN, 0.9 * ha);
      drawHex(ctx, hx, hy, 9);
      ctx.stroke();
      ctx.fillStyle = rgba(GREEN, 0.55 * ha);
      drawHex(ctx, hx, hy, 3.5);
      ctx.fill();
      const pu = (t % 1200) / 1200;
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(GREEN, 0.35 * (1 - pu) * ha);
      drawHex(ctx, hx, hy, 10 + 14 * pu);
      ctx.stroke();
    }
  }

  // カーソル（多色の小さな矢印。短い軌跡つき。名札は無し）
  const shown = Math.max(0, Math.min(plan.cursors.length, view.drawCount == null ? plan.cursors.length : view.drawCount));
  const states = [];
  for (let i = 0; i < shown; i++) {
    const c = plan.cursors[i];
    const p = positionAt(c, t);
    if (p.alpha > 0.01) states.push({ c, p });
  }
  if (!lite) {
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;
    for (const { c, p } of states) {
      const col = AGENT_RGB[c.colorIndex] || DEEP;
      let prev = p;
      let len = 0;
      for (let k = 1; k <= TRAIL_SAMPLES && len < TRAIL_MAX_PX; k++) {
        const q = positionAt(c, t - k * TRAIL_STEP_MS);
        const a = 0.3 * Math.min(p.alpha, q.alpha) * (1 - k / (TRAIL_SAMPLES + 1));
        len += Math.hypot(q.x - prev.x, q.y - prev.y);
        if (a > 0.01 && (Math.abs(prev.x - q.x) + Math.abs(prev.y - q.y)) > 0.3) {
          ctx.strokeStyle = rgba(col, a);
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        prev = q;
      }
    }
    ctx.lineCap = 'butt';
  }
  ctx.lineJoin = 'round';
  for (const { c, p } of states) {
    const col = AGENT_RGB[c.colorIndex] || DEEP;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2);
    if (!lite) {
      ctx.shadowColor = rgba(col, 0.35);
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
    }
    arrowPath(ctx);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
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
      // 一度でも間引いたら、補助線・寸法ラベル・軌跡も省く（設計図の四角とハンドルは残る）
      if (ctx) drawFrame(ctx, plan, t, { ...view, drawCount, lite: drawCount < plan.cursors.length });
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
