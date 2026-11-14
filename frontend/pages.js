"use strict";
/* Helios panels and pages:
   - the left panel's tabs (explore / calendar / export / saved)
   - the "meet the team" and "validation" pages, with a live MODIS-vs-VIIRS check for the chosen area */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------------------------------------------------------------- left panel tabs
  const tabs = $$(".rail-tabs [role=tab]"), panels = $$(".tab-panel");
  function showTab(name) {
    if (!panels.some((p) => p.dataset.panel === name)) name = "explore";
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
    $("#rail").scrollTop = 0;
    try { localStorage.setItem("firescout.tab", name); } catch { /* storage blocked */ }
  }
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $(".rail-tabs").addEventListener("keydown", (e) => {
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n === null) return;
    const t = tabs[(n + tabs.length) % tabs.length]; showTab(t.dataset.tab); t.focus();
  });
  // open the tab that holds an element (the guided tour uses this)
  function revealInTabs(el) {
    const p = el?.closest?.(".tab-panel");
    if (p && p.hidden) showTab(p.dataset.panel);
  }
  // a few small badges so people notice when a tab has something new
  addEventListener("firescout:calendar", () => $('[data-tab="calendar"]').classList.toggle("dot", !!state.calendarDays));
  showTab((() => { try { return localStorage.getItem("firescout.tab"); } catch { return null; } })() || "explore");
  window.FireTabs = { show: showTab, reveal: revealInTabs };

  // ---------------------------------------------------------------- team + validation pages
  let lastFocus = null;
  function open(m) { lastFocus = document.activeElement; m.hidden = false; m.querySelector("[data-close]")?.focus({ preventScroll: true }); if (m.id === "validation") live(); }
  function close(m) { m.hidden = true; lastFocus?.focus?.({ preventScroll: true }); }
  const team = $("#team"), val = $("#validation");
  $("#team-btn").addEventListener("click", () => open(team));
  $("#validation-btn").addEventListener("click", () => open(val));
  [team, val].forEach((m) => {
    m.querySelector("[data-close]").addEventListener("click", () => close(m));
    m.addEventListener("click", (e) => { if (e.target === m) close(m); });
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") [team, val].forEach((m) => { if (!m.hidden) close(m); }); });

  // live check: how well do MODIS and VIIRS agree in the area the user picked?
  function live() {
    const box = $("#val-live"), d = window.FireHistory?.data;
    if (!state.pin) { box.innerHTML = '<p class="note">pick a place on the map, then come back here to see how well the two satellites agree there.</p>'; return; }
    if (!d) { box.innerHTML = '<p class="note">the fire history for this area is still loading. open this page again in a moment.</p>'; return; }
    const m = d.method, r = m.r;
    const verdict = r == null ? "not enough overlapping months to judge." : r >= 0.8 ? "strong agreement: the harmonized record is reliable here." : r >= 0.5 ? "moderate agreement: trends are reliable, single months less so." : "weak agreement: treat pre-2012 values here with care.";
    box.innerHTML = "";
    const grid = document.createElement("div"); grid.className = "val-live-grid";
    [["months both satellites observed", m.overlap_months], ["correlation (r)", r == null ? "–" : r.toFixed(2)], ["conversion factor k", m.k.toFixed(2)],
      ["MODIS / VIIRS hotspots in overlap", `${m.overlap_modis_total.toLocaleString()} / ${m.overlap_viirs_total.toLocaleString()}`]]
      .forEach(([k, v]) => { const c = document.createElement("div"); c.innerHTML = "<b></b><span></span>"; c.firstChild.textContent = v; c.lastChild.textContent = k; grid.append(c); });
    const p = document.createElement("p"); p.className = "val-verdict"; p.dataset.level = r == null ? "" : r >= 0.8 ? "good" : r >= 0.5 ? "ok" : "weak";
    p.textContent = verdict;
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "link-btn"; btn.textContent = "see the scatter plot in the fire history →";
    btn.addEventListener("click", () => { close(val); window.FireHistory.open(); setTimeout(() => { const h = $("#h-method"); if (h) { h.open = true; h.scrollIntoView({ block: "center" }); } }, 300); });
    box.append(grid, p, btn);
  }
  addEventListener("firescout:history", () => { if (!val.hidden) live(); });
})();
