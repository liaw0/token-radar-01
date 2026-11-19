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
  fastest-movers strip (the eight highest-momentum rows), a sortable and filterable
  board (search, category, chain, watchlist-only, growing-only, sort by implied value,
  momentum or 7-day flow, 50 rows a page), a signals column (watchlist, fast growth,
  declining, new, multi-chain), a side-by-side comparison of up to three protocols,
  a detail view for every protocol with the model's own inputs, its growth signals and
  a six-step farm plan with costs and times, and a model sandbox that re-ranks the
  board live when you move a constant.
- The detail view also explains itself: a "Why this rank" panel splits the implied
  value into base, growth, maturity and breadth, in plain words, with what would move
  the protocol up; and a comparables table shows the three nearest protocols by
  category and TVL, with the gap to beat.
- A farm plan queues up to five protocols (from any detail view, or the top three at
  once), orders them by implied value with each one's first steps, capital, weekly
  time and hold window, and shares the queue through the page address (#plan=...).

## The model (radar-3)

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

Radar-3 adds the growth signals the same 7-day change carries, on every row: the
dollars the TVL gained or lost in seven days (`flow_7d_usd`), a momentum index from
0 to 100 (`momentum`, from the clamped 7-day change: 100 at +120%, 33 on a flat week,
0 at -60%), and a tier (`growth_tier`: surging at +20%, growing at +5%, flat within
±5%, cooling to -10%, falling below). The board can sort by momentum or flow, the
dashboard shows the eight fastest movers and the net 7-day flow across the board, and
the comparison view puts three protocols' growth next to their value.

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
- `lib/model.ts` — the radar-3 model, the board builder and the farm plans.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — `1-board.png` (the board), `2-detail.png` (a protocol's detail
  view), `3-filtered.png` (a filtered view with the comparison of the top three).
- `vendor/makefun-board.ts` — the make.fun dossier library, as shipped in the kit.

## License

MIT. See `LICENSE`.
