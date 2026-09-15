const DATA_URL = '/data/current.json';

const state = {
  data: null,
  singleWeight: 20,
  mode: 'linear',
  limit: 100,
  query: '',
};

const modeConfig = {
  linear: {
    label: '线性综合',
    short: 'Linear',
    description: '直接按名次做权重融合，分数越低越好。',
    scoreLabel: '综合分',
    higherIsBetter: false,
  },
  top: {
    label: 'Top-heavy',
    short: 'Top-heavy',
    description: '使用 Reciprocal Rank Fusion 思路，明显提高前排名次的价值。',
    scoreLabel: '核心指数',
    higherIsBetter: true,
  },
  dual: {
    label: '双栖价值',
    short: 'Dual',
    description: '在 Top-heavy 基础上额外奖励单双打都靠前的宝可梦。',
    scoreLabel: '双栖指数',
    higherIsBetter: true,
  },
};

function linearScore(p, sw, dw) {
  return p.singlesRank * sw + p.doublesRank * dw;
}

function topHeavyScore(p, sw, dw) {
  const k = 10;
  const best = 1 / (k + 1);
  const raw = sw / (k + p.singlesRank) + dw / (k + p.doublesRank);
  return (raw / best) * 100;
}

function dualScore(p, sw, dw) {
  const top = topHeavyScore(p, sw, dw);
  const balance = 100 / Math.sqrt(p.singlesRank * p.doublesRank);
  return 0.72 * top + 0.28 * balance;
}

