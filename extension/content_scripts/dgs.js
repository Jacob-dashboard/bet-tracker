(function() {
  'use strict';

  const BOOK_NAME = window.location.hostname
    .replace('www.', '')
    .replace('.ag', '')
    .replace('.eu', '')
    .replace('.bet', '')
    .replace('.com', '')
    .replace('.pa', '');

  function waitForBets(callback, attempts = 0) {
    const rows = document.querySelectorAll(
      '.wager-item, .bet-row, tr.wager, .report-row, [class*="wager"], [class*="bet-item"]'
    );
    if (rows.length > 0) {
      callback(rows);
    } else if (attempts < 20) {
      setTimeout(() => waitForBets(callback, attempts + 1), 500);
    }
  }

  function parseOdds(oddsStr) {
    if (!oddsStr) return null;
    const cleaned = oddsStr.toString().trim().replace(/[^0-9+\-.]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    // If decimal odds (1.01 - 50.0 range without explicit +/-)
    if (!oddsStr.includes('+') && !oddsStr.includes('-') && num > 1 && num < 51) {
      if (num >= 2) return Math.round((num - 1) * 100);
      else return Math.round(-100 / (num - 1));
    }
    return Math.round(num);
  }

  function scrapeAndSync() {
    const bets = [];

    const rows = document.querySelectorAll(
      '.wager-item, .bet-row, tr.wager, .report-row, [class*="wager-row"], [class*="bet-history"] tr'
    );

    rows.forEach(row => {
      try {
        const cells = row.querySelectorAll('td, [class*="col"], [class*="cell"]');
        if (cells.length < 3) return;

        const text = row.innerText || '';
        const dateEl = row.querySelector('[class*="date"], td:first-child');
        const oddsEl = row.querySelector('[class*="odds"], [class*="price"]');
        const stakeEl = row.querySelector('[class*="risk"], [class*="stake"], [class*="wager"]');
        const resultEl = row.querySelector('[class*="result"], [class*="status"], [class*="win"], [class*="loss"]');
        const eventEl = row.querySelector('[class*="event"], [class*="game"], [class*="description"]');

        const dateStr = dateEl ? dateEl.innerText.trim() : '';
        const eventStr = eventEl ? eventEl.innerText.trim() : text.substring(0, 50);
        const oddsStr = oddsEl ? oddsEl.innerText.trim() : '';
        const stakeStr = stakeEl ? stakeEl.innerText.replace(/[$,]/g, '').trim() : '0';
        const resultStr = resultEl ? resultEl.innerText.trim().toLowerCase() : '';

        let status = 'Pending';
        if (resultStr.includes('win') || resultStr.includes('won')) status = 'Won';
        else if (resultStr.includes('loss') || resultStr.includes('lost')) status = 'Lost';
        else if (resultStr.includes('push') || resultStr.includes('tie')) status = 'Push';
        else if (resultStr.includes('void') || resultStr.includes('cancel')) status = 'Void';

        const odds = parseOdds(oddsStr);
        const stake = parseFloat(stakeStr) || 0;

        if (!stake && !eventStr) return; // skip empty rows

        let profit = 0;
        if (status === 'Won' && odds) {
          profit = odds > 0 ? (stake * odds / 100) : (stake * 100 / Math.abs(odds));
        } else if (status === 'Lost') {
          profit = -stake;
        }

        const bookLabel = BOOK_NAME.charAt(0).toUpperCase() + BOOK_NAME.slice(1);
        const id = btoa(`${BOOK_NAME}-${dateStr}-${eventStr}-${odds}-${stake}`).substring(0, 32);

        bets.push({
          id,
          date: dateStr || new Date().toISOString().split('T')[0],
          sport: 'Other',
          game: eventStr,
          betType: 'Moneyline',
          pick: eventStr,
          odds: odds || 0,
          stake,
          sportsbook: bookLabel,
          status,
          profit: Math.round(profit * 100) / 100,
          closingOdds: null,
          clv: null,
          notes: 'Imported via BetTracker extension',
          source: 'extension'
        });
      } catch(e) { /* skip bad rows */ }
    });

    if (bets.length > 0) {
      chrome.runtime.sendMessage({ action: 'syncBets', bets }, (response) => {
        if (response && response.ok) {
          showToast(`BetTracker: ${response.count} bets synced \u2713`);
        }
      });
    }
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#161b22;color:#3fb950;border:1px solid #3fb950;padding:10px 16px;border-radius:8px;font-family:sans-serif;font-size:13px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,.5)';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // Run on bet history pages
  const path = window.location.pathname;
  if (path.includes('report') || path.includes('my-bets') || path.includes('bet-history') || path.includes('account')) {
    setTimeout(scrapeAndSync, 1500);

    // Watch for SPA navigation
    let lastPath = path;
    setInterval(() => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        setTimeout(scrapeAndSync, 1500);
      }
    }, 1000);
  }
})();
