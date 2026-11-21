// Token Radar, model radar-2. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan, and the live-token set the multiples are priced from.
// No network: every byte it shows is in data.js. Farm plans are shown exactly as data.js carries
// them, the same strings board.json carries; implied value is recomputed in the page from the
// snapshot figures and the carried category multiple, so the page and the board are visibly the
// same arithmetic.
(function () {
  "use strict";

  const dataset = window.RADAR;
  if (!dataset) return;
  const mount = document.getElementById("board");
  const view = { q: "", category: "all", chain: "all", watchlistOnly: false, tab: "pre-token", sort: "implied", dir: -1, selected: null };
  const watchSet = {};
  (dataset.watchlist || []).forEach(function (slug) { watchSet[slug] = true; });

  const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return usdFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return "unknown";
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return Math.max(0, Math.round(days)) + "d";
  }
  function multLabel(n) {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    return n.toFixed(2) + "x";
  }
  // The model in one function, in the same order as the program that wrote board.json: TVL times
  // the category multiple, times growth, times maturity, times chain breadth.
  function recompute(row, model) {
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    const growthMult = 1 + (growth / 100) * model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const chainCount = row.chains && row.chains.length ? row.chains.length : 0;
    const breadth = 1 + Math.min(chainCount, model.breadth_max_chains) * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth));
  }

  function h(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        const value = attrs[key];
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      const child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function loadHash() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get("q")) view.q = params.get("q");
    if (params.get("p")) view.selected = params.get("p");
    if (params.get("category")) view.category = params.get("category");
    if (params.get("chain")) view.chain = params.get("chain");
    if (params.get("wl") === "1") view.watchlistOnly = true;
  }
  function saveHash() {
    const params = new URLSearchParams();
    if (view.q) params.set("q", view.q);
    if (view.category !== "all") params.set("category", view.category);
    if (view.chain !== "all") params.set("chain", view.chain);
    if (view.watchlistOnly) params.set("wl", "1");
    if (view.selected) params.set("p", view.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, "", "#" + next);
    else window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  function visibleRows() {
    const q = view.q.trim().toLowerCase();
    return dataset.rows.filter(function (row) {
      if (view.category !== "all" && (row.category || "Other") !== view.category) return false;
      if (view.chain !== "all" && !(row.chains || []).some(function (c) { return c === view.chain; })) return false;
      if (view.watchlistOnly && !watchSet[row.slug]) return false;
      if (!q) return true;
      const hay = [row.name, row.slug, row.category, (row.chains || []).join(" ")].join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function orderedRows(list) {
    const key = view.sort;
    return list.slice().sort(function (a, b) {
      let av, bv;
      if (key === "name") { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === "tvl") { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === "growth") { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === "age") { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === "chains") { av = a.chains ? a.chains.length : 0; bv = b.chains ? b.chains.length : 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function medianValue() {
    const vals = dataset.rows.map(function (row) { return row.implied_value_usd; }).sort(function (a, b) { return a - b; });
    if (!vals.length) return 0;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
  }
  function totalValue() {
    return dataset.rows.reduce(function (sum, row) { return sum + row.implied_value_usd; }, 0);
  }

  function pageHeader() {
    return h("header", { class: "top" },
      h("div", { class: "brand" }, h("span", { class: "mark" }), h("span", { class: "brand-name", text: "Token Radar" })),
      h("div", { class: "top-meta" },
        h("span", { text: "Snapshot " + dataset.as_of }),
        h("span", { text: "DefiLlama protocol index" }),
        h("span", { text: dataset.model_version + " model" })
      )
    );
  }

  function intro() {
    return h("section", { class: "lede" },
      h("div", null,
        h("h1", { text: dataset.watchlist_size + " watchlist protocols, ranked by implied value" }),
        h("p", { text: "The watchlist is the floor: every protocol with at least $" + Math.round(dataset.floor_usd / 1e6) + "M of TVL and no token on record. The early radar adds " + dataset.early_size + " pre-token protocols below that floor. Each category is priced from the live-token protocols in the same snapshot, so implied value is the market's own pricing applied to protocols that have no token yet. Implied value is a model, not a promise." })
      ),
      h("div", { class: "facts" },
        h("div", { class: "fact" }, h("span", { text: "Watchlist covered" }), h("b", { text: dataset.watchlist_size + " / " + dataset.watchlist_size })),
        h("div", { class: "fact" }, h("span", { text: "Pre-token rows scored" }), h("b", { text: String(dataset.board_size) })),
        h("div", { class: "fact" }, h("span", { text: "Early rows below the floor" }), h("b", { text: String(dataset.early_size) })),
        h("div", { class: "fact" }, h("span", { text: "Live-token protocols set aside" }), h("b", { text: String(dataset.live_size) })),
        h("div", { class: "fact" }, h("span", { text: "Total implied value" }), h("b", { text: money(totalValue()) })),
        h("div", { class: "fact" }, h("span", { text: "Median implied value" }), h("b", { text: money(medianValue()) }))
      )
    );
  }

  function filterBar() {
    const categories = Array.from(new Set(dataset.rows.map(function (row) { return row.category || "Other"; }))).sort();
    const chains = Array.from(new Set(dataset.rows.reduce(function (all, row) { return all.concat(row.chains || []); }, []))).sort();
    const search = h("input", { type: "search", id: "q", placeholder: "Search name, category or chain", value: view.q, "aria-label": "Search the board" });
    search.addEventListener("input", function () { view.q = search.value; saveHash(); draw(); });
    const select = h("select", { id: "category", "aria-label": "Filter by category" },
      h("option", { value: "all", text: "All categories" }),
      categories.map(function (c) { return h("option", { value: c, text: c, selected: c === view.category ? "selected" : null }); })
    );
    select.addEventListener("change", function () { view.category = select.value; saveHash(); draw(); });
    const chainSelect = h("select", { id: "chain", "aria-label": "Filter by chain" },
      h("option", { value: "all", text: "All chains" }),
      chains.map(function (c) { return h("option", { value: c, text: c, selected: c === view.chain ? "selected" : null }); })
    );
    chainSelect.addEventListener("change", function () { view.chain = chainSelect.value; saveHash(); draw(); });
    const wl = h("input", { type: "checkbox", id: "wl", checked: view.watchlistOnly ? "checked" : null });
    wl.addEventListener("change", function () { view.watchlistOnly = wl.checked; saveHash(); draw(); });
    const pre = h("button", { type: "button", "aria-pressed": view.tab === "pre-token" ? "true" : "false", text: "Pre-token", onclick: function () { view.tab = "pre-token"; draw(); } });
    const live = h("button", { type: "button", "aria-pressed": view.tab === "live" ? "true" : "false", text: "Live token", onclick: function () { view.tab = "live"; draw(); } });
    return h("div", { class: "controls" },
      h("div", { class: "field" }, h("label", { for: "q", text: "Search" }), search),
      h("div", { class: "field" }, h("label", { for: "category", text: "Category" }), select),
      h("div", { class: "field" }, h("label", { for: "chain", text: "Chain" }), chainSelect),
      h("label", { class: "toggle", for: "wl" }, wl, "Watchlist only"),
      h("div", { class: "field" }, h("span", { class: "sub", text: "Token status" }), h("div", { class: "tabs" }, pre, live)),
      h("span", { class: "count", text: view.tab === "pre-token" ? visibleRows().length + " rows shown" : dataset.live.length + " live-token protocols" })
    );
  }

  function sortButton(key, label) {
    return h("th", { scope: "col" },
      h("button", { type: "button", onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } draw(); } },
        label,
        view.sort === key ? h("span", { "aria-hidden": "true", text: view.dir < 0 ? " v" : " ^" }) : null
      )
    );
  }

  function preTokenTable() {
    const list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h("div", { class: "panel" }, h("div", { class: "empty" },
        h("h2", { text: "No protocol matches that filter" }),
        h("p", { text: "Clear the search or pick another category or chain to see the board again." }),
        h("button", { class: "button primary", type: "button", text: "Clear filters", onclick: function () { view.q = ""; view.category = "all"; view.chain = "all"; view.watchlistOnly = false; saveHash(); draw(); } })
      ));
    }
    const peak = list.reduce(function (m, row) { return Math.max(m, row.implied_value_usd); }, 1);
    const tbody = h("tbody");
    list.forEach(function (row) {
      const growth = row.change_7d === null ? "n/a" : pct(row.change_7d);
      const growthClass = row.change_7d === null ? "" : row.change_7d >= 0 ? "pos" : "neg";
      const chains = row.chains && row.chains.length ? row.chains.slice(0, 2).join(", ") : "an unnamed chain";
      const tr = h("tr", {
        "data-selected": view.selected === row.slug ? "true" : "false",
        tabindex: "0",
        onclick: function () { showDetail(row.slug); },
        onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showDetail(row.slug); } }
      },
        h("td", { class: "num", text: String(row.rank) }),
        h("td", null, h("div", { class: "name" },
          h("b", { text: row.name }),
          h("span", { class: "sub", text: (row.category || "Other") + " on " + chains }),
          watchSet[row.slug] ? h("span", { class: "watch", text: "Watchlist" }) : null
        )),
        h("td", { class: "num", text: money(row.tvl_usd) }),
        h("td", { class: "num " + growthClass, text: growth }),
        h("td", { class: "num", text: ageLabel(row.age_days) }),
        h("td", { class: "num", text: String(row.chains ? row.chains.length : 0) }),
        h("td", null, h("div", { class: "implied" },
          h("div", { class: "bar", "aria-hidden": "true" }, h("i", { style: "width:" + Math.max(3, Math.round((row.implied_value_usd / peak) * 100)) + "%" })),
          h("span", { class: "num", text: money(row.implied_value_usd) })
        )),
        h("td", null, h("span", { class: "status", text: "no token" }))
      );
      tbody.appendChild(tr);
    });
    return h("div", { class: "panel" },
      h("div", { class: "table-wrap" },
        h("table", null,
          h("caption", { class: "sub", text: "Pre-token protocols, strongest implied value first. Select a row for its model and farm plan." }),
          h("thead", null, h("tr", null,
            sortButton("implied", "Rank"),
            sortButton("name", "Protocol"),
            sortButton("tvl", "TVL"),
            sortButton("growth", "7d"),
            sortButton("age", "Age"),
            sortButton("chains", "Chains"),
            sortButton("implied", "Implied value"),
            h("th", { scope: "col", text: "Token" })
          )),
          tbody
        )
      )
    );
  }

  function liveTokenTable() {
    const tbody = h("tbody");
    dataset.live.forEach(function (row) {
      tbody.appendChild(h("tr", null,
        h("td", { class: "num", text: "live" }),
        h("td", null, h("div", { class: "name" }, h("b", { text: row.name }), h("span", { class: "sub", text: (row.category || "Other") + " on " + (row.chains && row.chains.length ? row.chains.slice(0, 2).join(", ") : "an unnamed chain") }))),
        h("td", { class: "num", text: money(row.tvl_usd) }),
        h("td", { class: "num " + (row.change_7d !== null && row.change_7d >= 0 ? "pos" : "neg"), text: pct(row.change_7d) }),
        h("td", { class: "num", text: money(row.mcap_usd) }),
        h("td", { class: "num", text: multLabel(row.mcap_tvl_ratio) }),
        h("td", null, h("span", { class: "status", text: "already trades" }))
      ));
    });
    return h("div", { class: "panel" },
      h("div", { class: "table-wrap" },
        h("table", null,
          h("caption", { class: "sub", text: "Token live: these protocols already trade, so their market cap is a fact, not a model. Their market-cap to TVL ratios price the categories in the pre-token ranking. They are set aside from that ranking." }),
          h("thead", null, h("tr", null, h("th", { scope: "col", text: "Status" }), h("th", { scope: "col", text: "Protocol" }), h("th", { scope: "col", text: "TVL" }), h("th", { scope: "col", text: "7d" }), h("th", { scope: "col", text: "Market cap" }), h("th", { scope: "col", text: "Mcap / TVL" }), h("th", { scope: "col", text: "Token" }))),
          tbody
        )
      )
    );
  }

  function modelSection() {
    const m = dataset.model;
    const entries = Object.keys(dataset.category_multiples || {}).map(function (c) {
      return { category: c, multiple: dataset.category_multiples[c], count: (dataset.category_multiple_counts || {})[c] || 0 };
    }).sort(function (a, b) { return b.multiple - a.multiple || (a.category < b.category ? -1 : 1); });
    const multRows = entries.map(function (e) {
      return h("tr", null, h("td", { text: e.category }), h("td", { class: "num", text: multLabel(e.multiple) }), h("td", { class: "num", text: String(e.count) }));
    });
    return h("section", { class: "panel model" },
      h("h2", { text: "How implied value is computed" }),
      h("p", { class: "sub", text: "Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The category multiple is computed from this snapshot at run time, never written by hand." }),
      h("div", { class: "formula" },
        "implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, " + m.growth_floor + ", " + m.growth_cap + ") / 100 x " + m.growth_weight + ") x (" + m.maturity_floor + " + min(age_days, " + m.maturity_days + ") / " + m.maturity_days + " x " + m.maturity_range + ") x (1 + min(chains, " + m.breadth_max_chains + ") x " + m.breadth_per_chain + ") )"
      ),
      h("p", { class: "sub", text: "TVL, seven-day growth, chains and listing date come from the snapshot. Age is the time since the protocol was first listed; an unlisted age uses " + m.unknown_age_days + " days. Seven-day growth is capped, so one hot week cannot carry a row on its own. Chain breadth rewards protocols whose TVL sits on more than one chain, up to " + m.breadth_max_chains + " chains." }),
      h("h3", { text: "Category multiples, from the live market in this snapshot" }),
      h("p", { class: "sub", text: "Each multiple is the median market-cap to TVL ratio of the live-token protocols in that category, clamped to " + m.category_multiple_min + "x-" + m.category_multiple_max + "x. A category with fewer than " + m.category_multiple_min_live + " live protocols uses the fallback of " + m.category_multiple_fallback + "x. Exchange tokens are left out." }),
      h("table", { class: "multiples" },
        h("thead", null, h("tr", null, h("th", { scope: "col", text: "Category" }), h("th", { scope: "col", text: "Multiple" }), h("th", { scope: "col", text: "Live protocols" }))),
        h("tbody", null, multRows)
      )
    );
  }

  const detailDialog = h("dialog", { class: "detail", id: "detail", "aria-labelledby": "detail-title" });
  detailDialog.addEventListener("close", function () { view.selected = null; saveHash(); });

  function showDetail(slug) {
    const row = dataset.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    saveHash();
    detailDialog.textContent = "";
    const steps = row.farm_steps || [];
    const recomputed = recompute(row, dataset.model);
    detailDialog.appendChild(h("div", { class: "detail-head" },
      h("div", null,
        h("span", { class: "brand-name", text: "Rank " + row.rank + " of " + dataset.board_size + (watchSet[row.slug] ? " - Watchlist" : " - Early radar") }),
        h("h2", { id: "detail-title", text: row.name }),
        h("p", { class: "sub", text: (row.category || "Other") + " on " + (row.chains && row.chains.length ? row.chains.join(", ") : "an unnamed chain") })
      ),
      h("button", { class: "close", type: "button", "aria-label": "Close details", text: "Close", onclick: function () { detailDialog.close(); } })
    ));
    detailDialog.appendChild(h("section", { class: "detail-section" },
      h("h3", { text: "Implied value" }),
      h("div", { class: "equation" },
        h("div", null, h("span", { text: "TVL" }), h("b", { class: "num", text: money(row.tvl_usd) })),
        h("div", null, h("span", { text: "Category multiple" }), h("b", { class: "num", text: multLabel(row.category_multiple) })),
        h("div", null, h("span", { text: "Seven-day growth" }), h("b", { class: "num", text: pct(row.change_7d) })),
        h("div", null, h("span", { text: "Age with no token" }), h("b", { class: "num", text: ageLabel(row.age_days) })),
        h("div", null, h("span", { text: "Growth multiplier" }), h("b", { class: "num", text: String(row.growth_multiplier) })),
        h("div", null, h("span", { text: "Maturity multiplier" }), h("b", { class: "num", text: String(row.maturity_multiplier) })),
        h("div", null, h("span", { text: "Breadth multiplier" }), h("b", { class: "num", text: String(row.breadth_multiplier) + " (" + (row.chains ? row.chains.length : 0) + " chains)" })),
        h("div", null, h("span", { text: "Implied value" }), h("b", { class: "num", text: money(row.implied_value_usd) }))
      ),
      h("p", { class: "sub", text: "Model " + dataset.model_version + ": the same function scores every protocol. The page recomputes this row as " + money(recomputed) + (recomputed === row.implied_value_usd ? ", the same number board.json carries." : ", which differs from the board: the data would be stale.") + " This is an estimate, not a price." })
    ));
    detailDialog.appendChild(h("section", { class: "detail-section" },
      h("h3", { text: "Farm plan" }),
      h("p", { class: "sub", text: "The same plan board.json carries for this protocol." }),
      h("ol", { class: "steps" }, steps.map(function (s) {
        const at = s.indexOf(" Cost: ");
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : "";
        return h("li", null, h("b", { text: action }), h("span", { class: "cost", text: tail }));
      }))
    ));
    if (typeof detailDialog.showModal === "function") {
      if (!detailDialog.open) detailDialog.showModal();
    } else {
      detailDialog.setAttribute("open", "");
    }
  }

  function draw() {
    mount.textContent = "";
    const shell = h("div", { class: "shell" });
    shell.appendChild(pageHeader());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === "pre-token" ? preTokenTable() : liveTokenTable());
    if (view.tab === "pre-token") shell.appendChild(modelSection());
    mount.appendChild(shell);
    mount.setAttribute("aria-busy", "false");
    if (!detailDialog.isConnected) mount.appendChild(detailDialog);
    if (view.selected) showDetail(view.selected);
  }

  loadHash();
  draw();
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && detailDialog.open) detailDialog.close();
  });
})();
