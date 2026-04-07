'use strict';

// ── Popup script ───────────────────────────────────────────────

const BOOKS = [
  { name: 'Bovada',          domain: 'bovada.lv' },
  { name: 'BetOnline',       domain: 'betonline.ag' },
  { name: 'MyBookie',        domain: 'mybookie.ag' },
  { name: 'BetUS',           domain: 'betus.com' },
  { name: 'Bookmaker',       domain: 'bookmaker.eu' },
  { name: 'Sportsbetting.ag',domain: 'sportsbetting.ag' },
  { name: 'Pinnacle',        domain: 'pinnacle.com' },
];

async function getActiveDomains() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true }, tabs => {
      const domains = new Set();
      for (const tab of tabs) {
        try {
          const url = new URL(tab.url || '');
          domains.add(url.hostname.replace(/^www\./, ''));
        } catch {}
      }
      resolve(domains);
    });
  });
}

async function getSyncMeta() {
  return new Promise(resolve => {
    chrome.storage.local.get('bettracker_syncmeta', data => {
      resolve(data.bettracker_syncmeta || {});
    });
  });
}

async function getTotalBets() {
  return new Promise(resolve => {
    chrome.storage.local.get('bettracker_v1', data => {
      resolve((data.bettracker_v1 || []).length);
    });
  });
}

function renderBooks(activeDomains, syncMeta, container) {
  container.innerHTML = '';

  for (const book of BOOKS) {
    const isActive = [...activeDomains].some(d =>
      d === book.domain || d.endsWith('.' + book.domain)
    );
    const meta = syncMeta[book.name];

    const li = document.createElement('li');
    li.className = 'book-item' + (isActive ? ' active' : '');

    const dotCls = isActive ? 'dot-active' : 'dot-inactive';
    const countHtml = meta
      ? `<span class="book-count">${meta.count} bets</span><span class="book-date">${meta.lastDate}</span>`
      : `<span class="book-date">Not synced</span>`;

    li.innerHTML = `
      <div class="book-left">
        <span class="book-status-dot ${dotCls}"></span>
        <div>
          <div class="book-name">${book.name}</div>
          <div class="book-meta">${book.domain}</div>
        </div>
      </div>
      <div class="book-right">${countHtml}</div>
    `;

    container.appendChild(li);
  }
}

async function refresh() {
  const [activeDomains, syncMeta, total] = await Promise.all([
    getActiveDomains(),
    getSyncMeta(),
    getTotalBets(),
  ]);

  const container = document.getElementById('books-list');
  renderBooks(activeDomains, syncMeta, container);

  document.getElementById('total-count').textContent =
    total === 0 ? 'No bets synced yet' : `${total} total bet${total !== 1 ? 's' : ''} synced`;
}

document.addEventListener('DOMContentLoaded', () => {
  refresh();

  document.getElementById('btn-refresh').addEventListener('click', refresh);

  document.getElementById('btn-open-tracker').addEventListener('click', () => {
    // Try to find an existing tracker tab, otherwise open a new one.
    // Supports both file:// and localhost.
    chrome.tabs.query({}, tabs => {
      const trackerTab = tabs.find(t =>
        t.url && (
          t.url.includes('bet-tracker/index.html') ||
          t.url.includes('localhost') && t.url.includes('bet-tracker')
        )
      );
      if (trackerTab) {
        chrome.tabs.update(trackerTab.id, { active: true });
        chrome.windows.update(trackerTab.windowId, { focused: true });
      } else {
        // Default: open the index.html relative to extension location.
        // User can also navigate manually.
        chrome.tabs.create({ url: 'https://github.com' }); // placeholder — see README
      }
    });
  });
});
