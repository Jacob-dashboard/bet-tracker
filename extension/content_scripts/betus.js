'use strict';

// ── BetUS content script ───────────────────────────────────────
// Target pages:
//   betus.com/sports/my-bets
//   betus.com/account/bet-history
//
// BetUS renders bet history in a tabbed account area.
// Key selectors:
//   .bets-list, .bet-list-container    — outer container
//   .bet-slip-item, .bet-row           — each bet
//   .event-name, [class*="game"]       — event/game name
//   .bet-type-label                    — bet type
//   .selection-name, [class*="pick"]   — pick
//   .odds-value, [class*="odds"]       — odds
//   .stake-value, [class*="stake"]     — stake
//   .bet-date, time                    — date
//   .status-label, [class*="status"]   — status
//
// Fallback: aria-label, data attributes, positional td.

(function () {
  const SPORTSBOOK = 'BetUS';
  const TARGET_PATH_RE = /\/(sports\/my-bets|account\/bet-history)/i;

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

  function queryText(parent, ...selectors) {
    for (const sel of selectors) {
      try {
        const el = parent.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
      } catch {}
    }
    return '';
  }

  function scrapeBets() {
    const bets = [];

    // Card-style layout (common in modern SPAs)
    const cards = document.querySelectorAll(
      '.bet-slip-item, .bet-row, [class*="bet-item"], ' +
      '[class*="bets-list"] > *, [class*="bet-list"] > li'
    );

    if (cards.length > 0) {
      cards.forEach(card => {
        try {
          const eventText  = queryText(card, '.event-name', '[class*="game"]', '[class*="event"]', '[class*="match"]');
          const typeText   = queryText(card, '.bet-type-label', '[class*="bet-type"]', '[class*="type"]');
          const pickText   = queryText(card, '.selection-name', '[class*="pick"]', '[class*="selection"]', '[class*="team"]');
          const oddsText   = queryText(card, '.odds-value', '[class*="odds"]', '[class*="price"]');
          const stakeText  = queryText(card, '.stake-value', '[class*="stake"]', '[class*="amount"]', '[class*="wager"]');
          const dateText   = queryText(card, '.bet-date', 'time', '[class*="date"]');
          const statusText = queryText(card, '.status-label', '[class*="status"]', '[class*="result"]');

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
          console.debug('[BetTracker:BetUS] card parse error:', err);
        }
      });
    }

    // Fallback: table rows
    if (bets.length === 0) {
      const rows = document.querySelectorAll(
        '[class*="bet-history"] tbody tr, ' +
        '[class*="bets-table"] tbody tr'
      );
      rows.forEach(row => {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 5) return;

          const dateText   = cells[0]?.textContent?.trim() || '';
          const eventText  = cells[1]?.textContent?.trim() || '';
          const pickText   = cells[2]?.textContent?.trim() || '';
          const oddsText   = cells[3]?.textContent?.trim() || '';
          const stakeText  = cells[4]?.textContent?.trim() || '';
          const statusText = cells[cells.length - 1]?.textContent?.trim() || '';

          const odds  = parseOdds(oddsText);
          const stake = parseStake(stakeText);
          if (!odds || !stake) return;

          const status = normalizeStatus(statusText);
          bets.push({
            id:         genId(),
            date:       parseDate(dateText),
            sport:      detectSport(eventText),
            event:      eventText,
            betType:    'Moneyline',
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
          console.debug('[BetTracker:BetUS] table row error:', err);
        }
      });
    }

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
