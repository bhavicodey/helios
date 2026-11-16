"use strict";

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const coach = $("#coach"), hole = $(".coach-hole", coach), card = $(".coach-card", coach);
  const blocks = Object.fromEntries($$(".coach-block", coach).map((b) => [b.dataset.side, b]));
  const title = $("#coach-title"), text = $("#coach-text"), todo = $("#coach-todo"), stepLbl = $("#coach-step");
  const nextBtn = $("#coach-next"), backBtn = $("#coach-back"), dotsBox = $(".coach-dots", coach);
  const sensorName = () => ($(".sensor-switch button[aria-pressed=true]")?.dataset.sensor || "modis").toUpperCase();
  const snap = () => window.firescout?.snapshot?.() || {};

  
  const STEPS = [
    {
      target: () => { const d = $("#sat-dock"); return d && d.offsetParent !== null ? d : $("#rail .sensor-section"); },
      title: "Two satellites",
      body: () => "MODIS (since 2000) and VIIRS (since 2012). Click one for its 3D model.",
      pad: 6,
    },
    {
      target: () => $("#rail .sensor-section"),
      title: "Choose your data",
      body: () => `You chose ${sensorName() === "HARMONIZED" ? "harmonized: both satellites combined" : sensorName()}. Click MODIS or VIIRS to see just one.`,
    },
    {
      target: () => $("#area-section"),
      title: "Choose a place",
      body: () => "Type a town, or draw an area on the map.",
    },
    {
      target: () => $("#presets"),
      title: "Try a big wildfire",
      body: () => "Pick a wildfire.",
      todo: "Pick a wildfire to continue",
      wait: (done) => {
        $$("#presets button").forEach((b) => {
          const fire = b.dataset.fire === "1";
          b.disabled = !fire; b.classList.toggle("tour-off", !fire);
          if (fire) b.addEventListener("click", onPick, { once: true });
        });
        function onPick() { cleanup(); setTimeout(done, reduce ? 200 : 2600); }   
        function cleanup() { $$("#presets button").forEach((b) => { b.disabled = false; b.classList.remove("tour-off"); b.removeEventListener("click", onPick); }); }
        return cleanup;
      },
    },
    {
      target: () => $("#readout"),
      title: "Read the numbers",
      body: () => "Fires, sulfur dioxide and burned area in the circle, for the last 7 days.",
      todo: "Loading…",
      soft: (ready) => {
        const ok = () => { const s = snap(); return s.pin && !s.loading && (s.ins || s.series?.length); };
        if (ok()) { ready(); return () => {}; }
        const h = () => ok() && ready();
        addEventListener("firescout:readout", h);
        const t = setTimeout(ready, 9000);                         
        return () => { removeEventListener("firescout:readout", h); clearTimeout(t); };
      },
    },
    {
      target: () => $("#h-calendar").closest("section"),
      title: "Daily calendar",
      body: () => "Each square is a day. Brighter = more fire.",
    },
    {
      target: () => $("#history-open"),
      title: "25-year history",
      body: () => "Every month since 2000. Close it to continue.",
      todo: "Click “open fire history”",
      pad: 10,
      wait: (done) => {
        const h = $("#history");
        let opened = false;
        const mo = new MutationObserver(() => {
          if (!h.hidden && !opened) opened = true;
          else if (h.hidden && opened) { mo.disconnect(); done(); }
        });
        mo.observe(h, { attributes: true, attributeFilter: ["hidden"] });
        return () => mo.disconnect();
      },
    },
    {
      target: () => $("#h-layers").closest("section"),
      title: "Map layers",
      body: () => "Turn layers on or off. Change the area size with the radius slider.",
    },
    {
      target: () => $("#timeline"),
      title: "Change the date",
      body: () => "Press play or pick a date.",
    },
    {
      target: () => $("#render-open"),
      title: "Fire render",
      body: () => "Hover over the fire to see the data. Close it to continue.",
      todo: "Click “open fire render”",
      pad: 10,
      wait: (done) => {
        const render = $("#render");
        let opened = false;
        const mo = new MutationObserver(() => {
          if (!render.hidden && !opened) opened = true;
          else if (render.hidden && opened) { mo.disconnect(); done(); }
        });
        mo.observe(render, { attributes: true, attributeFilter: ["hidden"] });
        return () => mo.disconnect();
      },
    },
    {
      target: () => $("#export-section"),
      title: "Download your data",
      body: () => "Download the data as CSV files or an image.",
    },
    {
      target: null,
      title: "You're ready",
      body: () => "Try your own places. Replay this tour with “tour”.",
      final: true,
    },
  ];

  let i = -1, target = null, cleanup = null, raf = 0, active = false, ready = true;

  
  dotsBox.replaceChildren(...STEPS.map(() => document.createElement("i")));

  
  const modals = $$(".modal");
  const syncAway = () => coach.classList.toggle("away", modals.some((m) => !m.hidden));
  const modalWatch = new MutationObserver(syncAway);
  modals.forEach((m) => modalWatch.observe(m, { attributes: true, attributeFilter: ["hidden"] }));

  
  function reveal(el) {
    window.FireTabs?.reveal(el);                     
    const panel = el?.closest(".panel");
    if (panel?.classList.contains("collapsed")) panel.querySelector(".panel-toggle")?.click();
    if (el && el !== panel) el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }

  
  function frame() {
    if (!active) return;
    const W = innerWidth, H = innerHeight;
    let r;
    if (target && target.isConnected) {
      const b = target.getBoundingClientRect(), pad = STEPS[i].pad ?? 8;
      
      const clip = target.closest(".panel")?.getBoundingClientRect();
      let top = b.top - pad, bottom = b.bottom + pad, left = b.left - pad, right = b.right + pad;
      if (clip && target !== target.closest(".panel")) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      r = { top: Math.max(0, top), left: Math.max(0, left), right: Math.min(W, right), bottom: Math.min(H, bottom) };
    } else {
      r = { top: H / 2, left: W / 2, right: W / 2, bottom: H / 2 };
    }
    Object.assign(hole.style, { top: r.top + "px", left: r.left + "px", width: Math.max(0, r.right - r.left) + "px", height: Math.max(0, r.bottom - r.top) + "px" });
    hole.classList.toggle("none", !target);
    Object.assign(blocks.top.style, { top: 0, left: 0, width: W + "px", height: r.top + "px" });
    Object.assign(blocks.bottom.style, { top: r.bottom + "px", left: 0, width: W + "px", height: Math.max(0, H - r.bottom) + "px" });
    Object.assign(blocks.left.style, { top: r.top + "px", left: 0, width: r.left + "px", height: Math.max(0, r.bottom - r.top) + "px" });
    Object.assign(blocks.right.style, { top: r.top + "px", left: r.right + "px", width: Math.max(0, W - r.right) + "px", height: Math.max(0, r.bottom - r.top) + "px" });

    
    const cw = card.offsetWidth, chh = card.offsetHeight, m = 18;
    let x, y;
    if (!target) { x = (W - cw) / 2; y = (H - chh) / 2; }
    else if (r.right + m + cw <= W - 8) { x = r.right + m; y = r.top; }
    else if (r.left - m - cw >= 8) { x = r.left - m - cw; y = r.top; }
    else if (r.bottom + m + chh <= H - 8) { x = r.left; y = r.bottom + m; }
    else if (r.top - m - chh >= 8) { x = r.left; y = r.top - m - chh; }
    else { x = (W - cw) / 2; y = H - chh - 12; }
    x = Math.max(8, Math.min(W - cw - 8, x)); y = Math.max(8, Math.min(H - chh - 8, y));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    raf = requestAnimationFrame(frame);
  }

  
  function go(n) {
    cleanup?.(); cleanup = null;
    i = n; const s = STEPS[i];
    target = s.target ? s.target() : null;
    if (target) reveal(target);
    stepLbl.textContent = s.final ? "Tour complete" : `Step ${i + 1} of ${STEPS.length - 1}`;
    $("#coach-skip").hidden = !!s.final;
    title.textContent = s.title; text.textContent = s.body();
    [...dotsBox.children].forEach((d, k) => d.className = k < i ? "done" : k === i ? "on" : "");
    backBtn.hidden = i === 0 || s.final || !!STEPS[i - 1]?.wait;          
    nextBtn.querySelector("span").textContent = s.final ? "Start exploring" : "Next";
    card.classList.remove("swap"); void card.offsetWidth; card.classList.add("swap");

    if (s.wait) {
      ready = false; nextBtn.hidden = true; todo.hidden = false; todo.textContent = s.todo;
      card.classList.add("waiting");
      cleanup = s.wait(() => { cleanup = null; go(i + 1); });
    } else if (s.soft) {
      ready = false; nextBtn.hidden = false; nextBtn.disabled = true; todo.hidden = false; todo.textContent = s.todo;
      card.classList.remove("waiting");
      cleanup = s.soft(() => { ready = true; nextBtn.disabled = false; todo.hidden = true; });
    } else {
      ready = true; nextBtn.hidden = false; nextBtn.disabled = false; todo.hidden = true;
      card.classList.remove("waiting");
    }
    card.focus({ preventScroll: true });
  }

  function start() {
    if (active) return;
    window.FireCAD?.close?.();
    active = true; coach.hidden = false; document.body.classList.add("touring");
    requestAnimationFrame(() => coach.classList.add("show"));
    go(0); raf = requestAnimationFrame(frame);
  }
  function finish() {
    cleanup?.(); cleanup = null;
    active = false; cancelAnimationFrame(raf);
    coach.classList.remove("show"); document.body.classList.remove("touring");
    const r = nextBtn.getBoundingClientRect();
    window.FireIntro?.burst?.(r.left + r.width / 2, r.top);
    setTimeout(() => { if (!active) coach.hidden = true; }, reduce ? 0 : 350);
  }

  nextBtn.addEventListener("click", () => { if (!ready) return; STEPS[i].final ? finish() : go(i + 1); });
  backBtn.addEventListener("click", () => { if (i > 0) go(i - 1); });
  
  function skip() {
    if (!active) return;
    finish();
    window.toast?.("Tour skipped. Replay it any time from “Tour”.");
  }
  $("#coach-skip").addEventListener("click", skip);

  
  $$(".coach-block", coach).forEach((b) => b.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    card.classList.remove("nudge"); void card.offsetWidth; card.classList.add("nudge");
  }));
  
  addEventListener("keydown", (e) => {
    if (!active || coach.classList.contains("away")) return;
    if (e.key === "Escape") { e.preventDefault(); skip(); return; }
    if (e.key === "Tab") {
      const allowed = [...$$("button:not([hidden]):not(:disabled)", card), ...(target ? $$("button:not(:disabled), input, select, [tabindex='0']", target) : [])]
        .filter((el) => el.offsetParent !== null);
      if (target && target.matches("button")) allowed.push(target);
      if (!allowed.length) return;
      const k = allowed.indexOf(document.activeElement);
      if (k === -1 || (e.shiftKey ? k === 0 : k === allowed.length - 1)) { e.preventDefault(); allowed[e.shiftKey ? allowed.length - 1 : 0].focus(); }
    }
  }, true);

  window.FireTour = { start, finish, get active() { return active; } };
})();
