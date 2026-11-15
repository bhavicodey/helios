"use strict";
// welcome screens
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const KEY = "firescout.profile";

  const body = document.body, intro = $("#intro");
  body.classList.add("intro-on");

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ } };

  // plain intro: no background effects, just smooth motion
  // (burst stays as a no-op so other files can still call FireIntro.burst safely)
  function burst() {}

  // steps
  const sSensor = $("#s-sensor"), sName = $("#s-name"), sWhy = $("#s-why");
  const nameIn = $("#w-name"), goBtn = $("#w-go");

  function go(next, focusEl) {
    const from = $(".step.active", intro);
    const show = () => { next.classList.add("active"); (focusEl || next.querySelector("input"))?.focus({ preventScroll: true }); };
    if (!from) return show();
    from.classList.remove("active"); from.classList.add("leaving");
    setTimeout(() => { from.classList.remove("leaving"); show(); }, reduce ? 0 : 340);
  }

  const saved = load();
  if (saved?.name) nameIn.value = saved.name;
  if (saved?.sensor) { const input = $(`input[name=welcome-sensor][value="${saved.sensor}"]`); if (input) input.checked = true; }
  go(sSensor, $("input[name=welcome-sensor]:checked"));
  sSensor.addEventListener("submit", (e) => {
    e.preventDefault();
    const sensor = $("input[name=welcome-sensor]:checked").value;
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: sensor }));
    go(sName, nameIn);
  });
  $("#w-sensor-back").addEventListener("click", () => go(sSensor, $("input[name=welcome-sensor]:checked")));

  sName.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = nameIn.value.trim();
    if (!n) { nameIn.classList.remove("shake"); void nameIn.offsetWidth; nameIn.classList.add("shake"); nameIn.focus(); return; }
    $("#w-hello").textContent = n;
    go(sWhy, $("input[name=why]", sWhy));
  });
  $("#w-back").addEventListener("click", () => go(sName, nameIn));

  $$("input[name=why]").forEach((r) => r.addEventListener("change", () => { goBtn.disabled = false; }));

  // "do you live in a wildfire-prone area?" -> yes / no / unsure
  sWhy.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pick = $("input[name=why]:checked");
    if (!pick) return;
    const profile = { sensor: $("input[name=welcome-sensor]:checked").value, name: nameIn.value.trim(), fireArea: pick.value };
    save(profile);
    const r = goBtn.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    await sleep(reduce ? 0 : 200);
    finish(profile, true);
  });

  // personalise + reveal
  // the welcome line follows the wildfire answer
  const LEDE = {
    yes: "enter your town to see its fire history.",
    unsure: "enter your town to see how often fires burn near you.",
    no: "pick a wildfire to explore, or click the map.",
  };
  function personalize(p) {
    $("#lede").textContent = `welcome, ${p.name}. ${LEDE[p.fireArea] || "click the map to start."}`;
    // suggest the LA fires as a first example (the tour also starts there)
    $$("#presets button").forEach((b, i) => b.classList.toggle("pick", i === 0));
  }

  async function finish(profile, showTour) {
    personalize(profile);
    intro.classList.add("leaving");
    await sleep(reduce ? 0 : 700);
    body.classList.remove("intro-on");           // panels float in
    await sleep(reduce ? 0 : 500);
    intro.hidden = true;
    if (showTour) { await sleep(reduce ? 0 : 600); window.FireTour?.start(); }
  }

  if (location.search.includes("skip")) {          // handy for testing: /?skip
    const p = saved?.name ? saved : { name: "friend", fireArea: "unsure" };
    $$(".step", intro).forEach((s) => s.classList.remove("active"));
    intro.hidden = true; body.classList.remove("intro-on"); personalize(p);
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: saved?.sensor || "modis" }));
  }

  // modals
  let lastFocus = null;
  function openModal(m) { lastFocus = document.activeElement; m.hidden = false; (m.querySelector(".cta, .x, input") || m).focus?.({ preventScroll: true }); }
  function closeModal(m) { m.hidden = true; lastFocus?.focus?.({ preventScroll: true }); }

  $("#help-btn").addEventListener("click", () => window.FireTour?.start());
  window.FireIntro = { burst };
})();