function scoreFor(p, mode, sw, dw) {
  if (mode === 'top') return topHeavyScore(p, sw, dw);
  if (mode === 'dual') return dualScore(p, sw, dw);
  return linearScore(p, sw, dw);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function daysOld(dateString) {
  const t = Date.parse(`${dateString}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function currentRows() {
  const sw = state.singleWeight / 100;
  const dw = 1 - sw;
  const cfg = modeConfig[state.mode];
  const q = state.query.trim().toLowerCase();

  return state.data.pokemon
    .map((p) => ({ ...p, score: scoreFor(p, state.mode, sw, dw) }))
    .sort((a, b) => {
      const primary = cfg.higherIsBetter ? b.score - a.score : a.score - b.score;
      return primary || a.doublesRank - b.doublesRank || a.singlesRank - b.singlesRank;
    })
    .map((p, index) => ({ ...p, combinedRank: index + 1 }))
    .filter((p) => !q || p.nameZh.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q))
    .slice(0, state.limit);
}

function rankPill(rank) {
  const cls = rank <= 3 ? ` top-${rank}` : '';
  return `<span class="rank-pill${cls}">${rank}</span>`;
}

function scoreText(row) {
  return state.mode === 'linear' ? row.score.toFixed(1) : row.score.toFixed(2);
}

function render() {
  const root = document.querySelector('#app');
  const meta = state.data.meta;
  const rows = currentRows();
  const cfg = modeConfig[state.mode];
  const staleDays = daysOld(meta.snapshotDate);
  const staleText = staleDays === null ? '未知' : staleDays === 0 ? '今天' : `${staleDays} 天前`;
  const freshnessClass = staleDays !== null && staleDays > 3 ? 'warning' : 'ok';
  const doubleWeight = 100 - state.singleWeight;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand-block">
        <div class="brand-mark" aria-hidden="true"><span></span></div>
        <div>
          <h1>PokéChamp Meta</h1>
          <p>Pokémon Champions 单打 × 双打综合环境榜</p>
        </div>
      </div>
      <div class="header-meta">
        <span class="season-chip">${escapeHtml(meta.season)}</span>
        <div><span>数据快照</span><strong>${escapeHtml(meta.snapshotDate)}</strong></div>
      </div>
    </header>

    <div class="workspace">
      <aside class="control-panel">
        <div class="panel-title">排名设置</div>

        <div class="weight-row">
          <label for="singleWeight"><span>单打权重</span><strong>${state.singleWeight}%</strong></label>
          <input id="singleWeight" type="range" min="0" max="100" step="5" value="${state.singleWeight}" />
        </div>

        <div class="weight-row secondary">
          <label><span>双打权重</span><strong>${doubleWeight}%</strong></label>
          <div class="meter"><span style="width:${doubleWeight}%"></span></div>
        </div>

        <div class="control-group">
          <span class="group-label">榜单算法</span>
          ${Object.entries(modeConfig).map(([key, item]) => `
            <button class="mode-button ${state.mode === key ? 'active' : ''}" data-mode="${key}">
              <span>${item.label}</span>
              <small>${item.short}</small>
            </button>
          `).join('')}
        </div>

        <div class="control-group">
          <span class="group-label">显示数量</span>
          <div class="segmented">
            ${[20, 50, 100].map((n) => `<button data-limit="${n}" class="${state.limit === n ? 'active' : ''}">Top ${n}</button>`).join('')}
          </div>
        </div>

        <div class="search-box">
          <span aria-hidden="true">⌕</span>
          <input id="search" value="${escapeHtml(state.query)}" placeholder="搜索中文 / 英文名…" />
        </div>

        <div class="method-card">
          <strong>${cfg.label}</strong>
          <p>${cfg.description}</p>
        </div>
      </aside>

      <main class="main-panel">
        <section class="summary-grid">
          <article><span>当前算法</span><strong>${cfg.label}</strong><small>${state.singleWeight}% / ${doubleWeight}%</small></article>
          <article><span>数据规模</span><strong>${state.data.pokemon.length}</strong><small>当前快照记录</small></article>
          <article><span>数据新鲜度</span><strong class="freshness ${freshnessClass}">${staleText}</strong><small>${escapeHtml(meta.snapshotDate)}</small></article>
          <article><span>默认侧重</span><strong>${doubleWeight >= state.singleWeight ? '双打' : '单打'}</strong><small>拖动权重即时重排</small></article>
        </section>

        <section class="ranking-card">
          <div class="ranking-head">
            <div>
              <h2>${cfg.label}排行榜</h2>
              <p>${cfg.higherIsBetter ? '指数越高排名越高' : '分数越低排名越高'} · 同分优先比较双打名次</p>
            </div>
            <span class="top-chip">Top ${state.limit}</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>宝可梦</th>
                  <th>单打</th>
                  <th>双打</th>
                  <th>${cfg.scoreLabel}</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td>${rankPill(row.combinedRank)}</td>
                    <td>
                      <div class="pokemon-name"><strong>${escapeHtml(row.nameZh)}</strong><span>${escapeHtml(row.nameEn)}</span></div>
                    </td>
                    <td>${row.singlesRank}</td>
                    <td>${row.doublesRank}</td>
                    <td class="score-cell">${scoreText(row)}</td>
                  </tr>
                `).join('') || `<tr><td colspan="5" class="empty-state">没有匹配的宝可梦</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>

    <footer class="site-footer">
      <div>Battle data provided by <a href="${escapeHtml(meta.source.url)}" target="_blank" rel="noreferrer">Pokémon Champions Battle Data</a>.</div>
      <div>非官方社区项目 · 当前为 ${escapeHtml(meta.season)} 快照 · <a href="${escapeHtml(meta.source.apiGuide)}" target="_blank" rel="noreferrer">API 说明</a></div>
    </footer>
  `;

  bindEvents();
}

function bindEvents() {
  document.querySelector('#singleWeight')?.addEventListener('input', (event) => {
    state.singleWeight = Number(event.target.value);
    render();
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      render();
    });
  });

  document.querySelectorAll('[data-limit]').forEach((button) => {
    button.addEventListener('click', () => {
      state.limit = Number(button.dataset.limit);
      render();
    });
  });

  const search = document.querySelector('#search');
  search?.addEventListener('input', (event) => {
    const value = event.target.value;
    state.query = value;
    const caret = event.target.selectionStart;
    render();
    const next = document.querySelector('#search');
    next?.focus();
    if (caret !== null) next?.setSelectionRange(caret, caret);
  });
}

async function init() {
  const root = document.querySelector('#app');
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    render();
  } catch (error) {
    root.innerHTML = `
      <div class="fatal-error">
        <h1>数据加载失败</h1>
        <p>${escapeHtml(error.message)}</p>
        <p>请通过 <code>https://</code> 或本地 HTTP 服务器访问，不要直接用 <code>file://</code> 打开。</p>
      </div>
    `;
  }
}

init();
