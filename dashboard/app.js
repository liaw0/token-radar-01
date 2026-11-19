/* Token Radar dashboard.
   Reads window.RADAR (written by main.ts from the sealed snapshot) and renders
   the board, the top-10 chart, the live-token set-aside and one detail view per
   protocol. No network: every value comes from the local data file. */
(function () {
  "use strict";

  var D = window.RADAR || { rows: [], live: [], model: {} };
  var ROWS = D.rows || [];
  var LIVE = D.live || [];
  var PAGE_SIZE = 50;

  var BASE = { base: 0.25, growth: 0.5, breadth: 0.02 };
  var weights = { base: BASE.base, growth: BASE.growth, breadth: BASE.breadth };

  var state = { q: "", cat: "", chain: "", watch: false, growing: false, sort: "implied", page: 0 };
  var openSlug = null;
  var compare = []; /* slugs picked for the side-by-side view, at most 3 */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  function moneyFull(v) {
    if (v == null || !isFinite(v)) return "—";
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  /* A signed dollar figure: the 7-day flow, with + for money in and − for money out. */
  function flowMoney(v) {
    if (v == null || !isFinite(v)) return "—";
    var sign = v > 0 ? "+" : v < 0 ? "−" : "";
    return sign + money(Math.abs(v));
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  /* A row's momentum, 0–100 from its clamped 7-day change; data.js carries it, this is the fallback. */
  function momentumOf(r) {
    if (r.momentum != null && isFinite(r.momentum)) return r.momentum;
    var g = r.change_7d == null ? 0 : clamp(r.change_7d, -60, 120);
    return Math.round(((g + 60) / 180) * 100);
  }
  function tierOf(r) {
    if (r.growth_tier) return r.growth_tier;
    var c = r.change_7d;
    if (c == null) return "flat";
    if (c >= 20) return "surging";
    if (c >= 5) return "growing";
    if (c > -5) return "flat";
    if (c > -10) return "cooling";
    return "falling";
  }

  /* ---------- why this rank ---------- */
  /* The implied value split into its four parts, so the detail view can say in
     plain words what drives a protocol's rank. The parts are sequential: base,
     then what growth adds, then what maturity adds, then what breadth adds —
     they always add up to the implied value shown. Maturity can be negative:
     a young protocol is still held back by the maturity factor until it has
     run longer with no token. */
  function whyParts(r) {
    var calc = impliedOf(r, sandboxOn() ? weights : BASE);
    var base = r.tvl_usd * (sandboxOn() ? weights.base : BASE.base);
    var afterGrowth = base * calc.growth;
    var afterMaturity = afterGrowth * calc.maturity;
    var value = sandboxOn() ? calc.value : r.implied_value_usd;
    return {
      base: base,
      growth: afterGrowth - base,
      maturity: afterMaturity - afterGrowth,
      breadth: value - afterMaturity,
      value: value,
      growthMult: calc.growth,
      maturityMult: calc.maturity,
      breadthMult: calc.breadth
    };
  }
  function whyLines(r, parts) {
    var out = [];
    var chains = (r.chains || []).length;
    out.push("TVL of " + moneyFull(r.tvl_usd) + " is the base: at " +
      (sandboxOn() ? weights.base : BASE.base) + "× it is worth " + moneyFull(parts.base) +
      " before any adjustment.");
    if (r.change_7d == null) {
      out.push("No 7-day change is reported, so growth neither adds nor takes away.");
    } else if (parts.growth > 0) {
      out.push("A " + pct(r.change_7d) + " week lifts it by " + moneyFull(parts.growth) +
        " (growth ×" + parts.growthMult.toFixed(3) + ").");
    } else if (parts.growth < 0) {
      out.push("A " + pct(r.change_7d) + " week drags it down by " + moneyFull(-parts.growth) +
        " (growth ×" + parts.growthMult.toFixed(3) + ").");
    } else {
      out.push("A flat week leaves the base almost untouched (growth ×1.000).");
    }
    if (r.age_days == null) {
      out.push("No listing date is given, so the model assumes 365 days with no token, " +
        "and maturity still holds it back by " + moneyFull(-parts.maturity) +
        " (maturity ×" + parts.maturityMult.toFixed(3) + ").");
    } else if (parts.maturity < 0) {
      out.push(r.age_days + " days listed with no token, so maturity still holds it back by " +
        moneyFull(-parts.maturity) + " (maturity ×" + parts.maturityMult.toFixed(3) + ").");
    } else {
      out.push(r.age_days + " days listed with no token: at full maturity it holds nothing back.");
    }
    if (chains <= 1) {
      out.push("On a single chain, breadth adds nothing.");
    } else {
      out.push("Running on " + chains + " chains adds " + moneyFull(parts.breadth) +
        " (breadth ×" + parts.breadthMult.toFixed(3) + ").");
    }
    out.push("Momentum " + momentumOf(r) + " / 100 puts it in the " + tierOf(r) +
      " tier, and it is " + (r.watchlist ? "on the house watchlist." : "an early find below the $50M floor."));
    return out;
  }
  /* What would move this protocol up: the implied value if its 7-day change were
     +20% instead, and if it ran on one more chain — with the rank that value
     would earn on today's board. Both are the same formula, re-applied. */
  function whatIf(r) {
    var w = sandboxOn() ? weights : BASE;
    var growth20 = impliedOf({ tvl_usd: r.tvl_usd, change_7d: 20, age_days: r.age_days, chains: r.chains || [] }, w).value;
    var oneMoreChain = impliedOf({ tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days, chains: (r.chains || []).concat(["x"]) }, w).value;
    function rankFor(value) {
      var above = 0;
      ROWS.forEach(function (x) { if (shownImplied(x) > value) above += 1; });
      return above + 1;
    }
    var out = [];
    if (growth20 > shownImplied(r)) {
      out.push("If its 7-day change were +20% instead of " + pct(r.change_7d) + ", its implied value would be " +
        money(growth20) + " — rank " + rankFor(growth20) + " on today's board.");
    }
    if (oneMoreChain > shownImplied(r)) {
      out.push("One more chain would take it to " + money(oneMoreChain) +
        " — rank " + rankFor(oneMoreChain) + " on today's board.");
    }
    if (!out.length) out.push("Nothing in its own figures would move it up: it is already at the top of what its TVL supports.");
    return out;
  }
  function whyRankHtml(r) {
    var parts = whyParts(r);
    var segs = [
      ["base", parts.base, "var(--accent)"],
      ["growth", parts.growth, "var(--green)"],
      ["maturity", parts.maturity, "var(--blue)"],
      ["breadth", parts.breadth, "var(--violet)"]
    ];
    var bar = segs.map(function (s) {
      var w = parts.value > 0 ? Math.max(0, (s[1] / parts.value) * 100) : 0;
      return '<span class="why-seg" title="' + s[0] + " " + esc(moneyFull(s[1])) +
        '" style="width:' + w.toFixed(1) + "%;background:" + s[2] + '"></span>';
    }).join("");
    var lines = whyLines(r, parts).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    var next = whatIf(r).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    return "<h4>Why this rank</h4>" +
      '<div class="why-bar" role="img" aria-label="Implied value split into base, growth, maturity and breadth">' + bar + "</div>" +
      '<p class="why-legend"><span class="why-dot" style="background:var(--accent)"></span>base ' +
      esc(money(parts.base)) + ' · <span class="why-dot" style="background:var(--green)"></span>growth ' +
      esc(flowMoney(parts.growth)) + ' · <span class="why-dot" style="background:var(--blue)"></span>maturity ' +
      esc(flowMoney(parts.maturity)) + ' · <span class="why-dot" style="background:var(--violet)"></span>breadth ' +
      esc(flowMoney(parts.breadth)) + "</p>" +
      '<ul class="why">' + lines + "</ul>" +
      '<h4>What would move it up</h4>' +
      '<ul class="why">' + next + "</ul>";
  }

  /* ---------- comparables ---------- */
  /* The three most similar protocols: same category first, nearest by TVL, then
     the nearest by TVL overall when the category runs out. Similarity is the
     absolute gap in log TVL, so a $10M protocol compares with $8M and $12M
     neighbours, not with a $5B giant. */
  function comparablesOf(r) {
    var logTvl = Math.log(Math.max(1, r.tvl_usd));
    function gap(x) { return Math.abs(Math.log(Math.max(1, x.tvl_usd)) - logTvl); }
    var same = ROWS.filter(function (x) {
      return x.slug !== r.slug && x.category != null && r.category != null && x.category === r.category;
    }).sort(function (a, b) { return gap(a) - gap(b) || a.rank - b.rank; });
    var picked = same.slice(0, 3);
    if (picked.length < 3) {
      var rest = ROWS.filter(function (x) {
        return x.slug !== r.slug && picked.indexOf(x) < 0;
      }).sort(function (a, b) { return gap(a) - gap(b) || a.rank - b.rank; });
      picked = picked.concat(rest.slice(0, 3 - picked.length));
    }
    return picked;
  }
  function comparablesHtml(r) {
    var list = comparablesOf(r);
    if (!list.length) return "";
    var rows = list.map(function (x) {
      var diff = x.implied_value_usd - r.implied_value_usd;
      var diffTxt = diff > 0 ? "+" + money(diff) + " vs this one" :
        diff < 0 ? "−" + money(-diff) + " vs this one" : "same value";
      return '<tr data-slug="' + esc(x.slug) + '"><td class="num">#' + x.rank + "</td>" +
        '<td><span class="nm">' + esc(x.name) + '</span><span class="sub">' + esc(x.slug) + "</span></td>" +
        "<td>" + esc(x.category || "—") + "</td>" +
        '<td class="num">' + esc(money(x.tvl_usd)) + "</td>" +
        changeCell(x.change_7d) +
        '<td class="num"><strong>' + esc(money(x.implied_value_usd)) + "</strong></td>" +
        '<td class="num">' + esc(diffTxt) + "</td></tr>";
    }).join("");
    var nearest = list[0];
    var gapLine = nearest && nearest.implied_value_usd > r.implied_value_usd
      ? "To pass its nearest comparable it needs " + money(nearest.implied_value_usd - r.implied_value_usd) +
        " more implied value — about " +
        Math.round(((nearest.implied_value_usd / Math.max(1, r.implied_value_usd)) - 1) * 100) +
        "% more TVL at the same growth."
      : "It already beats its nearest comparable on implied value.";
    return "<h4>Comparables — same category, nearest TVL</h4>" +
      '<p class="fine">The ranking is comparative: these are the protocols this one has to beat. ' +
      "Same category first, then the nearest TVL overall. " + esc(gapLine) + "</p>" +
      '<div class="table-wrap"><table class="comp-mini"><thead><tr><th class="num">#</th><th>Protocol</th>' +
      "<th>Category</th>" + '<th class="num">TVL</th><th class="num">7d</th>' +
      '<th class="num">Implied value</th><th class="num">Gap</th></tr></thead><tbody>' + rows +
      "</tbody></table></div>";
  }

  /* The radar-2 formula, re-applied with whatever weights the sandbox holds.
     age_days is the days listed with no token recorded (365 when unlisted). */
  function impliedOf(r, w) {
    var growth = r.change_7d == null ? 0 : clamp(r.change_7d, -60, 120);
    var growthMult = 1 + (growth / 100) * w.growth;
    var maturityMult = 0.6 + (Math.min(r.age_days || 365, 1095) / 1095) * 0.4;
    var breadthMult = 1 + w.breadth * Math.min((r.chains || []).length - 1, 5);
    return {
      value: Math.round(r.tvl_usd * w.base * growthMult * maturityMult * breadthMult),
      growth: growthMult, maturity: maturityMult, breadth: breadthMult
    };
  }
  function sandboxOn() {
    return weights.base !== BASE.base || weights.growth !== BASE.growth || weights.breadth !== BASE.breadth;
  }
  function shownImplied(r) {
    return sandboxOn() ? impliedOf(r, weights).value : r.implied_value_usd;
  }

  function signalsOf(r) {
    var out = [];
    if (r.watchlist) out.push(["sig-watch", "WATCHLIST"]);
    if (r.change_7d != null && r.change_7d >= 20) out.push(["sig-fast", "FAST"]);
    if (r.change_7d != null && r.change_7d <= -10) out.push(["sig-down", "DOWN"]);
    if (r.age_days != null && r.age_days < 180) out.push(["sig-new", "NEW"]);
    if ((r.chains || []).length >= 5) out.push(["sig-multi", "MULTI"]);
    return out;
  }
  function signalHtml(r) {
    return signalsOf(r).map(function (s) {
      return '<span class="sig ' + s[0] + '">' + s[1] + "</span>";
    }).join("");
  }
  function chainsShort(r) {
    var c = r.chains || [];
    if (!c.length) return "—";
    if (c.length <= 3) return esc(c.join(", "));
    return esc(c.slice(0, 3).join(", ")) + " +" + (c.length - 3) + " more";
  }
  function changeCell(v) {
    if (v == null) return '<td class="num">—</td>';
    var cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
    return '<td class="num ' + cls + '">' + esc(pct(v)) + "</td>";
  }

  /* ---------- stats + filter options ---------- */
  function renderStats() {
    var el = $("stats");
    var trend = D.trend || {};
    var cells = [
      [ROWS.length, "ranked pre-token"],
      [D.watchlist_size || 0, "on the watchlist"],
      [D.early_size || 0, "early finds below the floor"],
      [trend.surging != null ? trend.surging : "—", "surging (+20% or more in 7d)"],
      [trend.total_flow_7d_usd != null ? flowMoney(trend.total_flow_7d_usd) : "—", "net 7-day TVL flow"],
      [LIVE.length, "live tokens set aside"],
      [money(D.floor_usd), "watchlist floor (TVL)"]
    ];
    el.innerHTML = cells.map(function (c) {
      return "<div><dt>" + esc(c[1]) + "</dt><dd>" + esc(c[0]) + "</dd></div>";
    }).join("");
  }
  function fillSelect(el, values) {
    var cur = el.value;
    el.innerHTML = '<option value="">All ' + (el.id === "f-cat" ? "categories" : "chains") + "</option>" +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + "</option>"; }).join("");
    el.value = cur;
  }
  function buildFilters() {
    var cats = {}, chains = {};
    ROWS.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      (r.chains || []).forEach(function (c) { chains[c] = true; });
    });
    fillSelect($("f-cat"), Object.keys(cats).sort());
    fillSelect($("f-chain"), Object.keys(chains).sort());
  }

  /* ---------- filtering + sorting ---------- */
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watch && !r.watchlist) return false;
      if (state.growing && !(r.change_7d != null && r.change_7d > 0)) return false;
      return true;
    });
    var by = state.sort;
    list.sort(function (a, b) {
      if (by === "implied") return shownImplied(b) - shownImplied(a);
      if (by === "momentum") return momentumOf(b) - momentumOf(a) || shownImplied(b) - shownImplied(a);
      if (by === "flow") return (b.flow_7d_usd || 0) - (a.flow_7d_usd || 0);
      if (by === "tvl") return b.tvl_usd - a.tvl_usd;
      if (by === "change") return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d);
      if (by === "age") return (b.age_days || 0) - (a.age_days || 0);
      if (by === "name") return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return list;
  }

  /* ---------- chart ---------- */
  function renderChart() {
    var top = ROWS.slice().sort(function (a, b) { return shownImplied(b) - shownImplied(a); }).slice(0, 10);
    var max = top.length ? shownImplied(top[0]) : 1;
    $("chart").innerHTML = top.map(function (r, i) {
      var v = shownImplied(r);
      var w = Math.max(2, (v / max) * 100);
      return '<div class="bar-row"><span class="rank">' + (i + 1) + '</span>' +
        '<span class="nm" title="' + esc(r.name) + '">' + esc(r.name) + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="display:block;width:' + w.toFixed(1) + '%"></span></span>' +
        '<span class="val">' + esc(money(v)) + "</span></div>";
    }).join("");
  }

  /* ---------- fastest movers ---------- */
  function renderMovers() {
    var leaders = D.growth_leaders || [];
    if (!leaders.length) {
      leaders = ROWS.slice().sort(function (a, b) {
        return momentumOf(b) - momentumOf(a) || (b.flow_7d_usd || 0) - (a.flow_7d_usd || 0);
      }).slice(0, 8).map(function (r) {
        return { rank: r.rank, slug: r.slug, name: r.name, tvl_usd: r.tvl_usd, change_7d: r.change_7d, flow_7d_usd: r.flow_7d_usd || 0, momentum: momentumOf(r), implied_value_usd: r.implied_value_usd };
      });
    }
    $("movers").innerHTML = leaders.map(function (m) {
      var tier = tierOf(m);
      return '<div class="mover" data-slug="' + esc(m.slug) + '">' +
        '<span class="mover-name">' + esc(m.name) + '</span>' +
        '<span class="mover-rank">#' + m.rank + " · " + esc(money(m.implied_value_usd)) + "</span>" +
        '<span class="mom-track"><span class="mom-fill tier-' + tier + '" style="display:block;width:' + m.momentum + '%"></span></span>' +
        '<span class="mover-num">' + m.momentum + '<small>momentum</small></span>' +
        '<span class="mover-flow ' + (m.flow_7d_usd > 0 ? "pos" : m.flow_7d_usd < 0 ? "neg" : "") + '">' + esc(flowMoney(m.flow_7d_usd)) + "<small>7d flow · " + esc(pct(m.change_7d)) + "</small></span></div>";
    }).join("");
    Array.prototype.forEach.call($("movers").querySelectorAll(".mover"), function (el) {
      el.addEventListener("click", function () { openDetail(el.getAttribute("data-slug")); });
    });
  }

  /* ---------- board ---------- */
  function renderBoard() {
    var list = filteredRows();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    var start = state.page * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);
    var active = sandboxOn();
    var body = $("board-body");
    if (!slice.length) {
      body.innerHTML = '<tr><td colspan="11">Nothing matches these filters. Clear them to see the full board.</td></tr>';
    } else {
      body.innerHTML = slice.map(function (r, i) {
        var pos = start + i + 1;
        var shown = active ? pos : r.rank;
        var cls = r.slug === openSlug ? ' class="open"' : "";
        var mom = momentumOf(r);
        var flow = r.flow_7d_usd == null ? 0 : r.flow_7d_usd;
        var flowCls = flow > 0 ? "pos" : flow < 0 ? "neg" : "";
        var checked = compare.indexOf(r.slug) >= 0 ? " checked" : "";
        return "<tr data-slug=\"" + esc(r.slug) + "\"" + cls + ">" +
          '<td class="cmp-col"><input type="checkbox" class="cmp" data-slug="' + esc(r.slug) + '"' + checked + ' aria-label="Compare ' + esc(r.name) + '"></td>' +
          '<td class="num">' + shown + "</td>" +
          '<td><span class="nm">' + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + "</span></td>" +
          "<td>" + esc(r.category || "—") + "</td>" +
          '<td><span class="chains">' + chainsShort(r) + "</span></td>" +
          '<td class="num">' + esc(money(r.tvl_usd)) + "</td>" +
          changeCell(r.change_7d) +
          '<td class="num"><span class="mom-cell"><span class="mom-track"><span class="mom-fill tier-' + tierOf(r) + '" style="display:block;width:' + mom + '%"></span></span>' + mom + "</span></td>" +
          '<td class="num ' + flowCls + '">' + esc(flowMoney(flow)) + "</td>" +
          '<td class="num"><strong>' + esc(money(shownImplied(r))) + "</strong></td>" +
          "<td>" + signalHtml(r) + "</td></tr>";
      }).join("");
    }
    $("board-count").textContent = list.length === ROWS.length
      ? ROWS.length + " protocols"
      : list.length + " of " + ROWS.length + " protocols";
    var end = Math.min(list.length, start + PAGE_SIZE);
    $("pg-info").textContent = list.length
      ? "Showing " + (start + 1) + "–" + end + " of " + list.length + (active ? " · sandbox re-rank" : "")
      : "No rows";
    $("pg-prev").disabled = state.page <= 0;
    $("pg-next").disabled = state.page >= pages - 1;
    Array.prototype.forEach.call(body.querySelectorAll("tr[data-slug]"), function (tr) {
      tr.addEventListener("click", function () { openDetail(tr.getAttribute("data-slug")); });
    });
    Array.prototype.forEach.call(body.querySelectorAll("input.cmp"), function (box) {
      box.addEventListener("click", function (ev) { ev.stopPropagation(); });
      box.addEventListener("change", function () { toggleCompare(box.getAttribute("data-slug")); });
    });
  }

  /* ---------- compare ---------- */
  function compareRows() {
    return compare.map(function (slug) {
      var found = null;
      ROWS.forEach(function (r) { if (r.slug === slug) found = r; });
      return found;
    }).filter(function (r) { return r !== null; });
  }
  function toggleCompare(slug) {
    var at = compare.indexOf(slug);
    if (at >= 0) {
      compare.splice(at, 1);
    } else {
      if (compare.length >= 3) compare.shift();
      compare.push(slug);
    }
    renderBoard();
    renderCompare();
  }
  function compareTop3() {
    compare = ROWS.slice().sort(function (a, b) { return shownImplied(b) - shownImplied(a); })
      .slice(0, 3).map(function (r) { return r.slug; });
    renderBoard();
    renderCompare();
  }
  function renderCompare() {
    var picked = compareRows();
    $("compare-count").textContent = picked.length ? picked.length + " of 3 picked" : "none picked yet — top 3 by default";
    if (!picked.length) {
      $("compare-body").innerHTML = '<p class="fine">Tick rows on the board, or press “Compare top 3”.</p>';
      return;
    }
    var metricRows = [
      ["Rank", function (r) { return "#" + r.rank + " of " + ROWS.length; }],
      ["Implied value", function (r) { return "<strong>" + esc(money(shownImplied(r))) + "</strong>"; }],
      ["TVL", function (r) { return esc(moneyFull(r.tvl_usd)); }],
      ["7-day change", function (r) { return esc(pct(r.change_7d)); }],
      ["7-day flow", function (r) { return esc(flowMoney(r.flow_7d_usd || 0)); }],
      ["Momentum", function (r) { return momentumOf(r) + " / 100 · " + tierOf(r); }],
      ["Age with no token", function (r) { return r.age_days == null ? "—" : r.age_days + " days"; }],
      ["Chains", function (r) {
        var c = (r.chains || []).join(", ");
        return c ? '<span class="cmp-left">' + esc(c) + "</span>" : "—";
      }],
      ["Category", function (r) { return esc(r.category || "—"); }],
      ["Watchlist", function (r) { return r.watchlist ? "yes" : "early find"; }]
    ];
    var head = '<table class="compare"><thead><tr><th></th>' + picked.map(function (r) {
      return "<th>" + esc(r.name) + '<span class="sub">' + esc(r.slug) + "</span></th>";
    }).join("") + "</tr></thead><tbody>";
    var body = metricRows.map(function (m) {
      return "<tr><th>" + m[0] + "</th>" + picked.map(function (r) {
        return '<td class="num">' + m[1](r) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    var steps = "<tr><th>Farm steps</th>" + picked.map(function (r) {
      var s = r.farm_steps || [];
      /* The first three steps fit the card; the rest live in the detail view. */
      return "<td><ol class=\"farm cmp-farm\">" + s.slice(0, 3).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
        (s.length > 3 ? '<p class="fine">+ ' + (s.length - 3) + " more steps — open the detail view.</p>" : "") + "</td>";
    }).join("") + "</tr>";
    $("compare-body").innerHTML = head + body + steps + "</tbody></table>";
  }

  /* ---------- farm plan ---------- */
  var plan = []; /* slugs queued for farming, at most 5 */
  var PLAN_MAX = 5;
  /* The capital one farm position needs, from the protocol's own TVL — the same
     tiers the model's farm plans use. */
  function capitalTierOf(r) {
    if (r.tvl_usd >= 5e9) return 250;
    if (r.tvl_usd >= 1e9) return 150;
    if (r.tvl_usd >= 1e8) return 100;
    return 50;
  }
  /* How long to hold, from the protocol's age: younger protocols get a longer
     qualifying window. */
  function holdDaysOf(r) {
    var age = r.age_days;
    if (age == null) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  /* One protocol's effort in one line: capital, weekly time and hold window. */
  function effortNote(r) {
    return "$" + capitalTierOf(r) + " capital · about 10 min a week · hold " + holdDaysOf(r) + " days";
  }
  function planRows() {
    return plan.map(function (slug) {
      var found = null;
      ROWS.forEach(function (r) { if (r.slug === slug) found = r; });
      return found;
    }).filter(function (r) { return r !== null; })
      .sort(function (a, b) { return a.rank - b.rank; });
  }
  function planInQueue(slug) { return plan.indexOf(slug) >= 0; }
  function togglePlan(slug) {
    var at = plan.indexOf(slug);
    if (at >= 0) {
      plan.splice(at, 1);
    } else {
      if (plan.length >= PLAN_MAX) plan.shift();
      plan.push(slug);
    }
    syncPlanHash();
    renderPlan();
    if (openSlug) openDetailKeep(openSlug);
  }
  function planShareUrl() {
    return window.location.href.split("#")[0] + "#plan=" + plan.join(",");
  }
  function syncPlanHash() {
    if (openSlug) return;
    var hash = plan.length ? "#plan=" + plan.join(",") : "";
    history.replaceState(null, "", window.location.pathname + window.location.search + hash);
  }
  function copyPlanLink() {
    var url = planShareUrl();
    var done = function () {
      $("plan-copy").textContent = "Link copied";
      setTimeout(function () { $("plan-copy").textContent = "Copy share link"; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { planLinkFallback(url, done); });
    } else {
      planLinkFallback(url, done);
    }
  }
  function planLinkFallback(url, done) {
    var box = document.createElement("textarea");
    box.value = url;
    document.body.appendChild(box);
    box.select();
    try { document.execCommand("copy"); } catch (e) { /* the link stays visible below */ }
    document.body.removeChild(box);
    done();
  }
  function planTop3() {
    plan = ROWS.slice().sort(function (a, b) { return a.rank - b.rank; })
      .slice(0, 3).map(function (r) { return r.slug; });
    syncPlanHash();
    renderPlan();
    $("plan-card").scrollIntoView({ behavior: "auto", block: "start" });
  }
  function renderPlan() {
    var picked = planRows();
    $("plan-count").textContent = picked.length ? picked.length + " of " + PLAN_MAX + " queued" : "nothing queued yet";
    if (!picked.length) {
      $("plan-body").innerHTML = '<p class="fine">Open any protocol and press “Add to farm plan”, or queue the top 3 below. ' +
        "The plan orders itself by implied value, so the first item is the one to farm first.</p>";
      return;
    }
    var totalCapital = 0;
    picked.forEach(function (r) { totalCapital += capitalTierOf(r); });
    var longestHold = Math.max.apply(null, picked.map(holdDaysOf));
    var totalImplied = 0;
    picked.forEach(function (r) { totalImplied += shownImplied(r); });
    var items = picked.map(function (r, i) {
      var steps = r.farm_steps || [];
      var weekly = steps.length > 2 ? steps[2] : "";
      return '<article class="plan-item"><header><span class="plan-step">' + (i + 1) + "</span>" +
        '<span class="plan-name">' + esc(r.name) + ' <span class="sub">#' + r.rank + " · " +
        esc(money(shownImplied(r))) + "</span></span>" +
        '<span class="plan-effort">' + esc(effortNote(r)) + "</span>" +
        '<button type="button" class="ghost plan-remove" data-slug="' + esc(r.slug) + '">Remove</button></header>' +
        '<ol class="farm plan-farm">' + steps.slice(0, 3).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
        (steps.length > 3 ? '<p class="fine">' + (steps.length - 3) + " more steps in the detail view — " +
          '<a href="#detail=' + esc(r.slug) + '" class="plan-open" data-slug="' + esc(r.slug) + '">open ' + esc(r.name) + "</a>.</p>" : "") +
        (weekly ? '<label class="plan-week"><input type="checkbox" class="plan-done"> This week: ' + esc(weekly) + "</label>" : "") +
        "</article>";
    }).join("");
    $("plan-body").innerHTML =
      '<p class="plan-total">Queue total: <strong>$' + totalCapital + ' capital</strong> · combined implied value ' +
      esc(money(totalImplied)) + " · about " + (picked.length * 10) + " min a week across " + picked.length +
      " protocol" + (picked.length === 1 ? "" : "s") + " · longest hold " + longestHold + " days.</p>" + items;
    Array.prototype.forEach.call($("plan-body").querySelectorAll(".plan-remove"), function (btn) {
      btn.addEventListener("click", function () { togglePlan(btn.getAttribute("data-slug")); });
    });
    Array.prototype.forEach.call($("plan-body").querySelectorAll(".plan-open"), function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        openDetail(a.getAttribute("data-slug"));
      });
    });
  }
  function bindPlan() {
    $("plan-top3").addEventListener("click", planTop3);
    $("plan-copy").addEventListener("click", copyPlanLink);
    $("plan-clear").addEventListener("click", function () {
      plan = [];
      syncPlanHash();
      renderPlan();
    });
  }

  /* ---------- detail ---------- */
  function renderLive() {
    $("live-body").innerHTML = LIVE.map(function (r) {
      return "<tr><td><span class=\"nm\">" + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        '<td><span class="chains">' + esc((r.chains || []).join(", ")) + "</span></td>" +
        '<td class="num">' + esc(money(r.tvl_usd)) + "</td>" +
        changeCell(r.change_7d) +
        '<td class="num"><strong>' + esc(money(r.mcap_usd)) + "</strong></td></tr>";
    }).join("");
  }
  function openDetail(slug) {
    var r = null;
    ROWS.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    openSlug = slug;
    var calc = impliedOf(r, sandboxOn() ? weights : BASE);
    var shown = sandboxOn() ? calc.value : r.implied_value_usd;
    var steps = r.farm_steps || [];
    var math = "TVL " + moneyFull(r.tvl_usd) + " × " + (sandboxOn() ? weights.base : BASE.base) +
      " × growth " + calc.growth.toFixed(4) + " × maturity " + calc.maturity.toFixed(4) +
      " × breadth " + calc.breadth.toFixed(3) + " = " + moneyFull(shown);
    $("detail-body").innerHTML =
      "<h3>" + esc(r.name) + ' <span class="tag">' + (r.watchlist ? "watchlist" : "early find") + "</span></h3>" +
      '<p class="meta-line">Rank ' + r.rank + " of " + ROWS.length + " · " + esc(r.category || "No category") +
      " · " + esc((r.chains || []).join(", ")) + " · listed " + esc(r.listed_at || "date unknown") +
      " · records no token in the snapshot.</p>" +
      '<div class="sig-row">' + signalHtml(r) + "</div>" +
      '<dl class="kv">' +
      "<div><dt>TVL</dt><dd>" + esc(moneyFull(r.tvl_usd)) + "</dd></div>" +
      "<div><dt>7-day change</dt><dd>" + esc(pct(r.change_7d)) + "</dd></div>" +
      "<div><dt>7-day flow</dt><dd>" + esc(flowMoney(r.flow_7d_usd || 0)) +
      "<small>TVL gained or lost in 7 days</small></dd></div>" +
      "<div><dt>Momentum</dt><dd>" + momentumOf(r) + " / 100<small>" + tierOf(r) + " tier</small></dd></div>" +
      "<div><dt>Age with no token</dt><dd>" + esc(r.age_days == null ? "—" : r.age_days + " days") +
      "<small>" + esc(r.listed_at ? "listed " + r.listed_at : "no listing date: 365 assumed") + "</small></dd></div>" +
      "<div><dt>Implied value</dt><dd>" + esc(moneyFull(shown)) +
      "<small>" + (sandboxOn() ? "sandbox weights" : "radar-3 weights") + "</small></dd></div>" +
      "</dl>" +
      '<p class="math">' + esc(math) + "</p>" +
      whyRankHtml(r) +
      comparablesHtml(r) +
      "<h4>How to farm it — six steps</h4>" +
      '<ol class="farm">' + steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      '<p class="fine">The plan is generic on purpose: the snapshot carries no points program, so each step ' +
      "says what to do, what it costs and how long it takes, and leaves the protocol's own pages as the " +
      "check before any funds move.</p>" +
      '<p><button type="button" id="detail-plan" class="plan-add">' +
      (planInQueue(r.slug) ? "Remove from farm plan" : "Add to farm plan") + "</button> " +
      '<button type="button" id="detail-close" class="ghost">Close detail</button></p>';
    $("detail").hidden = false;
    $("detail-close").addEventListener("click", closeDetail);
    $("detail-plan").addEventListener("click", function () { togglePlan(r.slug); });
    Array.prototype.forEach.call($("detail-body").querySelectorAll(".comp-mini tr[data-slug]"), function (tr) {
      tr.addEventListener("click", function () { openDetail(tr.getAttribute("data-slug")); });
    });
    if (window.location.hash !== "#detail=" + slug) history.replaceState(null, "", "#detail=" + slug);
    renderBoard();
    $("detail").scrollIntoView({ behavior: "auto", block: "start" });
  }
  function closeDetail() {
    openSlug = null;
    $("detail").hidden = true;
    $("detail-body").innerHTML = "";
    history.replaceState(null, "", window.location.pathname + window.location.search);
    renderBoard();
  }

  /* ---------- sandbox ---------- */
  function renderSandbox() {
    $("w-base-out").textContent = weights.base.toFixed(2);
    $("w-growth-out").textContent = weights.growth.toFixed(2);
    $("w-breadth-out").textContent = weights.breadth.toFixed(3);
    var tag = $("sandbox-tag");
    if (sandboxOn()) {
      tag.textContent = "sandbox weights — board re-ranked";
      tag.classList.add("live");
    } else {
      tag.textContent = "radar-3 defaults";
      tag.classList.remove("live");
    }
  }
  function sandboxChanged() {
    weights.base = parseFloat($("w-base").value);
    weights.growth = parseFloat($("w-growth").value);
    weights.breadth = parseFloat($("w-breadth").value);
    state.page = 0;
    renderSandbox();
    renderChart();
    renderBoard();
    if (openSlug) openDetailKeep(openSlug);
  }
  function openDetailKeep(slug) {
    var keep = document.documentElement.scrollTop;
    openDetail(slug);
    window.scrollTo(0, keep);
  }

  /* ---------- wiring ---------- */
  function readControls() {
    state.q = $("q").value;
    state.cat = $("f-cat").value;
    state.chain = $("f-chain").value;
    state.watch = $("f-watch").checked;
    state.growing = $("f-growing").checked;
    state.sort = $("f-sort").value;
    state.page = 0;
  }
  function bind() {
    ["q", "f-cat", "f-chain", "f-watch", "f-growing", "f-sort"].forEach(function (id) {
      $(id).addEventListener("input", function () { readControls(); renderBoard(); });
      $(id).addEventListener("change", function () { readControls(); renderBoard(); });
    });
    $("f-reset").addEventListener("click", function () {
      $("q").value = ""; $("f-cat").value = ""; $("f-chain").value = "";
      $("f-watch").checked = false; $("f-growing").checked = false; $("f-sort").value = "implied";
      readControls(); renderBoard();
    });
    $("pg-prev").addEventListener("click", function () { state.page -= 1; renderBoard(); });
    $("pg-next").addEventListener("click", function () { state.page += 1; renderBoard(); });
    $("cmp-top3").addEventListener("click", function () {
      compareTop3();
      $("compare-card").scrollIntoView({ behavior: "auto", block: "start" });
    });
    $("cmp-clear").addEventListener("click", function () {
      compare = [];
      renderBoard();
      renderCompare();
    });
    ["w-base", "w-growth", "w-breadth"].forEach(function (id) {
      $(id).addEventListener("input", sandboxChanged);
    });
    $("sandbox-reset").addEventListener("click", function () {
      weights = { base: BASE.base, growth: BASE.growth, breadth: BASE.breadth };
      $("w-base").value = BASE.base; $("w-growth").value = BASE.growth; $("w-breadth").value = BASE.breadth;
      state.page = 0;
      renderSandbox(); renderChart(); renderBoard();
      if (openSlug) openDetailKeep(openSlug);
    });
  }

  /* The compare view starts on the top 3 by implied value, so it is never empty. */
  compareTop3();
  renderStats();
  buildFilters();
  renderSandbox();
  renderChart();
  renderMovers();
  renderBoard();
  renderCompare();
  renderLive();
  renderPlan();
  bind();
  bindPlan();

  /* Deep links: #detail=<slug> opens one protocol, #growing=1 filters to growers,
     #compare=<slug>,<slug>,<slug> picks the comparison — and a compare link scrolls to it. */
  var hash = window.location.hash.slice(1);
  var params = {};
  hash.split("&").forEach(function (part) {
    var kv = part.split("=");
    if (kv.length === 2) params[kv[0]] = decodeURIComponent(kv[1]);
  });
  if (params.compare) {
    compare = params.compare.split(",").filter(function (slug) {
      return ROWS.some(function (r) { return r.slug === slug; });
    }).slice(0, 3);
    renderBoard();
    renderCompare();
  }
  if (params.growing) {
    state.growing = true;
    $("f-growing").checked = true;
    state.page = 0;
    renderBoard();
  }
  if (params.plan) {
    plan = params.plan.split(",").filter(function (slug) {
      return ROWS.some(function (r) { return r.slug === slug; });
    }).slice(0, PLAN_MAX);
    renderPlan();
  }
  if (params.plan) $("plan-card").scrollIntoView({ behavior: "auto", block: "start" });
  if (params.compare) $("compare-card").scrollIntoView({ behavior: "auto", block: "start" });
  var m = hash.match(/(?:^|&)detail=([\w-]+)/);
  if (m) openDetail(m[1]);
})();
