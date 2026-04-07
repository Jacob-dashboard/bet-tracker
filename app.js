'use strict';

// ── Constants ──────────────────────────────────────────────────
const STORAGE_KEY      = 'bettracker_v1';
const STORAGE_UNIT_KEY = 'bettracker_unit';

const SPORTS     = ['NFL','NBA','MLB','NHL','NCAAF','NCAAB','Soccer','Other'];
const BET_TYPES  = ['Moneyline','Spread','Total O/U','Prop','Parlay','Futures'];
const SPORTSBOOKS= ['DraftKings','FanDuel','BetMGM','Caesars','Other'];

// ── State ──────────────────────────────────────────────────────
let bets       = [];
let unitSize   = 10;
let sortConfig = { field: 'date', direction: 'desc' };
let filters    = { sport:'', status:'', sportsbook:'', dateFrom:'', dateTo:'' };
let pnlChart   = null;

// ── Storage ────────────────────────────────────────────────────
function loadData() {
  try { bets     = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { bets   = []; }
  try { unitSize = parseFloat(localStorage.getItem(STORAGE_UNIT_KEY)) || 10; }
  catch { unitSize = 10; }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY,      JSON.stringify(bets));
  localStorage.setItem(STORAGE_UNIT_KEY, String(unitSize));
}

// ── Math / Odds ────────────────────────────────────────────────
/**
 * American odds → implied probability (0–1, no vig adjustment).
 */
