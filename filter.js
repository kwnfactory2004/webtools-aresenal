// ツールの検索とタグ絞り込み。tools.json を読み直し、カードのリンクで対応づける（app.js には触らない）
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

async function main() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  let tools;
  try {
    const res = await fetch('tools.json');
    if (!res.ok) return;
    const data = await res.json();
    tools = Array.isArray(data?.tools) ? data.tools : [];
  } catch { return; } // 読めなければ、検索なしで今まで通り表示する
  const tags = [...new Set(tools.flatMap((t) => (Array.isArray(t.tags) ? t.tags : [])))];

  const input = el('input', { type: 'search', id: 'tool-search', placeholder: 'ツールを探す（名前・説明・タグ）', autocomplete: 'off' });
  input.setAttribute('aria-label', 'ツールを検索');
  const note = el('p', { className: 'filter-note' });
  note.setAttribute('role', 'status');
  const chipBox = el('div', { className: 'filter-chips' });
  chipBox.setAttribute('role', 'group');
  chipBox.setAttribute('aria-label', 'タグで絞り込み');
  const bar = el('div', { className: 'filter-bar', hidden: true }, input, chipBox, note);
  let active = '';

  const chips = tags.map((tag) => {
    const b = el('button', { type: 'button', className: 'filter-chip', textContent: tag });
    b.setAttribute('aria-pressed', 'false');
    b.onclick = () => { active = active === tag ? '' : tag; apply(); };
    chipBox.append(b);
    return { b, tag };
  });

  function apply() {
    const words = norm(input.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    const cards = [...grid.querySelectorAll('.card')];
    for (const card of cards) {
      const href = card.getAttribute('href');
      const title = card.querySelector('.card-title')?.textContent ?? '';
      const tool = tools.find((t) => (href ? t.url === href : title.startsWith(t.name))); // 準備中カードはタイトルにバッジの文字が付くので前方一致
      const toolTags = Array.isArray(tool?.tags) ? tool.tags : [];
      const hay = norm(`${tool?.name ?? title} ${tool?.description ?? card.textContent} ${toolTags.join(' ')}`);
      const ok = (!active || toolTags.includes(active)) && words.every((w) => hay.includes(w));
      card.hidden = !ok;
      if (ok) shown++;
    }
    grid.querySelectorAll('.group').forEach((g) => { g.hidden = !g.querySelector('.card:not([hidden])'); });
    chips.forEach(({ b, tag }) => {
      b.setAttribute('aria-pressed', String(tag === active));
      b.classList.toggle('on', tag === active);
    });
    const filtering = words.length > 0 || active;
    note.textContent = !filtering ? '' : shown ? `${shown}件` : '見つかりませんでした。言葉やタグを変えてみてください';
  }
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; apply(); } });

  // 起動演出（is-booting）が終わって、カードが並んでから見せる
  const root = document.documentElement;
  // app.js は、カードを描いたあと最大1.2秒待ってから is-booting を付ける。付く前に出さないよう、
  // 「演出が始まって終わった」か「3秒たっても始まらなかった」ときだけ出す
  const booting = () => root.classList.contains('is-booting');
  let sawBoot = false, timer = null, done = false;
  const reveal = () => {
    if (done || booting() || !grid.querySelector('.card')) return;
    done = true;
    clearTimeout(timer);
    mo.disconnect();
    grid.before(bar);
    bar.hidden = false;
    apply();
  };
  const mo = new MutationObserver(() => {
    if (booting()) sawBoot = true;
    else if (sawBoot) reveal();
    if (!timer && grid.querySelector('.card')) timer = setTimeout(reveal, 3000);
  });
  mo.observe(root, { attributes: true, attributeFilter: ['class'] });
  mo.observe(grid, { childList: true });
  if (booting()) sawBoot = true;
  if (grid.querySelector('.card')) timer = setTimeout(reveal, 3000);
}

main();
