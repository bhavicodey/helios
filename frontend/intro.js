"use strict";

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const KEY = "firescout.profile";

  const body = document.body, intro = $("#intro");
  body.classList.add("intro-on");

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {  } };

  
  
  function burst() {}

  
  const sSensor = $("#s-sensor"), goBtn = $("#w-go");

  const saved = load();
  if (saved?.sensor) { const input = $(`input[name=welcome-sensor][value="${saved.sensor}"]`); if (input) input.checked = true; }
  sSensor.classList.add("active");
  $("input[name=welcome-sensor]:checked")?.focus({ preventScroll: true });

  sSensor.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sensor = $("input[name=welcome-sensor]:checked").value;
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: sensor }));
    const profile = { sensor };
    save(profile);
    const r = goBtn.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    await sleep(reduce ? 0 : 200);
    finish(profile, true);
  });

  
  
  function personalize() {
    $("#lede").textContent = "welcome to Helios. enter a town, pick a wildfire, or click the map.";
    
    $$("#presets button").forEach((b, i) => b.classList.toggle("pick", i === 0));
  }

  async function finish(profile, showTour) {
    personalize(profile);
    intro.classList.add("leaving");
    await sleep(reduce ? 0 : 700);
    body.classList.remove("intro-on");           
    await sleep(reduce ? 0 : 500);
    intro.hidden = true;
    if (showTour) { await sleep(reduce ? 0 : 600); window.FireTour?.start(); }
  }

  if (location.search.includes("skip")) {          
    $$(".step", intro).forEach((s) => s.classList.remove("active"));
    intro.hidden = true; body.classList.remove("intro-on"); personalize();
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: saved?.sensor || "modis" }));
  }

  
  let lastFocus = null;
  function openModal(m) { lastFocus = document.activeElement; m.hidden = false; (m.querySelector(".cta, .x, input") || m).focus?.({ preventScroll: true }); }
  function closeModal(m) { m.hidden = true; lastFocus?.focus?.({ preventScroll: true }); }

  $("#help-btn").addEventListener("click", () => window.FireTour?.start());
  window.FireIntro = { burst };
})();