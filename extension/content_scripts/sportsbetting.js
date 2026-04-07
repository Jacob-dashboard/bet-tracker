'use strict';

// ── Sportsbetting.ag content script ───────────────────────────
// Target page: sportsbetting.ag/account/bets
//
// Sportsbetting.ag shares platform DNA with BetOnline (same parent group,
// similar DOM structure). Bet history is rendered as a responsive HTML table.
//
// Key selectors:
//   .bet-history, [class*="bet-history"]    — outer container
//   tbody tr                                — each bet row
//   td[data-label="Date"]                   — date
//   td[data-label="Event"]                  — event/game
//   td[data-label="Type"]                   — bet type
//   td[data-label="Selection"]              — pick
//   td[data-label="Odds"]                   — odds
//   td[data-label="Stake"]                  — stake
//   td[data-label="Status"]                 — status
//
// Same fallback strategy as betonline.js: positional indexing.

(function () {
  const SPORTSBOOK = 'Sportsbetting.ag';
  const TARGET_PATH_RE = /\/account\/bets/i;

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function parseOdds(text) {
    if (!text) return null;
    const s = text.replace(/\s/g, '');
    const m = s.match(/([+-]?\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function parseStake(text) {
    if (!text) return null;
    const m = text.replace(/,/g, '').match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  function parseDate(text) {
    if (!text) return new Date().toISOString().slice(0, 10);
    try {
      const d = new Date(text.trim());
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
    } catch {}
    return new Date().toISOString().slice(0, 10);
  }

  function detectSport(eventText) {
    const t = (eventText || '').toLowerCase();
    if (/nfl|football/.test(t)) return 'NFL';
    if (/nba|basketball/.test(t)) return 'NBA';
    if (/mlb|baseball/.test(t)) return 'MLB';
    if (/nhl|hockey/.test(t)) return 'NHL';
    if (/ncaa.*foot|college foot/.test(t)) return 'NCAAF';
    if (/ncaa.*bask|college bask/.test(t)) return 'NCAAB';
    if (/soccer|mls|premier/.test(t)) return 'Soccer';
    return 'Other';
  }

  function normalizeBetType(text) {
    const t = (text || '').toLowerCase();
    if (/moneyline|ml/.test(t)) return 'Moneyline';
    if (/spread|ats/.test(t)) return 'Spread';
    if (/total|over|under/.test(t)) return 'Total O/U';
    if (/parlay/.test(t)) return 'Parlay';
    if (/prop/.test(t)) return 'Prop';
    if (/futures?/.test(t)) return 'Futures';
    return 'Moneyline';
  }

  function normalizeStatus(text) {
    const t = (text || '').toLowerCase();
    if (/win|won/.test(t)) return 'Won';
    if (/loss|lost/.test(t)) return 'Lost';
    if (/push/.test(t)) return 'Push';
    if (/void|cancel/.test(t)) return 'Void';
    return 'Pending';
  }

  function calcProfit(odds, stake, status) {
    if (!['Won', 'Lost'].includes(status)) return 0;
    if (status === 'Lost') return -stake;
    return odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds);
  }

  function getCell(row, label, fallbackIndex) {
    const byLabel = row.querySelector(`td[data-label="${label}"]`);
    if (byLabel) return byLabel.textContent?.trim() || '';
    const cells = row.querySelectorAll('td');
    return cells[fallbackIndex]?.textContent?.trim() || '';
  }

  function scrapeBets() {
    const bets = [];

    const rows = document.querySelectorAll(
      '.bet-history tbody tr, ' +
      '[class*="bet-history"] tbody tr, ' +
      '[class*="bets-table"] tbody tr, ' +
      'table[class*="history"] tbody tr'
    );

    rows.forEach(row => {
      try {
        const dateText   = getCell(row, 'Date',      0);
        const eventText  = getCell(row, 'Event',     1);
        const typeText   = getCell(row, 'Type',      2);
        const pickText   = getCell(row, 'Selection', 3);
        const oddsText   = getCell(row, 'Odds',      4);
        const stakeText  = getCell(row, 'Stake',     5);
        const statusText = getCell(row, 'Status',    6);

        const odds  = parseOdds(oddsText);
        const stake = parseStake(stakeText);
        if (!odds || !stake) return;

        const status = normalizeStatus(statusText);
        bets.push({
          id:         genId(),
          date:       parseDate(dateText),
          sport:      detectSport(eventText),
          event:      eventText || pickText,
          betType:    normalizeBetType(typeText),
          pick:       pickText,
          odds,
          stake,
          sportsbook: SPORTSBOOK,
          status,
          profit:     calcProfit(odds, stake, status),
          closeOdds:  null,
          clv:        null,
          notes:      'Imported via extension',
          source:     'extension',
        });
      } catch (err) {
        console.debug('[BetTracker:Sportsbetting] row parse error:', err);
      }
    });

    return bets;
  }

  function showToast(msg) {
    const existing = document.getElementById('btsyncer-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'btsyncer-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:99999',
      'background:#161b22', 'color:#e6edf3', 'border:1px solid #30363d',
      'border-radius:8px', 'padding:10px 14px', 'font-size:13px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)', 'font-family:sans-serif',
    ].join(';');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3500);
  }

  function syncBets(bets) {
    if (!bets.length) return;
    chrome.runtime.sendMessage(
      { action: 'syncBets', bets, sportsbook: SPORTSBOOK },
      resp => {
        if (resp?.ok) {
          showToast(`BetTracker: ${resp.count} bet${resp.count !== 1 ? 's' : ''} synced from ${SPORTSBOOK} ✓`);
        }
      }
    );
  }

  function trySync() {
    const bets = scrapeBets();
    if (bets.length > 0) syncBets(bets);
  }

  function onPathMatch() {
    trySync();
    let debounce;
    const observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(trySync, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
  }

  function checkPath() {
    if (TARGET_PATH_RE.test(location.pathname + location.search)) {
      onPathMatch();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPath);
  } else {
    checkPath();
  }

  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(checkPath, 500);
    }
  }).observe(document, { subtree: true, childList: true });
})();