function impliedProb(odds) {
  if (odds == null || isNaN(odds)) return null;
  odds = Number(odds);
  if (odds === 0) return null;
  return odds > 0
    ? 100 / (odds + 100)
    : Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Calculate profit/loss given odds, stake, and resolved status.
 * Returns 0 for Pending/Push/Void.
 */
function calcProfit(odds, stake, status) {
  stake = parseFloat(stake);
  odds  = parseFloat(odds);
  if (!['Won','Lost'].includes(status)) return 0;
  if (status === 'Lost') return -stake;
  // Won
  return odds > 0
    ? stake * odds / 100
    : stake * 100 / Math.abs(odds);
}

/**
 * CLV%  =  (implied_prob_at_close − implied_prob_at_bet) / implied_prob_at_bet × 100
 *
 * Positive → you got a better number than where the line closed (sharp).
 * Negative → line moved against you (soft).
 */
function calcCLV(betOdds, closeOdds) {
  const pBet   = impliedProb(betOdds);
  const pClose = impliedProb(closeOdds);
  if (pBet == null || pClose == null || pBet === 0) return null;
  return (pClose - pBet) / pBet * 100;
}

// ── Formatting helpers ─────────────────────────────────────────
function fmtOdds(odds) {
  if (odds == null || isNaN(odds)) return '—';
  const n = Number(odds);
  return n > 0 ? `+${n}` : String(n);
}

function fmtMoney(val, showPlus = true) {
  if (val == null || isNaN(val)) return '—';
  const abs = Math.abs(val).toFixed(2);
  if (val > 0) return showPlus ? `+$${abs}` : `$${abs}`;
  if (val < 0) return `-$${abs}`;
  return `$${abs}`;
}

function fmtClv(clv) {
  if (clv == null || isNaN(clv)) return '—';
  const sign = clv >= 0 ? '+' : '';
  return `${sign}${clv.toFixed(2)}%`;
}

function fmtPct(val) {
  if (val == null) return '—';
  return `${val.toFixed(1)}%`;
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Stats ──────────────────────────────────────────────────────
function calcStats() {
  const resolved  = bets.filter(b => b.status === 'Won' || b.status === 'Lost');
  const won       = bets.filter(b => b.status === 'Won');
  const lost      = bets.filter(b => b.status === 'Lost');
  const pending   = bets.filter(b => b.status === 'Pending');

  const totalStaked  = resolved.reduce((s,b) => s + parseFloat(b.stake), 0);
  const totalProfit  = resolved.reduce((s,b) => s + calcProfit(b.odds, b.stake, b.status), 0);

  const winPct = resolved.length > 0 ? won.length / resolved.length * 100 : null;
  const roi    = totalStaked  > 0  ? totalProfit / totalStaked * 100  : null;

  // CLV — only bets that have closeOdds
  const clvBets   = bets.filter(b => b.closeOdds != null && !isNaN(b.closeOdds));
  const clvValues = clvBets.map(b => calcCLV(b.odds, b.closeOdds)).filter(v => v != null);
  const avgClv    = clvValues.length > 0
    ? clvValues.reduce((a,b) => a+b, 0) / clvValues.length
    : null;
  const posClvPct = clvValues.length > 0
    ? clvValues.filter(v => v > 0).length / clvValues.length * 100
    : null;

  // Streak — walk backwards through date-sorted resolved bets
  const sortedR = [...resolved].sort((a,b) => a.date.localeCompare(b.date));
  let streak = 0, streakType = null;
  for (let i = sortedR.length - 1; i >= 0; i--) {
    const s = sortedR[i].status;
    if (streakType === null) { streakType = s; streak = 1; }
    else if (s === streakType) streak++;
    else break;
  }

  return {
    total: bets.length,
    wonCount: won.length, lostCount: lost.length,
    pendingCount: pending.length,
    resolved: resolved.length,
    winPct, roi,
    totalProfit, totalStaked,
    avgClv, posClvPct,
    clvCount: clvValues.length,
    units: totalProfit / unitSize,
    streak, streakType,
  };
}

// ── Render: Dashboard ──────────────────────────────────────────
function renderDashboard(stats) {
  el('unit-display').textContent = unitSize % 1 === 0 ? unitSize.toFixed(0) : unitSize.toFixed(2);
  el('stat-unit-size-label').textContent = `@ $${unitSize}/unit`;

  el('stat-total').textContent = stats.total;
  el('stat-record').textContent = `${stats.wonCount}W – ${stats.lostCount}L`;

  setStatValue('stat-winpct', stats.winPct != null ? fmtPct(stats.winPct) : '—',
    stats.winPct != null ? (stats.winPct >= 52.4 ? 'positive' : stats.winPct >= 48 ? '' : 'negative') : '');
  el('stat-staked').textContent = stats.resolved > 0 ? `$${stats.totalStaked.toFixed(0)} staked` : '—';

  setStatValue('stat-roi', stats.roi != null ? `${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%` : '—',
    stats.roi != null ? (stats.roi >= 0 ? 'positive' : 'negative') : '');

  setStatValue('stat-pnl', fmtMoney(stats.totalProfit, true),
    stats.totalProfit >= 0 ? 'positive' : 'negative');
  el('stat-pending-count').textContent = `${stats.pendingCount} pending`;

  setStatValue('stat-clv', stats.avgClv != null ? fmtClv(stats.avgClv) : '—',
    stats.avgClv != null ? (stats.avgClv >= 0 ? 'positive' : 'negative') : '');
  el('stat-clv-sub').textContent = stats.clvCount > 0
    ? `${stats.clvCount} CLV data pts`
    : 'no CLV data';

  setStatValue('stat-units',
    `${stats.units >= 0 ? '+' : ''}${stats.units.toFixed(1)}u`,
    stats.units >= 0 ? 'positive' : 'negative');

  const streakEl = el('stat-streak');
  if (stats.streak > 0 && stats.streakType) {
    streakEl.textContent = `${stats.streak}${stats.streakType === 'Won' ? 'W' : 'L'}`;
    streakEl.className   = 'stat-value ' + (stats.streakType === 'Won' ? 'positive' : 'negative');
  } else {
    streakEl.textContent = '—';
    streakEl.className   = 'stat-value';
  }
}

function setStatValue(id, text, cls) {
  const e = el(id);
  e.textContent = text;
  e.className   = 'stat-value' + (cls ? ' ' + cls : '');
}

// ── Render: CLV Summary ────────────────────────────────────────
function renderCLVSummary(stats) {
  const badge   = el('clv-badge');
  const msg     = el('clv-message');
  const clvStat = el('clv-stats');
  const avgEl   = el('clv-avg');
  const posEl   = el('clv-positive-pct');
  const cntEl   = el('clv-count');

  if (stats.clvCount === 0) {
    badge.textContent  = 'No Data';
    badge.className    = 'clv-badge neutral';
    msg.textContent    = 'Add closing odds to your bets to track CLV and measure your betting edge.';
    clvStat.classList.add('hidden');
    return;
  }

  clvStat.classList.remove('hidden');
  avgEl.textContent = fmtClv(stats.avgClv);
  avgEl.className   = 'clv-stat-value ' + (stats.avgClv >= 0 ? 'positive' : 'negative');
  posEl.textContent = fmtPct(stats.posClvPct);
  cntEl.textContent = `${stats.clvCount} bet${stats.clvCount !== 1 ? 's' : ''}`;

  if (stats.avgClv > 0.5) {
    badge.textContent = 'Sharp';
    badge.className   = 'clv-badge positive';
    msg.textContent   = `You're betting sharp — consistently finding better numbers than the closing line. Keep shopping.`;
  } else if (stats.avgClv < -0.5) {
    badge.textContent = 'Soft';
    badge.className   = 'clv-badge negative';
    msg.textContent   = `You're taking bad numbers — lines are moving against you before close. Shop lines more aggressively.`;
  } else {
    badge.textContent = 'Neutral';
    badge.className   = 'clv-badge neutral';
    msg.textContent   = `Your CLV is near zero — you're getting close to market price. Try to shop for better numbers.`;
  }
}

// ── Render: Table ──────────────────────────────────────────────
function getFilteredSorted() {
  const f = filters;
  let list = bets.filter(b => {
    if (f.sport      && b.sport      !== f.sport)      return false;
    if (f.status     && b.status     !== f.status)     return false;
    if (f.sportsbook && b.sportsbook !== f.sportsbook) return false;
    if (f.dateFrom   && b.date       <  f.dateFrom)    return false;
    if (f.dateTo     && b.date       >  f.dateTo)      return false;
    return true;
  });

  list.sort((a, b) => {
    let av, bv;
    switch (sortConfig.field) {
      case 'date':    av = a.date;    bv = b.date;    break;
      case 'sport':   av = a.sport;   bv = b.sport;   break;
      case 'betType': av = a.betType; bv = b.betType; break;
      case 'odds':    av = +a.odds;   bv = +b.odds;   break;
      case 'stake':   av = +a.stake;  bv = +b.stake;  break;
      case 'status':  av = a.status;  bv = b.status;  break;
      case 'profit':
        av = calcProfit(a.odds, a.stake, a.status);
        bv = calcProfit(b.odds, b.stake, b.status);
        break;
      case 'clv':
        av = a.closeOdds != null ? calcCLV(a.odds, a.closeOdds) : -Infinity;
        bv = b.closeOdds != null ? calcCLV(b.odds, b.closeOdds) : -Infinity;
        break;
      default: av = a.date; bv = b.date;
    }
    if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
    if (av > bv) return sortConfig.direction === 'asc' ?  1 : -1;
    return 0;
  });

  return list;
}

function renderTable() {
  const tbody    = el('bet-tbody');
  const empty    = el('empty-state');
  const fCount   = el('filter-count');
  const list     = getFilteredSorted();

  // Sort icon update
  document.querySelectorAll('th.sortable').forEach(th => {
    const field = th.dataset.sort;
    const icon  = th.querySelector('.sort-icon');
    if (field === sortConfig.field) {
      icon.textContent = sortConfig.direction === 'asc' ? '↑' : '↓';
      th.classList.add('sorted');
    } else {
      icon.textContent = '↕';
      th.classList.remove('sorted');
    }
  });

  // Filter count badge
  const activeFilters = Object.values(filters).filter(Boolean).length;
  if (activeFilters > 0 && bets.length !== list.length) {
    fCount.textContent = `${list.length} of ${bets.length}`;
    fCount.classList.remove('hidden');
  } else {
    fCount.classList.add('hidden');
  }

  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = list.map(bet => {
    const profit     = calcProfit(bet.odds, bet.stake, bet.status);
    const clv        = bet.closeOdds != null ? calcCLV(bet.odds, bet.closeOdds) : null;
    const profitCls  = profit > 0 ? 'positive' : profit < 0 ? 'negative' : '';
    const clvCls     = clv   != null ? (clv > 0 ? 'positive' : clv < 0 ? 'negative' : '') : '';
    const rowCls     = `row-${bet.status.toLowerCase()}`;

    const profitTxt  = bet.status === 'Pending' ? '—'
      : bet.status === 'Push' || bet.status === 'Void' ? '$0.00'
      : fmtMoney(profit);

    return `<tr class="${rowCls}" data-id="${escHtml(bet.id)}">
      <td>${escHtml(bet.date)}</td>
      <td><span class="badge badge-sport">${escHtml(bet.sport)}</span></td>
      <td class="td-event" title="${escHtml(bet.event)}">${escHtml(bet.event)}</td>
      <td><span class="badge badge-type">${escHtml(bet.betType)}</span></td>
      <td class="td-pick" title="${escHtml(bet.pick)}">${escHtml(bet.pick)}</td>
      <td class="td-mono">${fmtOdds(bet.odds)}</td>
      <td class="td-mono">$${parseFloat(bet.stake).toFixed(2)}</td>
      <td>${escHtml(bet.sportsbook)}</td>
      <td><span class="status-pill status-${bet.status.toLowerCase()}">${escHtml(bet.status)}</span></td>
      <td class="td-mono ${profitCls}">${profitTxt}</td>
      <td class="td-mono ${clvCls}">${fmtClv(clv)}</td>
      <td class="td-actions">
        <button class="btn-action btn-edit"   onclick="editBet('${escHtml(bet.id)}')">Edit</button>
        <button class="btn-action btn-delete" onclick="deleteBet('${escHtml(bet.id)}')">Del</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Render: Chart ──────────────────────────────────────────────
function renderChart() {
  const section = el('chart-section');

  // Include Won, Lost, Push in chart; sort by date then by insertion order
  const graded = bets
    .filter(b => b.status === 'Won' || b.status === 'Lost' || b.status === 'Push')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (graded.length < 2) {
    section.classList.add('hidden');
    if (pnlChart) { pnlChart.destroy(); pnlChart = null; }
    return;
  }
  section.classList.remove('hidden');

  // Build cumulative series
  let cum = 0;
  const labels = ['Start'];
  const data   = [0];

  graded.forEach(bet => {
    cum += calcProfit(bet.odds, bet.stake, bet.status);
    labels.push(`${bet.date} · ${(bet.pick || bet.event || '').slice(0,18)}`);
    data.push(parseFloat(cum.toFixed(2)));
  });

  // Subtitle
  const finalPnl = data[data.length - 1];
  el('chart-subtitle').textContent =
    `${graded.length} graded bets · ${finalPnl >= 0 ? '+' : ''}$${Math.abs(finalPnl).toFixed(2)} total`;

  const pointColors = data.map(v => v >= 0 ? '#3fb950' : '#f85149');

  if (pnlChart) { pnlChart.destroy(); pnlChart = null; }

  const canvas = el('pnl-chart');
  pnlChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cumulative P&L ($)',
        data,
        borderColor: '#58a6ff',
        borderWidth: 2,
        backgroundColor(ctx) {
          const chart = ctx.chart;
          const { chartArea } = chart;
          if (!chartArea) return 'transparent';
          const grad = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          if (finalPnl >= 0) {
            grad.addColorStop(0, 'rgba(63,185,80,0.25)');
            grad.addColorStop(1, 'rgba(63,185,80,0.01)');
          } else {
            grad.addColorStop(0, 'rgba(248,81,73,0.01)');
            grad.addColorStop(1, 'rgba(248,81,73,0.25)');
          }
          return grad;
        },
        fill: true,
        tension: 0.35,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
        pointBorderWidth: 0,
        pointRadius: data.length < 30 ? 4 : 2,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          titleFont: { size: 11 },
          bodyColor: '#e6edf3',
          bodyFont: { size: 13, weight: '600' },
          padding: 10,
          callbacks: {
            title: items => items[0].label,
            label: ctx => {
              const v = ctx.parsed.y;
              return `P&L: ${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          grid: { color: '#21262d', drawBorder: false },
          border: { color: 'transparent' },
          ticks: {
            color: '#8b949e',
            font: { size: 11 },
            callback: v => `$${v}`,
          },
        },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

// ── Modal ──────────────────────────────────────────────────────
function openModal(bet = null) {
  const form     = el('bet-form');
  const overlay  = el('modal-overlay');
  const title    = el('modal-title');
  const submitBtn= el('btn-submit');

  form.reset();
  el('bet-id').value = '';
  resetClvPreview();
  el('payout-preview').style.display = 'none';

  if (bet) {
    title.textContent      = 'Edit Bet';
    submitBtn.textContent  = 'Save Changes';
    el('bet-id').value     = bet.id;
    el('f-date').value     = bet.date;
    el('f-sport').value    = bet.sport;
    el('f-event').value    = bet.event;
    el('f-bet-type').value = bet.betType;
    el('f-pick').value     = bet.pick;
    el('f-odds').value     = bet.odds;
    el('f-stake').value    = bet.stake;
    el('f-sportsbook').value = bet.sportsbook;
    el('f-status').value   = bet.status;
    el('f-close-odds').value = bet.closeOdds != null ? bet.closeOdds : '';
    el('f-notes').value    = bet.notes || '';
    updateClvPreview();
    updatePayoutPreview();
  } else {
    title.textContent     = 'Add Bet';
    submitBtn.textContent = 'Add Bet';
    // Default to today
    el('f-date').value = new Date().toISOString().slice(0,10);
  }

  overlay.classList.remove('hidden');
  // Focus first empty required field
  setTimeout(() => {
    const first = form.querySelector('input:not([type=hidden]):not([value]):not([readonly]), select');
    if (first && !bet) first.focus();
  }, 80);
}

function closeModal() {
  el('modal-overlay').classList.add('hidden');
}

function resetClvPreview() {
  const p = el('clv-preview');
  p.textContent = '—';
  p.className   = 'clv-preview';
}

function updateClvPreview() {
  const odds      = parseFloat(el('f-odds').value);
  const closeOdds = parseFloat(el('f-close-odds').value);
  const preview   = el('clv-preview');

  if (!isNaN(odds) && !isNaN(closeOdds) && closeOdds !== 0 && odds !== 0) {
    const clv = calcCLV(odds, closeOdds);
    if (clv != null) {
      preview.textContent = fmtClv(clv);
      preview.className   = 'clv-preview ' + (clv >= 0 ? 'positive' : 'negative');
      return;
    }
  }
  resetClvPreview();
}

function updatePayoutPreview() {
  const odds   = parseFloat(el('f-odds').value);
  const stake  = parseFloat(el('f-stake').value);
  const status = el('f-status').value;
  const row    = el('payout-preview');
  const val    = el('payout-value');

  if (!isNaN(odds) && !isNaN(stake) && stake > 0) {
    row.style.display = 'flex';
    if (status === 'Won') {
      const profit = calcProfit(odds, stake, 'Won');
      val.textContent = `+$${profit.toFixed(2)} profit (total $${(stake + profit).toFixed(2)})`;
      val.style.color = 'var(--green)';
    } else if (status === 'Lost') {
      val.textContent = `-$${stake.toFixed(2)}`;
      val.style.color = 'var(--red)';
    } else if (status === 'Pending') {
      const profit = calcProfit(odds, stake, 'Won');
      val.textContent = `+$${profit.toFixed(2)} if won`;
      val.style.color = 'var(--yellow)';
    } else {
      row.style.display = 'none';
    }
  } else {
    row.style.display = 'none';
  }
}

function handleFormSubmit(e) {
  e.preventDefault();

  // Basic validation
  const oddsVal  = el('f-odds').value.trim();
  const stakeVal = el('f-stake').value.trim();
  if (!oddsVal || isNaN(parseFloat(oddsVal))) { alert('Please enter valid odds.'); return; }
  if (!stakeVal || parseFloat(stakeVal) <= 0)  { alert('Please enter a positive stake.'); return; }

  const id          = el('bet-id').value;
  const closeOddsRaw = el('f-close-odds').value.trim();

  const bet = {
    id:          id || genId(),
    date:        el('f-date').value,
    sport:       el('f-sport').value,
    event:       el('f-event').value.trim(),
    betType:     el('f-bet-type').value,
    pick:        el('f-pick').value.trim(),
    odds:        parseFloat(oddsVal),
    stake:       parseFloat(stakeVal),
    sportsbook:  el('f-sportsbook').value,
    status:      el('f-status').value,
    closeOdds:   closeOddsRaw && !isNaN(parseFloat(closeOddsRaw)) ? parseFloat(closeOddsRaw) : null,
    notes:       el('f-notes').value.trim(),
  };

  if (id) {
    const idx = bets.findIndex(b => b.id === id);
    if (idx !== -1) bets[idx] = bet;
  } else {
    bets.push(bet);
  }

  saveData();
  closeModal();
  renderAll();
}

// Global for inline onclick handlers in table rows
window.editBet = function(id) {
  const bet = bets.find(b => b.id === id);
  if (bet) openModal(bet);
};

window.deleteBet = function(id) {
  if (!confirm('Delete this bet? This cannot be undone.')) return;
  bets = bets.filter(b => b.id !== id);
  saveData();
  renderAll();
};

// ── Filters ────────────────────────────────────────────────────
function setupFilterOptions() {
  const sportSel = el('filter-sport');
  const bookSel  = el('filter-sportsbook');

  SPORTS.forEach(s => {
    const o = new Option(s, s);
    sportSel.appendChild(o);
  });
  SPORTSBOOKS.forEach(s => {
    const o = new Option(s, s);
    bookSel.appendChild(o);
  });
}

function setupFormOptions() {
  const sportSel = el('f-sport');
  const typeSel  = el('f-bet-type');
  const bookSel  = el('f-sportsbook');

  SPORTS.forEach(s     => sportSel.appendChild(new Option(s, s)));
  BET_TYPES.forEach(t  => typeSel.appendChild(new Option(t, t)));
  SPORTSBOOKS.forEach(s=> bookSel.appendChild(new Option(s, s)));
}

function readFilters() {
  filters.sport      = el('filter-sport').value;
  filters.status     = el('filter-status').value;
  filters.sportsbook = el('filter-sportsbook').value;
  filters.dateFrom   = el('filter-date-from').value;
  filters.dateTo     = el('filter-date-to').value;
}

function clearFilters() {
  filters = { sport:'', status:'', sportsbook:'', dateFrom:'', dateTo:'' };
  el('filter-sport').value     = '';
  el('filter-status').value    = '';
  el('filter-sportsbook').value= '';
  el('filter-date-from').value = '';
  el('filter-date-to').value   = '';
  renderTable();
}

// ── CSV Export ─────────────────────────────────────────────────
function exportCSV() {
  if (bets.length === 0) { alert('No bets to export.'); return; }

  const headers = [
    'Date','Sport','Event','Bet Type','Pick','Odds','Stake ($)',
    'Sportsbook','Status','Close Odds','CLV%','P&L ($)','Notes',
  ];

  const csvQuote = s => `"${String(s ?? '').replace(/"/g,'""')}"`;

  const rows = bets.map(bet => {
    const profit = calcProfit(bet.odds, bet.stake, bet.status);
    const clv    = bet.closeOdds != null ? calcCLV(bet.odds, bet.closeOdds) : null;
    return [
      bet.date,
      bet.sport,
      csvQuote(bet.event),
      bet.betType,
      csvQuote(bet.pick),
      fmtOdds(bet.odds),
      parseFloat(bet.stake).toFixed(2),
      bet.sportsbook,
      bet.status,
      bet.closeOdds != null ? fmtOdds(bet.closeOdds) : '',
      clv != null ? clv.toFixed(2) : '',
      bet.status !== 'Pending' ? profit.toFixed(2) : '',
      csvQuote(bet.notes || ''),
    ].join(',');
  });

  const csv  = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `bettracker_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Render all ─────────────────────────────────────────────────
function renderAll() {
  const stats = calcStats();
  renderDashboard(stats);
  renderCLVSummary(stats);
  renderTable();
  renderChart();
}

// ── Utility ────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

// ── Init ───────────────────────────────────────────────────────
function init() {
  loadData();
  setupFilterOptions();
  setupFormOptions();

  // ── Header buttons
  el('btn-add').addEventListener('click', () => openModal());
  el('btn-export').addEventListener('click', exportCSV);

  // ── Add/Edit modal
  el('modal-close').addEventListener('click', closeModal);
  el('btn-cancel').addEventListener('click', closeModal);
  el('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  el('bet-form').addEventListener('submit', handleFormSubmit);

  // Live previews in form
  el('f-odds').addEventListener('input', () => { updateClvPreview(); updatePayoutPreview(); });
  el('f-close-odds').addEventListener('input', updateClvPreview);
  el('f-stake').addEventListener('input', updatePayoutPreview);
  el('f-status').addEventListener('change', updatePayoutPreview);

  // Keyboard close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      el('unit-modal-overlay').classList.add('hidden');
    }
  });

  // ── Unit size modal
  el('btn-unit-size').addEventListener('click', () => {
    el('unit-input').value = unitSize;
    el('unit-modal-overlay').classList.remove('hidden');
    el('unit-input').focus();
  });
  el('unit-modal-close').addEventListener('click', () => el('unit-modal-overlay').classList.add('hidden'));
  el('unit-cancel').addEventListener('click', () => el('unit-modal-overlay').classList.add('hidden'));
  el('unit-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) el('unit-modal-overlay').classList.add('hidden');
  });
  el('unit-save').addEventListener('click', () => {
    const v = parseFloat(el('unit-input').value);
    if (!isNaN(v) && v > 0) {
      unitSize = v;
      saveData();
      renderAll();
    }
    el('unit-modal-overlay').classList.add('hidden');
  });

  // ── Filters
  ['filter-sport','filter-status','filter-sportsbook'].forEach(id => {
    el(id).addEventListener('change', () => { readFilters(); renderTable(); });
  });
  ['filter-date-from','filter-date-to'].forEach(id => {
    el(id).addEventListener('change', () => { readFilters(); renderTable(); });
    el(id).addEventListener('input',  () => { readFilters(); renderTable(); });
  });
  el('btn-clear-filters').addEventListener('click', clearFilters);

  // ── Table sort
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortConfig.field === field) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
      } else {
        sortConfig.field     = field;
        sortConfig.direction = 'desc';
      }
      renderTable();
    });
  });

  // ── CLV explainer toggle
  el('clv-toggle').addEventListener('click', () => {
    const exp      = el('clv-explainer');
    const expanded = el('clv-toggle').getAttribute('aria-expanded') === 'true';
    if (expanded) {
      exp.classList.add('hidden');
      el('clv-toggle').setAttribute('aria-expanded', 'false');
      el('clv-toggle').textContent = 'What is CLV? ▾';
    } else {
      exp.classList.remove('hidden');
      el('clv-toggle').setAttribute('aria-expanded', 'true');
      el('clv-toggle').textContent = 'What is CLV? ▴';
    }
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
