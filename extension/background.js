'use strict';

// ── Background Service Worker ──────────────────────────────────
// Handles storage sync and messaging from content scripts.

const STORAGE_KEY = 'bettracker_v1';

// Track last sync metadata per sportsbook
// { [bookName]: { count: number, date: string } }
const syncMeta = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'syncBets') {
    syncBetsToStorage(msg.bets, msg.sportsbook)
      .then(result => sendResponse({ ok: true, count: result.added, total: result.total }))
      .catch(err => {
        console.error('[BetTracker] syncBets error:', err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // keep message channel open for async response
  }

  if (msg.action === 'getSyncMeta') {
    sendResponse({ meta: syncMeta });
    return false;
  }

  if (msg.action === 'getStorageStats') {
    chrome.storage.local.get(STORAGE_KEY, data => {
      const bets = data[STORAGE_KEY] || [];
      sendResponse({ total: bets.length, meta: syncMeta });
    });
    return true;
  }
});

// ── Core sync function ─────────────────────────────────────────
async function syncBetsToStorage(newBets, sportsbook) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STORAGE_KEY, data => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }

      const existing = data[STORAGE_KEY] || [];

      // Build dedup index: composite key → true
      const existingKeys = new Set(existing.map(makeDedupKey));

      let added = 0;
      const merged = [...existing];

      for (const bet of newBets) {
        const key = makeDedupKey(bet);
        if (!existingKeys.has(key)) {
          merged.push(bet);
          existingKeys.add(key);
          added++;
        }
      }

      chrome.storage.local.set({ [STORAGE_KEY]: merged }, () => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }

        // Update sync metadata
        if (sportsbook && added > 0) {
          syncMeta[sportsbook] = {
            count: (syncMeta[sportsbook]?.count || 0) + added,
            lastDate: new Date().toISOString().slice(0, 10),
            totalSeen: newBets.length,
          };
        }

        // Persist meta separately so popup can read it
        chrome.storage.local.set({ bettracker_syncmeta: syncMeta });

        resolve({ added, total: merged.length });
      });
    });
  });
}

// ── Dedup key ──────────────────────────────────────────────────
// Composite: sportsbook + date + event + pick + odds + stake
// Matches the spec dedup logic.
function makeDedupKey(bet) {
  return [
    (bet.sportsbook || '').toLowerCase(),
    bet.date || '',
    (bet.event || bet.game || '').toLowerCase().slice(0, 40),
    (bet.pick || '').toLowerCase().slice(0, 30),
    String(bet.odds || ''),
    String(bet.stake || ''),
  ].join('|');
}

// ── Restore meta on startup ────────────────────────────────────
chrome.storage.local.get('bettracker_syncmeta', data => {
  if (data.bettracker_syncmeta) {
    Object.assign(syncMeta, data.bettracker_syncmeta);
  }
});
