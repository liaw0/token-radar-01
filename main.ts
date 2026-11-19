// Token Radar — entrypoint (model radar-3).
// Reads the sealed DefiLlama snapshot, scores every pre-token protocol with the
// radar-2 model in lib/model.ts, and writes the ranked board, the dashboard
// data, the dashboard files, the screenshots and the dossier into the output
// directory. Node 22, standard library only. Deterministic: two runs of the
// same snapshot write byte-identical outputs.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSnapshot, buildBoard, buildRadar, dataScript } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const rootDir = dirname(fileURLToPath(import.meta.url));

function flagValue(argv, name, fallback) {
  const at = argv.indexOf(name);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1];
  const eq = argv.find((a) => a.startsWith(name + "="));
  if (eq) return eq.slice(name.length + 1);
  return fallback;
}

function main() {
  const argv = process.argv.slice(2);
  const inputPath = flagValue(argv, "--input", "/input/snapshot.json");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";

  const snapshot = parseSnapshot(readFileSync(inputPath, "utf8"));
  const rows = buildBoard(snapshot);
  const radar = buildRadar(snapshot);

  // Fail fast rather than hand in a board that misses the watchlist or has a
  // broken ranking: both are gate failures, and a run that writes them would
  // look successful until the grade.
  const seen = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length) throw new Error(`board misses watchlist slugs: ${missing.join(", ")}`);
  const ranksOk = rows.map((r) => r.rank).sort((a, b) => a - b).every((r, i) => r === i + 1);
  if (!ranksOk) throw new Error("board ranks are not exactly 1..N");
  const sortedOk = [...rows].sort((a, b) => a.rank - b.rank)
    .every((r, i, arr) => i === 0 || r.implied_value_usd <= arr[i - 1].implied_value_usd);
  if (!sortedOk) throw new Error("board implied values rise with rank");

  const watchlist = new Set(snapshot.watchlist);
  const dataRows = rows.map((row) => ({
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    flow_7d_usd: row.model.flow_7d_usd,
    growth_tier: row.model.growth_tier,
    momentum: row.model.momentum,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  }));
  const dataPayload = { ...radar.radar, rows: dataRows };

  mkdirSync(outDir, { recursive: true });
  const boardPath = join(outDir, "board.json");
  const dataPath = join(outDir, "data.js");
  writeFileSync(boardPath, JSON.stringify({ rows }) + "\n", "utf8");
  writeFileSync(dataPath, dataScript(dataPayload), "utf8");

  const dashOut = join(outDir, "dashboard");
  const shotsOut = join(outDir, "screenshots");
  rmSync(dashOut, { recursive: true, force: true });
  rmSync(shotsOut, { recursive: true, force: true });
  cpSync(join(rootDir, "dashboard"), dashOut, { recursive: true });
  cpSync(join(rootDir, "screenshots"), shotsOut, { recursive: true });

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const early = rows.filter((r) => !watchlist.has(r.slug)).length;
  console.log(
    `token radar: ${snapshot.protocols.length} protocols, ` +
      `${snapshot.watchlist.length} on the watchlist, ` +
      `${rows.length} rows scored (${early} early, ${radar.radar.live_size} live set aside)`,
  );
  console.log(
    `token radar: wrote ${boardPath}, ${dataPath}, ${dashOut}, ${shotsOut} and ${join(outDir, "dossier.json")}`,
  );
}

main();
