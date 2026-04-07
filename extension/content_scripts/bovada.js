'use strict';

// ── Bovada content script ──────────────────────────────────────
// Target page: bovada.lv/sports/my-bets
//
// Bovada is an Angular SPA. Bet cards live inside:
//   .my-bets-container  (outer wrapper)
//   lh-my-bets-item     (each bet, Angular component)
//
// Key selectors (verified against live DOM as of early 2026):
//   .my-bets-item__description   — event/game name
//   .my-bets-item__team          — pick description
//   .my-bets-item__price         — odds text e.g. "-110" or "+150"
//   .my-bets-item__bet-amount    — stake text e.g. "$50.00"
//   .my-bets-item__date          — date text
//   .my-bets-item__status        — "Win" / "Loss" / "Open"
//   .my-bets-item__bet-type      — "Spread" / "Moneyline" etc.
//
// Fallback: aria-labels, text content matching, data attributes.

(function () {
  const SPORTSBOOK = 'Bovada';
  const TARGET_PATH_RE = /\/sports\/my-bets/i;

  // ── Utils ──────────────────────────────────────────────────
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
    if (/soccer|mls|premier|laliga|bundesliga/.test(t)) return 'Soccer';
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

  // ── Scrape ─────────────────────────────────────────────────
  function scrapeBets() {
    const bets = [];

    // Primary: component-based cards
    const cards = document.querySelectorAll(
      'lh-my-bets-item, .my-bets-item, [class*="bet-item"], [class*="betslip-item"]'
    );

    cards.forEach(card => {
      try {
        const eventEl   = card.querySelector('[class*="description"], [class*="event"], [class*="game"], [class*="market"]');
        const pickEl    = card.querySelector('[class*="team"], [class*="pick"], [class*="selection"], [class*="outcome"]');
        const oddsEl    = card.querySelector('[class*="price"], [class*="odds"]');
        const stakeEl   = card.querySelector('[class*="bet-amount"], [class*="stake"], [class*="wager"]');
        const dateEl    = card.querySelector('[class*="date"], [class*="time"], time');
        const statusEl  = card.querySelector('[class*="status"], [class*="result"], [class*="state"]');
        const typeEl    = card.querySelector('[class*="bet-type"], [class*="type"], [class*="market-type"]');

        const eventText  = eventEl?.textContent?.trim() || '';
        const pickText   = pickEl?.textContent?.trim() || '';
        const oddsText   = oddsEl?.textContent?.trim() || '';
        const stakeText  = stakeEl?.textContent?.trim() || '';
        const dateText   = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';
        const statusText = statusEl?.textContent?.trim() || '';
        const typeText   = typeEl?.textContent?.trim() || '';

        const odds   = parseOdds(oddsText);
        const stake  = parseStake(stakeText);

        if (!odds || !stake) return; // skip cards without key numeric data

        const status = normalizeStatus(statusText);
        const bet = {
          id:          genId(),
          date:        parseDate(dateText),
          sport:       detectSport(eventText),
          event:       eventText || pickText,
          betType:     normalizeBetType(typeText),
          pick:        pickText,
          odds,
          stake,
          sportsbook:  SPORTSBOOK,
          status,
          profit:      calcProfit(odds, stake, status),
          closeOdds:   null,
          clv:         null,
          notes:       'Imported via extension',
          source:      'extension',
        };

        bets.push(bet);
      } catch (err) {
        // Silent failure per spec
        console.debug('[BetTracker:Bovada] card parse error:', err);
      }
    });

    return bets;
  }

  // ── Toast ──────────────────────────────────────────────────
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
      'transition:opacity 0.3s',
    ].join(';');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3500);
  }

  // ── Send to background ─────────────────────────────────────
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

  // ── Main: wait for content, then scrape ───────────────────
  function trySync() {
    const bets = scrapeBets();
    if (bets.length > 0) syncBets(bets);
  }

  function onPathMatch() {
    // Initial attempt
    trySync();

    // Observe DOM mutations for SPA dynamic loads
    let debounce;
    const observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(trySync, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Disconnect after 30s of inactivity to avoid memory leaks
    setTimeout(() => observer.disconnect(), 30000);
  }

  // Check current path and watch for SPA navigation
  function checkPath() {
    if (TARGET_PATH_RE.test(location.pathname + location.search)) {
      onPathMatch();
    }
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPath);
  } else {
    checkPath();
  }

  // Watch for SPA route changes (pushState / hashchange)
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(checkPath, 500);
    }
  }).observe(document, { subtree: true, childList: true });
})();
