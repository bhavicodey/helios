"use strict";

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  
  const tabs = $$(".rail-tabs [role=tab]"), panels = $$(".tab-panel");
  function showTab(name) {
    if (!panels.some((p) => p.dataset.panel === name)) name = "explore";
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
    $("#rail").scrollTop = 0;
    try { localStorage.setItem("firescout.tab", name); } catch {  }
  }
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $(".rail-tabs").addEventListener("keydown", (e) => {
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n === null) return;
    const t = tabs[(n + tabs.length) % tabs.length]; showTab(t.dataset.tab); t.focus();
  });
  
  function revealInTabs(el) {
    const p = el?.closest?.(".tab-panel");
    if (p && p.hidden) showTab(p.dataset.panel);
  }
  
  addEventListener("firescout:calendar", () => $('[data-tab="calendar"]').classList.toggle("dot", !!state.calendarDays));
  showTab((() => { try { return localStorage.getItem("firescout.tab"); } catch { return null; } })() || "explore");
  window.FireTabs = { show: showTab, reveal: revealInTabs };

  const about = $("#about");
  $("#about-btn").addEventListener("click", () => { about.hidden = false; about.querySelector("[data-close]").focus({ preventScroll: true }); });
  about.querySelector("[data-close]").addEventListener("click", () => { about.hidden = true; });
  about.addEventListener("click", (e) => { if (e.target === about) about.hidden = true; });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !about.hidden) about.hidden = true; });

})();
