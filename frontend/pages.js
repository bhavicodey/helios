"use strict";
// left panel tabs
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // left panel tabs
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

})();
