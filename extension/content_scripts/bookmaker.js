'use strict';

// ── Bookmaker.eu content script ────────────────────────────────
// Target page: bookmaker.eu/account/my-bets
//
// Bookmaker.eu is a desktop-era site with a traditional server-rendered
// table layout. Bet history is typically rendered in a standard HTML table.
//
// Key selectors:
//   #myBetsTable, .my-bets-table       — outer table
//   tbody tr                           — each bet row
//   td.date, td:nth-child(1)           — date
//   td.event, td:nth-child(2)          — event name
//   td.type, td:nth-child(3)           — bet type
//   td.selection, td:nth-child(4)      — pick / selection
//   td.odds, td:nth-child(5)           — odds
//   td.stake, td:nth-child(6)          — stake
//   td.status, td:last-child           — status
//
// Fallback: scan all tables on the page for rows with odds-like values.

(function () {
  const SPORTSBOOK = 'Bookmaker';
  const TARGET_PATH_RE = /\/account\/my-bets/i;

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
    if (/spread|ats|handicap/.test(t)) return 'Spread';
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

  function scrapeTable(table) {
    const bets = [];
    const rows = table.querySelectorAll('tbody tr');

    rows.forEach(row => {
      try {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) return;

        // Try named cells first, fall back to positional
        const getText = (label, idx) => {
          const byLabel = row.querySelector(`td.${label}, td[data-label="${label}"]`);
          if (byLabel) return byLabel.textContent?.trim() || '';
          return cells[idx]?.textContent?.trim() || '';
        };

        const dateText   = getText('date',      0);
        const eventText  = getText('event',     1);
        const typeText   = getText('type',      2);
        const pickText   = getText('selection', 3);
        const oddsText   = getText('odds',      4);
        const stakeText  = getText('stake',     5);
        const statusText = getText('status',    cells.length - 1);

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
        console.debug('[BetTracker:Bookmaker] row parse error:', err);
      }
    });

    return bets;
  }

  function scrapeBets() {
    // Try named table first
    const namedTables = document.querySelectorAll(
      '#myBetsTable, .my-bets-table, [class*="bet-history"], [id*="bet-history"]'
    );

    for (const table of namedTables) {
      const bets = scrapeTable(table);
      if (bets.length > 0) return bets;
    }

    // Fallback: scan all tables
    const allBets = [];
    for (const table of document.querySelectorAll('table')) {
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length === 0) continue;

      // Heuristic: table likely contains bets if header mentions "odds" or "stake"
      const header = table.querySelector('thead')?.textContent?.toLowerCase() || '';
      if (!header.includes('odds') && !header.includes('stake') && !header.includes('bet')) continue;

      allBets.push(...scrapeTable(table));
    }
    return allBets;
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
