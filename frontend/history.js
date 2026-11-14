"use strict";
/* Helios fire history: the harmonized MODIS + VIIRS record for the chosen area since Nov 2000.
   - loads /api/history whenever the area changes (cached on the server for a day)
   - fills the "this month vs its history" card in the readout
   - gives the daily calendar its MODIS -> VIIRS scaling factor (k)
   - draws the dashboard: years x months calendar, seasonal pattern, yearly totals + trend, harmonization check
   Loaded after app.js and shares its globals (state, api, areaParams, setDate, iso, fmt, place, toast). */
(function () {
  const q = (s, r = document) => r.querySelector(s);
  const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DIVERGE = ["#2c7bb6", "#abd9e9", "#f4f4f2", "#fdae61", "#d7191c"];   // below usual ... above usual (colour-blind friendly; used in white exported images)
  const DIVERGE_DARK = ["#3E73A8", "#2C4258", "#2A2426", "#B4363A", "#FF5A5D"];   // same idea for the dark screen
  const modal = q("#history"), NS = "http://www.w3.org/2000/svg";
  let data = null, token = 0, loading = false, lastFocus = null;

  const compact = (v) => v == null ? "" : v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
  const ymOf = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const pct = (v) => v == null ? "–" : `${v > 0 ? "+" : ""}${Math.round(v)}%`;
  // percentile: how many of the past years' same month this month beats (always 0–100%)
  function addPercentiles(rows) {
    for (const r of rows) {
      const others = rows.filter((o) => o.mon === r.mon && o.year !== r.year && o.harmonized != null).map((o) => o.harmonized);
      if (r.harmonized == null || others.length < 3) { r.percentile = null; continue; }
      const below = others.filter((v) => v < r.harmonized).length + 0.5 * others.filter((v) => v === r.harmonized).length;
      r.percentile = Math.round(100 * below / others.length);
    }
  }
  const standing = (p, name) => p == null ? "–" : p >= 50 ? `busier than ${p}% of past ${name}s` : `quieter than ${100 - p}% of past ${name}s`;
  const ordinal = (n) => n === 1 ? "" : n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th") + " ";

  // ---------------------------------------------------------------- loading
  async function load() {
    if (!state.pin) return;
    const t = ++token; loading = true; data = null;
    setButtons(); renderAnomaly();
    q("#h-loading").hidden = false; q("#h-body").hidden = true;
    q("#h-loading").textContent = "reading 25 years of satellite hotspots… the first load for a new area can take a minute.";
    try {
      const r = await api("history", { ...areaParams(), current: ymOf(state.end) });
      if (t !== token) return;
      data = r; addPercentiles(data.rows); loading = false;
      window.dispatchEvent(new CustomEvent("firescout:history"));
      if (!modal.hidden) render();
    } catch (err) {
      if (t !== token) return;
      loading = false;
      q("#h-loading").textContent = `couldn't load the history: ${err.message}`;
    }
    setButtons(); renderAnomaly();
  }
  let loadTimer;
  addEventListener("firescout:area", () => { clearTimeout(loadTimer); token++; data = null; renderAnomaly(); setButtons(); loadTimer = setTimeout(load, 600); });
  ["firescout:readout", "firescout:calendar"].forEach((ev) => addEventListener(ev, renderAnomaly));

  function setButtons() {
    const on = !!state.pin;
    ["#history-open", "#history-open-rail"].forEach((s) => { const b = q(s); b.disabled = !on; b.classList.toggle("is-loading", on && loading); });
    q("#history-open").textContent = loading ? "loading fire history…" : "open fire history";
  }

  // ---------------------------------------------------------------- the k used for a given month (calendar harmonization)
  function k(month) {
    if (!data) return null;
    const s = data.method.seasonal_k?.[String(month)];
    return s ?? data.method.k;
  }
  window.FireHistory = { k, get data() { return data; }, open, load };

  // ---------------------------------------------------------------- readout card: this month vs its history
  function rowFor(ym) { return data?.rows.find((r) => r.month === ym); }
  function renderAnomaly() {
    const box = q("#anomaly");
    if (!state.pin) { box.hidden = true; return; }
    box.hidden = false;
    if (!data) { box.dataset.level = ""; q("#anom-big").textContent = loading ? "loading…" : "–"; q("#anom-sub").textContent = "comparing this month with every year since 2000."; return; }
    const ym = ymOf(state.end), r = rowFor(ym), name = MONTH_LONG[+ym.slice(5) - 1];
    if (!r || r.harmonized == null) { box.dataset.level = ""; q("#anom-big").textContent = "no data"; q("#anom-sub").textContent = `no hotspot record for ${name} ${ym.slice(0, 4)} yet.`; return; }
    const n = data.rows.filter((x) => x.mon === r.mon && x.harmonized != null).length;
    const a = r.percentile, level = judge(r), tiny = a != null && !meaningful(r);
    const soFar = ym === ymOf(LATEST) ? " so far" : "";
    box.dataset.level = level;
    q(".anom-label").textContent = `whole month: ${name} ${r.year}${soFar} vs past ${name}s`;
    q("#anom-big").textContent = a == null ? compact(r.harmonized) + " hotspots"
      : tiny ? `about usual for ${name}` : standing(a, name);
    const critical = data.stats.critical_months.includes(r.mon) ? ` ${name} is one of this area's critical fire months.` : "";
    q("#anom-sub").textContent = `${compact(r.harmonized)} hotspot pixel-days in ${name} ${r.year}${soFar}; a usual ${name} has ${compact(r.baseline_median)}. `
      + (tiny ? "both numbers are very small, so the difference isn't meaningful." : (r.rank_in_month ? `${ordinal(r.rank_in_month)}highest of ${n} ${name}s on record.` : "") + critical);
    syncBanner(r, level, name, soFar);
  }

  // A month only counts as unusual when there is real fire activity behind the percentage:
  // at least 20 hotspot pixel-days on one side and a gap of 10 or more. (13 vs a usual 4 is noise, not a fire season.)
  function meaningful(r) {
    const h = r.harmonized ?? 0, b = r.baseline_median ?? 0;
    return Math.max(h, b) >= 20 && Math.abs(h - b) >= 10;
  }
  function judge(r) {
    const a = r.percentile;
    if (a == null) return "";
    if (!meaningful(r)) return "normal";
    return a >= 90 ? "high" : a >= 70 ? "up" : a <= 25 ? "down" : "normal";
  }

  // keep the 7-day banner and the whole-month card telling one story
  function syncBanner(r, level, name, soFar) {
    const sig = q("#signal"), ins = state.readout?.ins;
    if (!ins) return;
    if (ins.signal === "none" && (level === "high" || level === "up")) {
      sig.dataset.level = "watch"; sig.classList.add("seen");
      sig.textContent = `quiet in the last 7 days, but ${name}${soFar} is ${standing(r.percentile, name)}.`;
    } else {
      sig.dataset.level = ins.signal;
      sig.textContent = ins.signal_reason;
    }
  }

  // ---------------------------------------------------------------- dashboard
  function open() {
    if (!state.pin) return;
    lastFocus = document.activeElement;
    modal.hidden = false; q("#history-x").focus({ preventScroll: true });
    q("#h-sub").textContent = `${state.poly ? `your drawn shape near ${place(state.pin.lat, state.pin.lon)}` : `${place(state.pin.lat, state.pin.lon)} · within ${state.radius} km`} · hotspot pixel-days, VIIRS-equivalent`;
    if (data) render(); else { q("#h-loading").hidden = false; q("#h-body").hidden = true; if (!loading) load(); }
  }
  function close() { if (modal.hidden) return; modal.hidden = true; lastFocus?.focus?.({ preventScroll: true }); }
  q("#history-open").addEventListener("click", open);
  q("#history-open-rail").addEventListener("click", open);
  q("#history-x").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });

  function render() {
    q("#h-loading").hidden = true; q("#h-body").hidden = false;
    const years = [...new Set(data.rows.map((r) => r.year))];
    const from = q("#h-from"), to = q("#h-to");
    if (!from.options.length || from.dataset.span !== `${years[0]}-${years.at(-1)}`) {
      from.replaceChildren(...years.map((y) => new Option(y, y))); to.replaceChildren(...years.map((y) => new Option(y, y)));
      from.value = years[0]; to.value = years.at(-1); from.dataset.span = `${years[0]}-${years.at(-1)}`;
    }
    tiles(); grid(); season(); annual(); method();
  }
  ["#h-from", "#h-to", "#h-view"].forEach((s) => q(s).addEventListener("change", () => { if (data) grid(); }));
  addEventListener("firescout:palette", () => { if (data && !modal.hidden) { grid(); season(); annual(); } });

  // ---- headline tiles
  function tiles() {
    const s = data.stats, box = q("#h-tiles");
    const cur = s.current, name = cur ? MONTH_LONG[cur.mon - 1] : "";
    const items = [
      ["hotspots since 2000", compact(s.total), "harmonized pixel-days"],
      ["worst year", s.peak_year ? String(s.peak_year.year) : "–", s.peak_year ? `${compact(s.peak_year.total)} hotspots` : "no complete year yet"],
      ["critical months", s.critical_months.length ? s.critical_months.map((m) => MON[m - 1]).join(" · ") : "–", "highest median activity"],
      ["long-term trend", s.trend_pct_per_decade == null ? "–" : `${s.trend_pct_per_decade > 0 ? "+" : ""}${s.trend_pct_per_decade}% / decade`, "across complete years"],
      [`${name || "this month"} vs past years`, cur && cur.percentile != null ? `busier than ${cur.percentile}%` : "–", cur && cur.rank_in_month ? `${ordinal(cur.rank_in_month)}highest ${name} on record` : "needs 3+ years of history"],
    ];
    box.replaceChildren(...items.map(([label, big, sub], i) => {
      const d = document.createElement("div"); d.className = "h-tile";
      if (i === 4 && cur?.percentile != null) d.dataset.level = judge(cur);
      if (i === 4 && cur?.percentile != null && !meaningful(cur)) { big = "about usual"; sub = "activity is very low either way"; }
      d.innerHTML = "<span></span><b></b><small></small>";
      d.children[0].textContent = label; d.children[1].textContent = big; d.children[2].textContent = sub;
      return d;
    }));
  }

  // ---- years x months calendar
  function levels(rows) {
    const vals = rows.map((r) => r.harmonized).filter((v) => v != null && v > 0).sort((a, b) => a - b);
    const qv = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0;
    return [qv(.25), qv(.5), qv(.75)];
  }
  function levelOf(v, th) { return v == null ? -1 : v <= 0 ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4; }
  function anomLevel(r) {
    const a = r.percentile;
    if (a == null) return -1;
    if (!meaningful(r)) return 2;                 // tiny counts: shown as "about usual"
    return a <= 10 ? 0 : a <= 35 ? 1 : a < 65 ? 2 : a < 90 ? 3 : 4;
  }
  function textOn(hex) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 < 140 ? "#fff" : "#161a26"; }

  function grid() {
    const from = +q("#h-from").value, to = +q("#h-to").value, view = q("#h-view").value;
    const [y0, y1] = from <= to ? [from, to] : [to, from];
    const rows = data.rows.filter((r) => r.year >= y0 && r.year <= y1);
    const th = levels(data.rows), pal = window.firescoutPalette(), crit = new Set(data.stats.critical_months);
    const box = q("#h-grid"); box.replaceChildren();
    const head = document.createElement("div"); head.className = "h-row h-head";
    head.append(Object.assign(document.createElement("span"), { textContent: "" }));
    MON.forEach((m, i) => { const s = document.createElement("span"); s.textContent = m; if (crit.has(i + 1)) s.className = "crit"; head.append(s); });
    head.append(Object.assign(document.createElement("span"), { textContent: "year" }));
    box.append(head);
    const annualMax = Math.max(1, ...data.annual.map((a) => a.total || 0));
    for (let y = y1; y >= y0; y--) {
      const row = document.createElement("div"); row.className = "h-row";
      row.append(Object.assign(document.createElement("span"), { className: "h-year", textContent: y }));
      for (let m = 1; m <= 12; m++) {
        const r = rows.find((x) => x.year === y && x.mon === m);
        const c = document.createElement("button"); c.type = "button"; c.className = "h-cell";
        if (crit.has(m)) c.classList.add("crit");
        if (!r) { c.disabled = true; c.classList.add("none"); row.append(c); continue; }
        const lv = view === "anomaly" ? anomLevel(r) : levelOf(r.harmonized, th);
        const col = lv < 0 ? null : view === "anomaly" ? DIVERGE_DARK[lv] : pal[lv];
        if (col) { c.style.background = col; c.style.color = textOn(col); } else c.classList.add("missing");
        c.textContent = view === "anomaly" ? (r.percentile == null ? "" : meaningful(r) ? `${r.percentile}%` : "≈") : compact(r.harmonized);
        if (r.source === "MODIS x k") c.classList.add("from-modis");
        if (r.month === ymOf(state.end)) c.classList.add("chosen");
        c.title = `${MONTH_LONG[m - 1]} ${y}: ${r.harmonized == null ? "no observations" : `${r.harmonized.toLocaleString()} hotspot pixel-days`}`
          + (r.source ? ` · ${r.source === "VIIRS" ? "VIIRS" : `MODIS ${r.modis} × k ${r.k_used}`}` : "")
          + (r.baseline_median != null ? ` · usual ${MONTH_LONG[m - 1]}: ${r.baseline_median} · busier than ${r.percentile ?? "–"}% of past ${MONTH_LONG[m - 1]}s)` : "");
        c.setAttribute("aria-label", c.title);
        c.addEventListener("click", () => {
          const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
          setDate(Date.UTC(y, m - 1, Math.min(15, last))); close();
          toast(`jumped to ${MONTH_LONG[m - 1]} ${y}.`);
        });
        row.append(c);
      }
      const a = data.annual.find((x) => x.year === y);
      const tot = document.createElement("span"); tot.className = "h-total";
      tot.innerHTML = "<i></i><b></b>";
      tot.firstChild.style.width = `${a?.total ? Math.max(4, a.total / annualMax * 100) : 0}%`;
      tot.lastChild.textContent = a?.total == null ? "–" : compact(a.total) + (a.complete ? "" : "*");
      row.append(tot);
      box.append(row);
    }
    // legend
    const lg = q("#h-legend"); lg.replaceChildren();
    const sw = (c, label) => { const s = document.createElement("span"); s.innerHTML = "<i></i>"; s.firstChild.style.background = c; s.append(label); return s; };
    if (view === "anomaly") {
      ["quieter than 90% of past years", "quieter than usual", "about usual (≈ = too few hotspots)", "busier than usual", "busier than 90% of past years"].forEach((l, i) => lg.append(sw(DIVERGE_DARK[i], l)));
    } else {
      lg.append(sw(pal[0], "none"), sw(pal[1], `≤ ${compact(th[0])}`), sw(pal[2], `≤ ${compact(th[1])}`), sw(pal[3], `≤ ${compact(th[2])}`), sw(pal[4], `> ${compact(th[2])}`));
    }
    const mo = document.createElement("span"); mo.className = "lg-modis"; mo.innerHTML = "<i></i>before 2012: MODIS × k"; lg.append(mo);
    const st = document.createElement("span"); st.textContent = "* year not complete"; lg.append(st);
  }

  // ---- small svg helpers
  function svg(w, h) { const s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", `0 0 ${w} ${h}`); s.setAttribute("role", "img"); return s; }
  function el(name, attrs, parent) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.append(e); return e; }
  function text(parent, x, y, t, attrs = {}) { const e = el("text", { x, y, ...attrs }, parent); e.textContent = t; return e; }
  function quant(xs, p) { const s = xs.slice().sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); }

  // ---- seasonal pattern
  function season() {
    const W = 520, H = 230, L = 46, R = 12, T = 12, B = 28, s = svg(W, H);
    const pal = window.firescoutPalette();
    const cy = new Date(state.end).getUTCFullYear();
    q("#h-season-year").textContent = String(cy);
    const stats = MON.map((_, i) => {
      const v = data.rows.filter((r) => r.mon === i + 1 && r.harmonized != null && r.year !== cy).map((r) => r.harmonized);
      return { lo: quant(v, .25), med: quant(v, .5), hi: quant(v, .75) };
    });
    const curr = MON.map((_, i) => data.rows.find((r) => r.year === cy && r.mon === i + 1)?.harmonized ?? null);
    const max = Math.max(1, ...stats.map((x) => x.hi || 0), ...curr.map((v) => v || 0)) * 1.1;
    const x = (i) => L + i * (W - L - R) / 11, y = (v) => H - B - v / max * (H - T - B);
    for (let g = 0; g <= 4; g++) { const v = max * g / 4; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, s); text(s, L - 6, y(v) + 4, compact(v), { class: "ax", "text-anchor": "end" }); }
    MON.forEach((m, i) => text(s, x(i), H - 8, m, { class: "ax" + (data.stats.critical_months.includes(i + 1) ? " crit" : ""), "text-anchor": "middle" }));
    const band = stats.map((t, i) => `${x(i)},${y(t.hi ?? 0)}`).concat(stats.slice().reverse().map((t, j) => `${x(11 - j)},${y(t.lo ?? 0)}`));
    el("polygon", { points: band.join(" "), class: "band" }, s);
    el("polyline", { points: stats.map((t, i) => `${x(i)},${y(t.med ?? 0)}`).join(" "), class: "med" }, s);
    const seg = curr.map((v, i) => v == null ? null : `${x(i)},${y(v)}`).filter(Boolean);
    if (seg.length) el("polyline", { points: seg.join(" "), class: "cur", stroke: pal[4] }, s);
    curr.forEach((v, i) => { if (v != null) el("circle", { cx: x(i), cy: y(v), r: 3.5, class: "cur-dot", fill: pal[4] }, s); });
    q("#h-season").replaceChildren(s);
  }

  // ---- yearly totals + trend
  function annual() {
    const W = 520, H = 230, L = 46, R = 12, T = 12, B = 28, s = svg(W, H), pal = window.firescoutPalette();
    const a = data.annual, max = Math.max(1, ...a.map((x) => x.total || 0)) * 1.1;
    const bw = (W - L - R) / a.length, y = (v) => H - B - v / max * (H - T - B);
    for (let g = 0; g <= 4; g++) { const v = max * g / 4; el("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }, s); text(s, L - 6, y(v) + 4, compact(v), { class: "ax", "text-anchor": "end" }); }
    a.forEach((d, i) => {
      if (d.total != null) {
        const r = el("rect", { x: L + i * bw + 1.5, y: y(d.total), width: Math.max(1, bw - 3), height: H - B - y(d.total), rx: 2, fill: pal[3], class: d.complete ? "" : "partial" }, s);
        el("title", {}, r).textContent = `${d.year}: ${d.total.toLocaleString()}${d.complete ? "" : " (year not complete)"}`;
      }
      if (i % Math.ceil(a.length / 9) === 0 || i === a.length - 1) text(s, L + i * bw + bw / 2, H - 8, `'${String(d.year).slice(2)}`, { class: "ax", "text-anchor": "middle" });
    });
    const t = data.stats.trend_per_year, comp = a.filter((d) => d.complete && d.total != null);
    if (t != null && comp.length >= 2) {
      const mx = comp.reduce((s_, d) => s_ + d.year, 0) / comp.length, my = comp.reduce((s_, d) => s_ + d.total, 0) / comp.length;
      const idx = (yr) => a.findIndex((d) => d.year === yr);
      const fy = (yr) => my + t * (yr - mx);
      el("line", { x1: L + idx(comp[0].year) * bw + bw / 2, y1: y(Math.max(0, fy(comp[0].year))), x2: L + idx(comp.at(-1).year) * bw + bw / 2, y2: y(Math.max(0, fy(comp.at(-1).year))), class: "trend" }, s);
    }
    q("#h-annual").replaceChildren(s);
    const st = data.stats;
    q("#h-annual-note").textContent = `dashed line: trend across complete years${st.trend_pct_per_decade == null ? " (needs 5+ complete years)" : `, ${st.trend_pct_per_decade > 0 ? "+" : ""}${st.trend_pct_per_decade}% per decade`}. pale bars are years not yet complete.`;
  }

  // ---- harmonization check: MODIS vs VIIRS in the months both flew
  function method() {
    const m = data.method, pts = data.overlap_points, W = 360, H = 260, L = 46, R = 12, T = 12, B = 34, s = svg(W, H);
    const mx = Math.max(1, ...pts.map((p) => p[0])) * 1.05, my = Math.max(1, ...pts.map((p) => p[1])) * 1.05;
    const x = (v) => L + v / mx * (W - L - R), y = (v) => H - B - v / my * (H - T - B);
    el("line", { x1: L, y1: H - B, x2: W - R, y2: H - B, class: "axis" }, s); el("line", { x1: L, y1: T, x2: L, y2: H - B, class: "axis" }, s);
    text(s, (W + L) / 2, H - 6, "MODIS pixel-days per month", { class: "ax", "text-anchor": "middle" });
    const yl = text(s, 12, (H - B) / 2, "VIIRS", { class: "ax", "text-anchor": "middle" }); yl.setAttribute("transform", `rotate(-90 12 ${(H - B) / 2})`);
    pts.forEach(([a, b, mo]) => { const c = el("circle", { cx: x(a), cy: y(b), r: 3, class: "pt" }, s); el("title", {}, c).textContent = `${mo}: MODIS ${a}, VIIRS ${b}`; });
    const xe = Math.min(mx, my / (m.k || 1));
    el("line", { x1: x(0), y1: y(0), x2: x(xe), y2: y(xe * m.k), class: "fit" }, s);
    q("#h-scatter").replaceChildren(s);
    const seasonal = Object.entries(m.seasonal_k || {});
    q("#h-method-text").innerHTML = "";
    const add = (tag, t) => { const e = document.createElement(tag); e.textContent = t; q("#h-method-text").append(e); return e; };
    add("p", `in the ${m.overlap_months} months when both satellites watched this area, VIIRS saw ${m.overlap_viirs_total.toLocaleString()} hotspot pixel-days and MODIS saw ${m.overlap_modis_total.toLocaleString()}.`);
    add("p", `so here one MODIS hotspot is worth about k = ${m.k} VIIRS hotspots (the solid line). ${m.r == null ? "" : `the two records move together with a correlation of r = ${m.r}${m.r >= .8 ? ", which is strong" : m.r >= .5 ? ", which is moderate" : ", which is weak, so treat pre-2012 values with care"}.`}`);
    if (seasonal.length) add("p", `months with enough overlap get their own k: ${seasonal.map(([mm, v]) => `${MON[mm - 1]} ${v}`).join(" · ")}.`);
    add("p", "the harmonized record uses VIIRS wherever it exists (from January 2012) and MODIS × k before that, so the whole series is in VIIRS-equivalent units and the sensor of origin no longer matters for comparing years.");
  }

  // ---------------------------------------------------------------- downloads
  const cell = (v) => { if (v == null) return ""; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = (rows, cols) => "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
  function save(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const areaTag = () => state.poly ? `area_${state.pin.lat.toFixed(2)}_${state.pin.lon.toFixed(2)}`.replace(/-/g, "m") : `${state.pin.lat.toFixed(2)}_${state.pin.lon.toFixed(2)}_${state.radius}km`.replace(/-/g, "m");
  const areaText = () => state.poly ? `drawn polygon (${state.poly.map((p) => p.map((v) => v.toFixed(4)).join(" ")).join("; ")})` : `${state.pin.lat.toFixed(4)}, ${state.pin.lon.toFixed(4)} ± ${state.radius} km`;

  q("#h-csv").addEventListener("click", () => {
    const rows = data.rows.map((r) => ({ ...r, area: areaText(), k_global: data.method.k }));
    save(`helios_harmonized_monthly_${areaTag()}.csv`, new Blob([csv(rows, ["month", "modis", "viirs", "k_used", "harmonized", "source", "baseline_median", "percentile", "rank_in_month", "k_global", "area"])], { type: "text/csv" }));
  });
  q("#h-annual-csv").addEventListener("click", () => {
    const t = data.stats.trend_per_year, comp = data.annual.filter((a) => a.complete && a.total != null);
    const mx = comp.reduce((s, d) => s + d.year, 0) / (comp.length || 1), my = comp.reduce((s, d) => s + d.total, 0) / (comp.length || 1);
    const rows = data.annual.map((a) => ({ ...a, trend_fit: t == null ? "" : Math.round((my + t * (a.year - mx)) * 10) / 10, area: areaText() }));
    save(`helios_yearly_totals_${areaTag()}.csv`, new Blob([csv(rows, ["year", "total", "complete", "trend_fit", "area"])], { type: "text/csv" }));
  });
  q("#h-png").addEventListener("click", async () => {
    await document.fonts?.ready;
    const from = Math.min(+q("#h-from").value, +q("#h-to").value), to = Math.max(+q("#h-from").value, +q("#h-to").value);
    const view = q("#h-view").value, pal = window.firescoutPrintPalette(), th = levels(data.rows);
    const years = []; for (let y = to; y >= from; y--) years.push(y);
    const cw = 74, ch = 30, gx = 90, gy = 170, W = gx + 12 * cw + 130, H = gy + years.length * ch + 120, S = 2;
    const cv = document.createElement("canvas"); cv.width = W * S; cv.height = H * S;
    const g = cv.getContext("2d"); g.scale(S, S);
    const serif = '"Fraunces", Georgia, serif', sans = '"Inter", system-ui, sans-serif';
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.fillStyle = "#e5391f"; g.fillRect(0, 0, W, 8);
    g.fillStyle = "#667085"; g.font = `600 15px ${sans}`; g.fillText("BURNING ACTIVITY CALENDAR · HARMONIZED MODIS + VIIRS", 40, 50);
    g.fillStyle = "#161a26"; g.font = `700 36px ${serif}`; g.fillText(`${from}–${to}, month by month`, 40, 94);
    g.fillStyle = "#667085"; g.font = `500 16px ${sans}`;
    g.fillText(`${state.poly ? `drawn area near ${place(state.pin.lat, state.pin.lon)}` : `${place(state.pin.lat, state.pin.lon)} · within ${state.radius} km`} · ${view === "anomaly" ? "change vs the usual for each month" : "hotspot pixel-days (VIIRS-equivalent)"}`, 40, 124);
    g.font = `600 14px ${sans}`;
    MON.forEach((m, i) => { g.fillStyle = data.stats.critical_months.includes(i + 1) ? "#c42b14" : "#667085"; g.fillText(m.toUpperCase(), gx + i * cw + 8, gy - 12); });
    g.fillStyle = "#667085"; g.fillText("YEAR", gx + 12 * cw + 14, gy - 12);
    years.forEach((y, j) => {
      g.fillStyle = "#161a26"; g.font = `700 15px ${sans}`; g.fillText(String(y), 40, gy + j * ch + 20);
      for (let m = 1; m <= 12; m++) {
        const r = data.rows.find((x) => x.year === y && x.mon === m), X = gx + (m - 1) * cw, Y = gy + j * ch;
        if (!r) continue;
        const lv = view === "anomaly" ? anomLevel(r) : levelOf(r.harmonized, th);
        const col = lv < 0 ? "#eceef2" : view === "anomaly" ? DIVERGE[lv] : pal[lv];
        g.fillStyle = col; g.beginPath(); g.roundRect ? g.roundRect(X + 2, Y + 2, cw - 4, ch - 4, 5) : g.rect(X + 2, Y + 2, cw - 4, ch - 4); g.fill();
        g.fillStyle = lv < 0 ? "#8a909b" : textOn(col); g.font = `600 12px ${sans}`;
        g.fillText(view === "anomaly" ? (r.percentile == null ? "" : meaningful(r) ? `${r.percentile}%` : "≈") : (r.harmonized == null ? "–" : compact(r.harmonized)), X + 10, Y + 19);
      }
      const a = data.annual.find((x) => x.year === y);
      g.fillStyle = "#161a26"; g.font = `700 13px ${sans}`; g.fillText(a?.total == null ? "–" : compact(a.total) + (a.complete ? "" : "*"), gx + 12 * cw + 14, gy + j * ch + 20);
    });
    const ly = gy + years.length * ch + 36;
    g.fillStyle = "#667085"; g.font = `500 13px ${sans}`;
    g.fillText(`harmonization: VIIRS from Jan 2012; before that MODIS × k (k = ${data.method.k}${data.method.r == null ? "" : `, r = ${data.method.r}`}, ${data.method.overlap_months} overlap months). red month names = critical fire months. * = year not complete.`, 40, ly);
    g.fillText(`sources: NASA FIRMS MODIS + NASA VIIRS VNP14A1 via Google Earth Engine · made with Helios on ${new Date().toISOString().slice(0, 10)}`, 40, ly + 22);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    save(`helios_history_calendar_${view}_${from}-${to}_${areaTag()}.png`, blob);
  });

  setButtons();
})();
