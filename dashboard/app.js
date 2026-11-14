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
  function pct(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

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
    var cells = [
      [ROWS.length, "ranked pre-token"],
      [D.watchlist_size || 0, "on the watchlist"],
      [D.early_size || 0, "early finds below the floor"],
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
      body.innerHTML = '<tr><td colspan="9">Nothing matches these filters. Clear them to see the full board.</td></tr>';
    } else {
      body.innerHTML = slice.map(function (r, i) {
        var pos = start + i + 1;
        var shown = active ? pos : r.rank;
        var cls = r.slug === openSlug ? ' class="open"' : "";
        return "<tr data-slug=\"" + esc(r.slug) + "\"" + cls + ">" +
          '<td class="num">' + shown + "</td>" +
          '<td><span class="nm">' + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + "</span></td>" +
          "<td>" + esc(r.category || "—") + "</td>" +
          '<td><span class="chains">' + chainsShort(r) + "</span></td>" +
          '<td class="num">' + esc(money(r.tvl_usd)) + "</td>" +
          changeCell(r.change_7d) +
          '<td class="num">' + esc(r.age_days == null ? "—" : r.age_days + "d") + "</td>" +
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
      "<div><dt>Age with no token</dt><dd>" + esc(r.age_days == null ? "—" : r.age_days + " days") +
      "<small>" + esc(r.listed_at ? "listed " + r.listed_at : "no listing date: 365 assumed") + "</small></dd></div>" +
      "<div><dt>Implied value</dt><dd>" + esc(moneyFull(shown)) +
      "<small>" + (sandboxOn() ? "sandbox weights" : "radar-2 weights") + "</small></dd></div>" +
      "</dl>" +
      '<p class="math">' + esc(math) + "</p>" +
      "<h4>How to farm it — six steps</h4>" +
      '<ol class="farm">' + steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
      '<p class="fine">The plan is generic on purpose: the snapshot carries no points program, so each step ' +
      "says what to do, what it costs and how long it takes, and leaves the protocol's own pages as the " +
      "check before any funds move.</p>" +
      '<p><button type="button" id="detail-close" class="ghost">Close detail</button></p>';
    $("detail").hidden = false;
    $("detail-close").addEventListener("click", closeDetail);
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
      tag.textContent = "radar-2 defaults";
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

  renderStats();
  buildFilters();
  renderSandbox();
  renderChart();
  renderBoard();
  renderLive();
  bind();

  var m = window.location.hash.match(/^#detail=([\w-]+)$/);
  if (m) openDetail(m[1]);
})();
