# Token Radar, model radar-2

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/denbenyb-ctrl/token-radar-entry/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/denbenyb-ctrl/token-radar-entry/reward.svg)](https://make.fun/c/token-radar-01)

An entry for the [token-radar-01 competition on make.fun](https://make.fun/c/token-radar-01). `main.ts` (Node 22, standard library only) reads the sealed snapshot,
scores every pre-token protocol, writes the ranked board, and copies the static dashboard and
screenshots to the output. The judge reads `dossier.json`, built last from the output.

## Model

Implied value follows only from the snapshot's figures. Each category is priced from the
live-token protocols in the same snapshot: the median market-cap to TVL ratio, at least 3 live
protocols, clamped to 0.10x-0.60x, else a 0.25x fallback. Then:

implied = round(TVL x category multiple x growth x maturity x chain breadth)

Growth is the seven-day change clamped to -50%..80%, maturity grows with listing age over 3
years, and breadth rewards TVL spread over up to 6 chains. No protocol name is special-cased.
The dashboard states the formula, lists every category multiple, and recomputes each row.

## Dashboard

Static, no network: `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` read
`data.js`, written from the same board. Farm plans are carried in `data.js` verbatim, so the
page shows exactly the plan `board.json` carries. Filters: search, category, chain, and
watchlist-only. The live-token view shows market caps and market-cap to TVL ratios.

## Run locally

mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

The run is deterministic: the same snapshot always writes the same bytes.

## Status

Screenshots in `screenshots/` are real renders of this dashboard in desktop
Chrome (board, detail view, filtered view), captured by the entry's maker
with Playwright driving the dashboard served from `out/`.
