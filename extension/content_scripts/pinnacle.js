'use strict';

// ── Pinnacle content script ────────────────────────────────────
// Target page: pinnacle.com/en/betting-history
//
// Strategy A — DOM scraping (primary):
//   Pinnacle is a React SPA. Bet history renders inside:
//   [class*="bettingHistory"], [class*="BettingHistory"]
//   Each bet row: [class*="betItem"], [class*="BetItem"]
//
//   Key sub-selectors per bet row:
//   [class*="eventName"], [class*="event"]   — event name
//   [class*="marketName"], [class*="market"] — bet type / market
//   [class*="selectionName"], [class*="selection"] — pick
//   [class*="odds"], [class*="price"]        — odds (often decimal; convert to American)
//   [class*="stake"], [class*="amount"]      — stake
//   [class*="date"], time                    — date
//   [class*="result"], [class*="status"]     — Won/Lost/Open
//
// Strategy B — API (secondary, if auth cookie available):
//   GET https://api.pinnacle.com/v1/bets?betStatuses=WON,LOST,OPEN&fromDate=...
//   Response: { straightBets: [...] }
//   Each entry has: id, betStatus, team, side, price (American), risk, toWin, event, placed date.
//   Note: requires session cookies to be forwarded — works only from extension
//   content script context (cookies auto-sent with fetch from page origin).
//
// Odds: Pinnacle displays odds in American format on the US site.
// If decimal odds detected (e.g. "1.91"), convert: American = (decimal-1)*100 for >2.0,
// else -100/(decimal-1) for <2.0.

(function () {
  const SPORTSBOOK = 'Pinnacle';
  const TARGET_PATH_RE = /\/en\/betting-history/i;

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function parseOdds(text) {
    if (!text) return null;
    const s = text.replace(/\s/g, '');

    // American format: +150 or -110
    const american = s.match(/^([+-]\d+)$/);
    if (american) return parseInt(american[1], 10);

    // Try extracting a number
    const numMatch = s.match(/([+-]?[\d.]+)/);
    if (!numMatch) return null;
    const n = parseFloat(numMatch[1]);

    // Decimal odds (>= 1.01 range, no explicit sign)
    if (!s.startsWith('+') && !s.startsWith('-') && n >= 1.01 && n < 100) {
      return decimalToAmerican(n);
    }

    return Math.round(n) || null;
  }

  function decimalToAmerican(decimal) {
    if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
    return Math.round(-100 / (decimal - 1));
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
    if (/soccer|mls|premier|laliga|bundesliga|serie a|ligue/.test(t)) return 'Soccer';
    return 'Other';
  }

  function normalizeBetType(text) {
    const t = (text || '').toLowerCase();
    if (/moneyline|money line|ml|1x2|match winner/.test(t)) return 'Moneyline';
    if (/spread|handicap|ats/.test(t)) return 'Spread';
    if (/total|over|under|o\/u/.test(t)) return 'Total O/U';
    if (/parlay|accumulator|acca/.test(t)) return 'Parlay';
    if (/prop/.test(t)) return 'Prop';
    if (/futures?|outright/.test(t)) return 'Futures';
    return 'Moneyline';
  }

  function normalizeStatus(text) {
    const t = (text || '').toLowerCase();
    if (/win|won/.test(t)) return 'Won';
    if (/loss|lost/.test(t)) return 'Lost';
    if (/push|tie|draw/.test(t)) return 'Push';
    if (/void|cancel|refund/.test(t)) return 'Void';
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

  // ── Strategy A: DOM scraping ───────────────────────────────
  function scrapeDom() {
    const bets = [];

    const rows = document.querySelectorAll(
      '[class*="betItem"], [class*="BetItem"], ' +
      '[class*="bet-item"], [class*="history-row"], ' +
      '[class*="BettingHistory"] li, [class*="bettingHistory"] li'
    );

    rows.forEach(row => {
      try {
        const eventText = queryText(row,
          '[class*="eventName"]', '[class*="EventName"]',
          '[class*="event-name"]', '[class*="event"]'
        );
        const typeText = queryText(row,
          '[class*="marketName"]', '[class*="MarketName"]',
          '[class*="market-name"]', '[class*="market"]', '[class*="betType"]'
        );
        const pickText = queryText(row,
          '[class*="selectionName"]', '[class*="SelectionName"]',
          '[class*="selection"]', '[class*="team"]', '[class*="pick"]'
        );
        const oddsText = queryText(row,
          '[class*="odds"]', '[class*="Odds"]',
          '[class*="price"]', '[class*="Price"]'
        );
        const stakeText = queryText(row,
          '[class*="stake"]', '[class*="Stake"]',
          '[class*="amount"]', '[class*="risk"]', '[class*="wager"]'
        );
        const dateText = queryText(row,
          'time', '[class*="date"]', '[class*="Date"]', '[class*="placed"]'
        );
        const statusText = queryText(row,
          '[class*="result"]', '[class*="Result"]',
          '[class*="status"]', '[class*="Status"]', '[class*="outcome"]'
        );

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
        console.debug('[BetTracker:Pinnacle] DOM row error:', err);
      }
    });

    return bets;
  }

  // ── Strategy B: API ────────────────────────────────────────
  // Pinnacle's semi-public API endpoint requires authentication cookies,
  // which are sent automatically by the browser. This only works when
  // the user is logged in on pinnacle.com.
  async function scrapeApi() {
    const bets = [];
    try {
      // fromDate: 1 year back
      const from = new Date();
      from.setFullYear(from.getFullYear() - 1);
      const fromStr = from.toISOString().split('T')[0];

      const resp = await fetch(
        `https://api.pinnacle.com/v1/bets?betStatuses=WON,LOST,OPEN&fromDate=${fromStr}`,
        { credentials: 'include' }
      );
      if (!resp.ok) return bets;

      const data = await resp.json();
      const straight = data.straightBets || [];

      for (const b of straight) {
        try {
          const odds   = typeof b.price === 'number' ? b.price : parseOdds(String(b.price));
          const stake  = typeof b.risk  === 'number' ? b.risk  : parseStake(String(b.risk));
          if (!odds || !stake) continue;

          const eventText = [b.leagueName, b.eventName, b.team].filter(Boolean).join(' – ');
          const status    = normalizeStatus(b.betStatus || '');

          bets.push({
            id:         `pinnacle-${b.betId || genId()}`,
            date:       parseDate(b.placedAt || b.settlementAt || ''),
            sport:      detectSport(eventText + ' ' + (b.sportId || '')),
            event:      b.eventName || eventText,
            betType:    normalizeBetType(b.betType || b.side || ''),
            pick:       [b.team, b.handicap].filter(Boolean).join(' ') || b.side || '',
            odds,
            stake,
            sportsbook: SPORTSBOOK,
            status,
            profit:     calcProfit(odds, stake, status),
            closeOdds:  null,
            clv:        null,
            notes:      'Imported via extension (API)',
            source:     'extension',
          });
        } catch {}
      }
    } catch (err) {
      console.debug('[BetTracker:Pinnacle] API error:', err);
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

  async function trySync() {
    // Try API first; fall back to DOM
    let bets = await scrapeApi();
    if (bets.length === 0) {
      bets = scrapeDom();
    }
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
