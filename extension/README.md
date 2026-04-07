# BetTracker Sync — Chrome Extension

Auto-syncs your bet history from offshore and regulated sportsbooks into the [BetTracker](../index.html) app.

## How to Load in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder inside this project
5. The BetTracker Sync extension will appear with a 🎯 icon in your toolbar

## Supported Sportsbooks

| Book              | Domain             | Bet History Page          |
|-------------------|--------------------|---------------------------|
| Bovada            | bovada.lv          | /sports/my-bets           |
| BetOnline         | betonline.ag       | /account/my-bets          |
| MyBookie          | mybookie.ag        | /account/bets             |
| BetUS             | betus.com          | /sports/my-bets or /account/bet-history |
| Bookmaker         | bookmaker.eu       | /account/my-bets          |
| Sportsbetting.ag  | sportsbetting.ag   | /account/bets             |
| Pinnacle          | pinnacle.com       | /en/betting-history       |

## How Sync Works

1. **Visit your bet history page** on any supported sportsbook while logged in.
2. The extension's content script automatically detects the page and scrapes visible bets.
3. Scraped bets are normalized to the BetTracker data format and sent to the background service worker.
4. The background worker **deduplicates** by composite key (`sportsbook + date + event + pick + odds + stake`) — existing bets are never overwritten.
5. Bets are stored in `chrome.storage.local` under the key `bettracker_v1`.
6. A small **toast notification** confirms how many bets were synced.
7. Open the BetTracker app (`index.html`) — it reads from `localStorage`. To bridge the two, open the BetTracker app and paste the synced data, or serve the app locally so it shares the same origin storage.

### Pinnacle: API Mode

For Pinnacle, the extension first attempts to call the Pinnacle API (`/v1/bets`) using your active session cookies. This gives cleaner, more complete data. If the API is unavailable, it falls back to DOM scraping.

### SPA Handling

Most of these sites are single-page apps. The extension uses `MutationObserver` to detect when bet history content loads dynamically, then re-runs the scraper automatically.

## Opening the BetTracker App

Click the extension popup → **Open BetTracker** button. If you're running the app via a local web server (e.g. `npx serve` or `python -m http.server`), the popup will find an open tab. For `file://` usage, open `index.html` directly.

## Privacy

- **All data stays local.** No bets, account info, or personal data is ever sent to any external server.
- The extension only reads DOM content on the supported sportsbook domains listed above.
- Storage is limited to `chrome.storage.local` on your machine.
- No analytics, no telemetry, no network requests except the optional Pinnacle API call (to pinnacle.com's own API, using your own session).

## Troubleshooting

**No bets synced after visiting my bets page:**
- Make sure you're on the exact bet history page URL listed above (not the general account page).
- Some sites load content with a delay — wait a few seconds and refresh.
- Sportsbooks occasionally redesign their DOM. If scraping breaks, the selectors in `content_scripts/<book>.js` may need updating.

**Bets not appearing in BetTracker:**
- The extension stores bets in `chrome.storage.local`. The BetTracker app reads from `localStorage`.
- To import: open the browser console on the BetTracker app page and run:
  ```js
  chrome.storage.local.get('bettracker_v1', d => {
    localStorage.setItem('bettracker_v1', JSON.stringify(d.bettracker_v1 || []));
    location.reload();
  });
  ```

## File Structure

```
extension/
├── manifest.json          — MV3 manifest, permissions, content script registration
├── background.js          — Service worker: storage sync, deduplication
├── popup.html / .js / .css — Extension popup UI
├── content_scripts/
│   ├── bovada.js
│   ├── betonline.js
│   ├── mybookie.js
│   ├── betus.js
│   ├── bookmaker.js
│   ├── sportsbetting.js
│   └── pinnacle.js        — Includes API + DOM scraping strategies
└── icons/
    └── icon128.png
```
