# BetTracker

A single-page sports betting tracker with CLV (Closing Line Value) analysis. No backend — all data lives in `localStorage`.

## Features

- **Add/edit/delete bets** — Date, sport, event, bet type, pick, odds, stake, sportsbook, status, and optional notes
- **CLV tracking** — Enter closing odds and the app calculates your edge vs. the closing line
- **Dashboard stats** — Win%, ROI%, total P&L, average CLV, units won/lost, current streak
- **Cumulative P&L chart** — Chart.js line chart of profit over time
- **Filter & sort** — Filter by sport, status, sportsbook, or date range; click column headers to sort
- **CSV export** — Download all bets as a spreadsheet
- **Configurable unit size** — Default 1 unit = $10; click the Unit button in the header to change

## CLV Formula

```
implied_prob(odds) = odds > 0 ? 100/(odds+100) : |odds|/(|odds|+100)

CLV% = (implied_prob_at_close − implied_prob_at_bet) / implied_prob_at_bet × 100
```

- **Positive CLV** → you got a better number than where the line closed (sharp)
- **Negative CLV** → line moved against you before close (soft)

## Usage

Open `index.html` in any modern browser. No build step required.

```
open index.html
```

## Data

All bets are stored under the `bettracker_v1` key in `localStorage`. Unit size is stored under `bettracker_unit`. Clear browser storage to reset.

## Tech

- Pure HTML / CSS / JS — no framework
- [Chart.js 4.4](https://www.chartjs.org/) via CDN for the P&L chart
- [Inter](https://fonts.google.com/specimen/Inter) via Google Fonts
