# Token Radar — Build the best token launch radar

A web dashboard that ranks pre-token DeFi protocols by the implied value of the token
they may one day issue, and shows a reader how to farm each one.

## What it does

- Reads the sealed DefiLlama snapshot (`/input/snapshot.json`, 758 protocols as of
  2026-11-14) and scores every rankable pre-token protocol with one transparent model.
- The board covers all 40 watchlist protocols plus all 138 other rankable pre-token
  protocols below the $50M floor — 178 rows. A protocol is rankable when it records no
  token and is not a wrapped, staked or bridged product of a token that already trades,
  by the same rule the watchlist itself was drawn with. The 24 largest live-token
  protocols are set aside with their market caps shown, never mixed into the ranking.
- The dashboard is a static page with no network: a top-10 implied-value chart, a
  sortable and filterable board (search, category, chain, watchlist-only, growing-only,
  50 rows a page), a signals column (watchlist, fast growth, declining, new,
  multi-chain), a detail view for every protocol with the model's own inputs and a
  six-step farm plan with costs and times, and a model sandbox that re-ranks the board
  live when you move a constant.

## The model (radar-2)

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.02 x min(chains - 1, 5)) )
```

TVL, seven-day growth, age with no token (365 days when unlisted) and chain breadth —
all from the snapshot's own figures, no protocol name special-cased. Breadth is the one
addition to the house model: a protocol live on more chains reaches more users, capped
at a 10% move. The dashboard states the formula and lets the reader change the three
weights in a sandbox; the submitted board always uses the constants above.

Implied value is a model, not a price: it says what a token would be worth if the
protocol's record stayed as it is. It does not predict whether or when a token is issued.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, copies
`dashboard/` and `screenshots/` to the output directory, and writes `dossier.json`
with the vendored `vendor/makefun-board.ts`. It runs twice and writes the same bytes.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the board, data and dossier.
- `lib/model.ts` — the radar-2 model, the board builder and the farm plans.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — `1-board.png` (the board), `2-detail.png` (a protocol's detail
  view), `3-filtered.png` (a filtered view).
- `vendor/makefun-board.ts` — the make.fun dossier library, as shipped in the kit.

## License

MIT. See `LICENSE`.
