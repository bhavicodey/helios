"use strict";

(function () {
  const q = (s) => document.querySelector(s);
  const btns = { hot: q("#exp-hotspots"), monthly: q("#exp-monthly"), png: q("#exp-cal-png"), cal: q("#exp-cal-csv") };
  const note = q("#export-note");

  
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function toCSV(rows, cols) {
    return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
  }
  function download(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const csvBlob = (text) => new Blob([text], { type: "text/csv;charset=utf-8" });
  const tag = () => {
    const p = state.pin;
    return (state.poly ? `area_${p.lat.toFixed(2)}_${p.lon.toFixed(2)}` : `${p.lat.toFixed(2)}_${p.lon.toFixed(2)}_${state.radius}km`).replace(/-/g, "m");
  };
  const fromIn = q("#exp-from"), toIn = q("#exp-to");
  let rangeTouched = false;
  function defaultRange() {                                 
    if (rangeTouched) return;
    fromIn.value = iso(state.end - 6 * DAY); toIn.value = iso(state.end);
  }
  [fromIn, toIn].forEach((i) => { i.min = iso(FIRST.modis); i.max = iso(LATEST); i.addEventListener("change", () => { rangeTouched = true; }); });
  ["firescout:readout", "firescout:calendar"].forEach((ev) => addEventListener(ev, defaultRange));
  defaultRange();
  const say = (msg, kind = "") => { note.textContent = msg; note.dataset.kind = kind; };

  async function busy(btn, label, fn) {
    if (btn.disabled) return;
    const small = btn.querySelector("small"), old = small.textContent;
    btn.disabled = true; btn.classList.add("working"); small.textContent = label;
    try { await fn(); }
    catch (err) { say(err.message || String(err), "warn"); toast?.(`Export failed: ${err.message || err}`); }
    finally { btn.classList.remove("working"); small.textContent = old; sync(); }
  }

  
  function sync() {
    const pin = !!state.pin, cal = !!state.calendarDays;
    btns.hot.disabled = !pin; btns.monthly.disabled = !pin;
    btns.png.disabled = !cal; btns.cal.disabled = !cal;
    if (!pin) say("Pick a place to turn on downloads.");
    else if (!cal && note.dataset.kind !== "warn") say("Loading calendar…");
    else if (note.dataset.kind !== "warn" && note.dataset.kind !== "ok") say("");
  }
  ["firescout:pin", "firescout:calendar", "firescout:readout"].forEach((ev) => addEventListener(ev, () => { if (note.dataset.kind === "warn") note.dataset.kind = ""; sync(); }));

  
  btns.hot.addEventListener("click", () => busy(btns.hot, "fetching records…", async () => {
    let start = fromIn.value, end = toIn.value; const conf = q("#exp-conf").value;
    if (!start || !end) throw new Error("choose a from and to date first.");
    if (start > end) [start, end] = [end, start];
    if ((Date.parse(end) - Date.parse(start)) / DAY > 366) throw new Error("hotspot records cover up to 1 year at a time. shorten the range.");
    const r = await api("hotspots", { start, end, ...areaParams(), sensor: state.sensor, confidence: conf });
    const cols = ["date", "latitude", "longitude", "sensor", "product", "confidence", "confidence_class", "brightness_t21_k", "frp_mw"];
    const rows = r.records.map((x) => ({ ...x }));
    download(`helios_hotspots_${state.sensor}_${conf}_${tag()}_${start}_to_${end}.csv`, csvBlob(toCSV(rows, cols)));
    say(`${rows.length.toLocaleString()} hotspot records saved (${state.sensor.toUpperCase()}, ${conf} confidence, ${start} → ${end})${r.truncated ? ". Some days hit the 5,000-rows-per-month cap; shorten the range or shrink the area for the rest" : ""}.`, "ok");
  }));

  
  btns.monthly.addEventListener("click", () => busy(btns.monthly, "summarising months…", async () => {
    const months = q("#exp-months").value;
    const r = await api("monthly_summary", { end: iso(state.end), ...areaParams(), months });
    const cols = ["month", "sensor", "product", "grid_km", "days_in_month", "days_observed", "days_with_detections", "fire_pixel_days",
      "mean_daily_pixels", "max_daily_pixels", "peak_date", "active_day_share", "area", "note"];
    download(`helios_monthly_summary_${tag()}_${r.months[0]}_to_${r.months[r.months.length - 1]}.csv`, csvBlob(toCSV(r.rows, cols)));
    say(`Saved ${r.months.length} months.`, "ok");
  }));

  
  btns.cal.addEventListener("click", () => busy(btns.cal, "saving…", async () => {
    const c = state.calendarDays;
    const rows = c.days.map((d) => ({
      date: d.date, weekday: new Date(d.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      sensor: c.sensor.toUpperCase(), read_from: d.source || c.sensor.toUpperCase(), fire_pixels: d.count, raw_count: d.raw ?? d.count, scale_k: d.k ?? "", observations: d.observations ?? "",
      status: d.count === null || d.count === undefined ? "no observation" : d.count > 0 ? "detections" : "none detected",
      query_lat: state.pin.lat.toFixed(4), query_lon: state.pin.lon.toFixed(4), radius_km: state.poly ? "drawn polygon" : state.radius,
    }));
    const cols = ["date", "weekday", "sensor", "read_from", "fire_pixels", "raw_count", "scale_k", "observations", "status", "query_lat", "query_lon", "radius_km"];
    const ym = `${c.year}-${String(c.month).padStart(2, "0")}`;
    download(`helios_calendar_${c.sensor}_${ym}_${tag()}.csv`, csvBlob(toCSV(rows, cols)));
    say(`Saved ${ym}.`, "ok");
  }));

  
  const shades = () => ({ missing: "#eceef2", ...window.firescoutPrintPalette() });   
  const INK = "#161a26", MUTED = "#667085", LINE = "#e3e7ee";
  btns.png.addEventListener("click", () => busy(btns.png, "drawing…", async () => {
    await document.fonts?.ready;
    const c = state.calendarDays, SHADES = shades();
    const lead = new Date(Date.UTC(c.year, c.month - 1, 1)).getUTCDay();
    const W = 1200, H = 200 + Math.ceil((lead + c.days.length) / 7) * 112 + 170, S = 2, cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    const g = cv.getContext("2d"); g.scale(S, S);
    const serif = '"Fraunces", Georgia, serif', sans = '"Inter", system-ui, sans-serif';
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#e5391f"; g.fillRect(0, 0, W, 10);

    const monthName = new Date(Date.UTC(c.year, c.month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const where = q("#place")?.textContent && !/no place/.test(q("#place").textContent) ? q("#place").textContent : place(state.pin.lat, state.pin.lon);
    g.fillStyle = MUTED; g.font = `600 16px ${sans}`; g.fillText("BURNING ACTIVITY CALENDAR", 60, 64);
    g.fillStyle = INK; g.font = `700 44px ${serif}`; g.fillText(monthName, 60, 116);
    g.fillStyle = MUTED; g.font = `500 18px ${sans}`;
    g.fillText(`${where} · ${state.poly ? "inside a drawn area" : `within ${state.radius} km`} · ${c.sensor === "harmonized" ? "Harmonized MODIS + VIIRS" : c.sensor.toUpperCase()} daily detected fire pixels`, 60, 150);

    const max = Math.max(1, ...c.days.map((d) => d.count || 0));
    const offset = new Date(Date.UTC(c.year, c.month - 1, 1)).getUTCDay();
    const gx = 60, gy = 200, cw = 150, ch = 104, gap = 8;
    g.font = `600 15px ${sans}`; g.fillStyle = MUTED;
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].forEach((d, i) => g.fillText(d.toUpperCase(), gx + i * (cw + gap) + 4, gy - 14));
    const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
    let peak = null, active = 0, total = 0, observed = 0;
    c.days.forEach((d, i) => {
      const k = i + offset, x = gx + (k % 7) * (cw + gap), y = gy + Math.floor(k / 7) * (ch + gap);
      const has = d.count !== null && d.count !== undefined;
      const lvl = !has ? "missing" : !d.count ? 0 : Math.min(4, Math.max(1, Math.ceil(4 * d.count / max)));
      if (has) { observed++; total += d.count; if (d.count > 0) active++; if (!peak || d.count > peak.count) peak = d; }
      round(x, y, cw, ch, 12); g.fillStyle = SHADES[lvl]; g.fill();
      g.strokeStyle = d.date === iso(state.end) ? "#2457c5" : LINE; g.lineWidth = d.date === iso(state.end) ? 3 : 1; g.stroke();
      const n = parseInt(String(SHADES[lvl]).slice(1), 16), dark = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 140;
      g.fillStyle = dark ? "#fff" : INK; g.font = `700 22px ${serif}`; g.fillText(String(+d.date.slice(-2)), x + 14, y + 34);
      g.font = `600 16px ${sans}`; g.fillStyle = dark ? "#fff" : lvl === "missing" ? "#8a909b" : "#2b2f3a";
      g.fillText(!has ? "No data" : d.count ? `${(Number.isInteger(d.count) ? d.count : Math.round(d.count)).toLocaleString()} px${d.scaled ? " *" : ""}` : "0", x + 14, y + ch - 18);
    });

    const rowsUsed = Math.ceil((offset + c.days.length) / 7), ly = gy + rowsUsed * (ch + gap) + 30;
    g.font = `600 15px ${sans}`; g.fillStyle = MUTED; g.fillText("Fewer", gx, ly + 18);
    [0, 1, 2, 3, 4].forEach((l, i) => { round(gx + 60 + i * 40, ly, 32, 24, 6); g.fillStyle = SHADES[l]; g.fill(); g.strokeStyle = LINE; g.lineWidth = 1; g.stroke(); });
    g.fillStyle = MUTED; g.fillText("More detections", gx + 270, ly + 18);
    round(gx + 430, ly, 32, 24, 6); g.fillStyle = SHADES.missing; g.fill(); g.fillStyle = MUTED; g.fillText("No observation", gx + 472, ly + 18);

    g.fillStyle = INK; g.font = `700 18px ${sans}`;
    g.fillText(`${active} days with detections · ${total.toLocaleString()} fire-pixel days · peak ${peak && peak.count ? `${peak.count.toLocaleString()} on ${peak.date}` : "none"}`, gx, ly + 66);
    g.fillStyle = MUTED; g.font = `500 14px ${sans}`;
    g.fillText(`${observed} of ${c.days.length} days observed. Colours are relative to this month's busiest day. Counts are satellite fire pixels (~1 km), not individual fires or area burned.`, gx, ly + 94);
    g.fillText(`Source: ${c.sensor === "modis" ? "NASA FIRMS MODIS" : c.sensor === "viirs" ? "NASA VIIRS VNP14A1" : "NASA FIRMS MODIS + VIIRS VNP14A1, harmonized (* = MODIS × k)"} via Google Earth Engine · made with Helios on ${new Date().toISOString().slice(0, 10)}`, gx, ly + 116);

    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    const ym = `${c.year}-${String(c.month).padStart(2, "0")}`;
    download(`helios_calendar_${c.sensor}_${ym}_${tag()}.png`, blob);
    say(`Saved ${monthName}.`, "ok");
  }));

  sync();
})();
