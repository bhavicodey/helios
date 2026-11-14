"use strict";
/* Helios CAD viewer.
   "make bigger" on a satellite card (intro) or "view satellite CAD" (left panel) opens a large viewer.
   The CADs are turntable renders, so dragging sideways scrubs the video = spins the model.
   Scroll / pinch / +/- zoom toward the cursor, double-click resets, full screen fills the display. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const CADS = {
    modis: {
      src: "media/cad-modis.mp4", title: "MODIS",
      blurb: "MODIS (Moderate Resolution Imaging Spectroradiometer) flies on NASA's Terra and Aqua satellites. Its thermal bands spot the heat of active fires, and its record goes back to 2000, which makes it the go-to sensor for long-term fire history.",
      facts: [["satellites", "Terra (1999) · Aqua (2002)"], ["spectral bands", "36"], ["fire pixel size", "~1 km"], ["record in Helios", "Nov 2000 → today"], ["best for", "long-term trends"]],
    },
    viirs: {
      src: "media/cad-viirs.mp4", title: "VIIRS",
      blurb: "VIIRS (Visible Infrared Imaging Radiometer Suite) flies on Suomi NPP and the NOAA-20/21 satellites. It sees smaller and cooler fires than MODIS, so it is the sharper choice for recent fire seasons.",
      facts: [["satellites", "Suomi NPP (2011) · NOAA-20 · NOAA-21"], ["spectral bands", "22"], ["fire pixel size", "375 m – 1 km"], ["record in Helios", "Jan 2012 → today"], ["best for", "recent, detailed fires"]],
    },
  };

  const modal = $("#cad"), video = $("#cad-video"), stage = $("#cad-stage");
  const scrub = $("#cad-scrub"), playBtn = $("#cad-play"), speed = $("#cad-speed"), badge = $("#cad-zoom-badge");
  let current = "modis", zoom = 1, ox = 0, oy = 0, lastFocus = null, playing = true;

  // ---- transform (zoom + pan)
  function apply() {
    const max = (zoom - 1) / 2;                      // keep the video covering the stage
    ox = Math.max(-max, Math.min(max, ox)); oy = Math.max(-max, Math.min(max, oy));
    video.style.transform = `translate(${ox * 100}%, ${oy * 100}%) scale(${zoom})`;
    badge.textContent = `${Math.round(zoom * 100)}%`;
    badge.classList.toggle("show", zoom > 1.001);
    stage.classList.toggle("zoomed", zoom > 1.001);
  }
  function zoomAt(factor, cx = 0.5, cy = 0.5) {
    const z = Math.max(1, Math.min(5, zoom * factor)), k = z / zoom;
    // keep the point under the cursor still: offset is in stage fractions
    ox = (ox - (cx - 0.5)) * k + (cx - 0.5); oy = (oy - (cy - 0.5)) * k + (cy - 0.5);
    zoom = z; apply();
  }
  function reset() { zoom = 1; ox = 0; oy = 0; apply(); }

  // ---- play / scrub
  function setPlaying(on) {
    playing = on; playBtn.textContent = on ? "pause" : "play";
    if (on) video.play().catch(() => {}); else video.pause();
  }
  video.addEventListener("timeupdate", () => { if (video.duration) scrub.value = Math.round(video.currentTime / video.duration * 1000); });
  scrub.addEventListener("input", () => { setPlaying(false); if (video.duration) video.currentTime = scrub.value / 1000 * video.duration; });
  playBtn.addEventListener("click", () => (comparing ? setPairsPlaying(!playing) : setPlaying(!playing)));
  speed.addEventListener("change", () => { video.playbackRate = +speed.value; pairVids.forEach((v) => { v.playbackRate = +speed.value; }); });

  // ---- drag: sideways spins the model; with zoom on, shift-drag (or two fingers) pans
  const pointers = new Map();
  let drag = null, pinch = null;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; drag = null; return;
    }
    drag = { x: e.clientX, y: e.clientY, t: video.currentTime, ox, oy, pan: e.shiftKey || e.button === 2, wasPlaying: playing };
    setPlaying(false); stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stage.getBoundingClientRect();
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((pinch.z * d / pinch.d) / zoom, ((a.x + b.x) / 2 - r.left) / r.width, ((a.y + b.y) / 2 - r.top) / r.height);
      return;
    }
    if (!drag) return;
    const dx = (e.clientX - drag.x) / r.width, dy = (e.clientY - drag.y) / r.height;
    if (drag.pan && zoom > 1) { ox = drag.ox + dx; oy = drag.oy + dy; apply(); return; }
    if (!video.duration) return;
    // one full stage width of drag = one full turn of the model
    let t = (drag.t - dx * video.duration) % video.duration;
    if (t < 0) t += video.duration;
    video.currentTime = t;
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && drag) { stage.classList.remove("dragging"); drag = null; }
  };
  stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
  stage.addEventListener("contextmenu", (e) => e.preventDefault());
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  stage.addEventListener("dblclick", reset);
  stage.addEventListener("keydown", (e) => {
    const step = video.duration ? video.duration / 50 : 0;
    if (e.key === "ArrowLeft") { setPlaying(false); video.currentTime = (video.currentTime - step + video.duration) % video.duration; }
    else if (e.key === "ArrowRight") { setPlaying(false); video.currentTime = (video.currentTime + step) % video.duration; }
    else if (e.key === "+" || e.key === "=") zoomAt(1.25);
    else if (e.key === "-") zoomAt(0.8);
    else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else return;
    e.preventDefault();
  });
  $("#cad-zoom-in").addEventListener("click", () => zoomAt(1.25));
  $("#cad-zoom-out").addEventListener("click", () => zoomAt(0.8));
  $("#cad-reset").addEventListener("click", () => { reset(); speed.value = "1"; video.playbackRate = 1; setPlaying(true); });
  $("#cad-full").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => { $("#cad-full").textContent = document.fullscreenElement ? "exit full screen" : "full screen"; });

  // ---- side by side: both models at once, drag either one to spin (together by default)
  const compare = $("#cad-compare"), pairVids = $$("#cad-compare video"), sync = $("#cad-sync");
  let comparing = false;
  function setPairsPlaying(on) {
    playing = on; playBtn.textContent = on ? "pause" : "play";
    pairVids.forEach((v) => (on ? v.play().catch(() => {}) : v.pause()));
  }
  $$(".cad-pair-stage").forEach((box) => {
    const v = box.querySelector("video");
    let d = null;
    box.addEventListener("pointerdown", (e) => {
      box.setPointerCapture(e.pointerId);
      d = { x: e.clientX, t: pairVids.map((x) => x.currentTime) };
      setPairsPlaying(false); box.classList.add("dragging");
    });
    box.addEventListener("pointermove", (e) => {
      if (!d || !v.duration) return;
      const dx = (e.clientX - d.x) / box.getBoundingClientRect().width;
      (sync.checked ? pairVids : [v]).forEach((x) => {
        if (!x.duration) return;
        let t = (d.t[pairVids.indexOf(x)] - dx * x.duration) % x.duration;
        x.currentTime = t < 0 ? t + x.duration : t;
      });
    });
    const up = () => { d = null; box.classList.remove("dragging"); };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
  });
  function showBoth() {
    comparing = true; current = "both";
    $("#cad-title").textContent = "MODIS and VIIRS";
    $$(".cad-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cad === "both")));
    modal.classList.add("comparing"); compare.hidden = false;
    video.pause();
    pairVids.forEach((v) => { v.playbackRate = +speed.value; v.currentTime = 0; });
    setPairsPlaying(true);
    $("#cad-use span").textContent = "use both";
  }

  // ---- which CAD
  function show(key) {
    if (key === "both") { showBoth(); return; }
    const c = CADS[key]; if (!c) return;
    if (comparing) { comparing = false; modal.classList.remove("comparing"); compare.hidden = true; pairVids.forEach((v) => v.pause()); }
    current = key;
    $("#cad-title").textContent = `${c.title} 3D model`;
    $$(".cad-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cad === key)));
    $("#cad-blurb").textContent = c.blurb;
    const dl = $("#cad-facts"); dl.replaceChildren();
    for (const [k, v] of c.facts) { const d = document.createElement("div"); d.innerHTML = "<dt></dt><dd></dd>"; d.firstChild.textContent = k; d.lastChild.textContent = v; dl.append(d); }
    if (!video.src.endsWith(c.src)) { video.src = c.src; }
    video.playbackRate = +speed.value;
    reset(); setPlaying(true);
    $("#cad-use span").textContent = `use ${c.title}`;
  }
  $$(".cad-tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.cad)));

  // "use MODIS / VIIRS": picks the sensor in the intro (if open) or switches the live map
  $("#cad-use").addEventListener("click", () => {
    const pick = current === "both" ? "harmonized" : current;
    const radio = document.querySelector(`input[name=welcome-sensor][value="${pick}"]`);
    if (radio) radio.checked = true;
    if (document.body.classList.contains("intro-on")) { close(); return; }
    window.dispatchEvent(new CustomEvent("firescout:sensor", { detail: pick }));
    close();
  });

  function open(key) {
    lastFocus = document.activeElement;
    modal.hidden = false;
    show(key || current);
    (comparing ? compare : stage).focus?.({ preventScroll: true });
  }
  function close() {
    if (modal.hidden) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    modal.hidden = true; video.pause(); pairVids.forEach((v) => v.pause());
    lastFocus?.focus?.({ preventScroll: true });
  }
  $("#cad-x").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden && !document.fullscreenElement) close(); });

  // entry points: intro cards + left panel button
  $$(".cad-enlarge").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(b.dataset.cad); }));
  $("#cad-open-rail")?.addEventListener("click", () => {
    const pressed = document.querySelector(".sensor-switch button[aria-pressed=true]");
    open(CADS[pressed?.dataset.sensor] ? pressed.dataset.sensor : "both");   // harmonized -> both side by side
  });

  // ---- hover to spin: moving across any small CAD preview turns the model (the renders are turntables)
  function scrubbable(v) {
    const box = v.parentElement;
    box.addEventListener("pointermove", (e) => {
      if (!v.duration || e.pointerType === "touch") return;
      const r = box.getBoundingClientRect();
      v.pause(); v.currentTime = Math.max(0, Math.min(.999, (e.clientX - r.left) / r.width)) * v.duration;
    });
    box.addEventListener("pointerleave", () => v.play().catch(() => {}));
  }
  $$(".cad-thumb video, .dock-vid video").forEach(scrubbable);

  // ---- satellite dock: always shows which satellite(s) the current reading comes from
  const dock = $("#sat-dock");
  if (dock && typeof state !== "undefined") {
    const VIIRS_FIRST = Date.UTC(2012, 0, 19);
    const MODE = { harmonized: "harmonized", modis: "MODIS only", viirs: "VIIRS only" };
    function syncDock() {
      const s = state.sensor, reading = s === "harmonized" ? (state.end >= VIIRS_FIRST ? "viirs" : "modis") : s;
      $("#dock-mode").textContent = MODE[s] || s;
      $$(".dock-sat", dock).forEach((b) => {
        const k = b.dataset.cad, used = s === "harmonized" || s === k;
        b.classList.toggle("used", used); b.classList.toggle("reading", k === reading);
        b.classList.toggle("both", s === "harmonized");                  // harmonized: both satellites are selected
        b.querySelector(".dock-state").textContent = s === "harmonized"
          ? (k === "modis" ? "2000 – 2011" : "2012 – today")
          : k === reading ? "selected" : "not in use";
      });
      $("#dock-note").textContent = s === "harmonized"
        ? `MODIS until 2011 · VIIRS from 2012`
        : `${s.toUpperCase()} only`;
    }
    ["firescout:sensor-changed", "firescout:readout", "firescout:calendar", "firescout:area"].forEach((ev) => addEventListener(ev, syncDock));
    $("#slider")?.addEventListener("change", syncDock); $("#date")?.addEventListener("change", syncDock);
    $$(".dock-sat", dock).forEach((b) => b.addEventListener("click", () => open(b.dataset.cad)));
    $("#dock-both")?.addEventListener("click", () => open("both"));
    $("#dock-min").addEventListener("click", () => {
      const min = dock.classList.toggle("min");
      $("#dock-min").setAttribute("aria-expanded", String(!min)); $("#dock-min").textContent = min ? "+" : "–";
      try { localStorage.setItem("firescout.dockMin", min ? "1" : ""); } catch { /* storage blocked */ }
    });
    try { if (localStorage.getItem("firescout.dockMin")) $("#dock-min").click(); } catch { /* storage blocked */ }
    syncDock();
  }

  // ---- only play the CAD videos that are on screen. Several full-HD videos decoding at once (most of them hidden)
  // can make some graphics cards draw them blank, so: intro cards during the intro, the dock in the app,
  // and the viewer's own video(s) only while it is open.
  const introVids = $$("#intro video"), dockVids = $$("#sat-dock video");
  function syncVideos() {
    const introOn = document.body.classList.contains("intro-on");
    const viewerOpen = !modal.hidden;
    const dockShown = !introOn && !viewerOpen && dock && !dock.classList.contains("min") && dock.offsetParent !== null;
    introVids.forEach((v) => (introOn && !viewerOpen ? v.play().catch(() => {}) : v.pause()));
    dockVids.forEach((v) => (dockShown ? v.play().catch(() => {}) : v.pause()));
  }
  new MutationObserver(syncVideos).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(syncVideos).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  if (dock) new MutationObserver(syncVideos).observe(dock, { attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", syncVideos);
  syncVideos();

  window.FireCAD = { open, close };
})();
