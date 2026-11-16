"use strict";

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const CADS = {
    modis: {
      src: "media/cad-modis.mp4", title: "MODIS",
      blurb: "MODIS (Moderate Resolution Imaging Spectroradiometer) flies on NASA's Terra and Aqua satellites. Its thermal bands spot the heat of active fires, and its record goes back to 2000, which makes it the go-to sensor for long-term fire history.",
      facts: [["Satellites", "Terra (1999) · Aqua (2002)"], ["Spectral bands", "36"], ["Fire pixel size", "~1 km"], ["Record in Helios", "Nov 2000 → today"], ["Best for", "Long-term trends"]],
    },
    viirs: {
      src: "media/cad-viirs.mp4", title: "VIIRS",
      blurb: "VIIRS (Visible Infrared Imaging Radiometer Suite) flies on Suomi NPP and the NOAA-20/21 satellites. It sees smaller and cooler fires than MODIS, so it is the sharper choice for recent fire seasons.",
      facts: [["Satellites", "Suomi NPP (2011) · NOAA-20 · NOAA-21"], ["Spectral bands", "22"], ["Fire pixel size", "375 m – 1 km"], ["Record in Helios", "Jan 2012 → today"], ["Best for", "Recent, detailed fires"]],
    },
  };

  const modal = $("#cad"), video = $("#cad-video"), stage = $("#cad-stage");
  const scrub = $("#cad-scrub"), playBtn = $("#cad-play"), speed = $("#cad-speed"), badge = $("#cad-zoom-badge");
  let current = "modis", zoom = 1, ox = 0, oy = 0, lastFocus = null, playing = true;

  
  function apply() {
    const max = (zoom - 1) / 2;                      
    ox = Math.max(-max, Math.min(max, ox)); oy = Math.max(-max, Math.min(max, oy));
    video.style.transform = `translate(${ox * 100}%, ${oy * 100}%) scale(${zoom})`;
    badge.textContent = `${Math.round(zoom * 100)}%`;
    badge.classList.toggle("show", zoom > 1.001);
    stage.classList.toggle("zoomed", zoom > 1.001);
  }
  function zoomAt(factor, cx = 0.5, cy = 0.5) {
    const z = Math.max(1, Math.min(5, zoom * factor)), k = z / zoom;
    
    ox = (ox - (cx - 0.5)) * k + (cx - 0.5); oy = (oy - (cy - 0.5)) * k + (cy - 0.5);
    zoom = z; apply();
  }
  function reset() { zoom = 1; ox = 0; oy = 0; apply(); }

  
  function setPlaying(on) {
    playing = on; playBtn.textContent = on ? "Pause" : "Play";
    if (on) video.play().catch(() => {}); else video.pause();
  }
  video.addEventListener("timeupdate", () => { if (video.duration) scrub.value = Math.round(video.currentTime / video.duration * 1000); });
  scrub.addEventListener("input", () => { setPlaying(false); if (video.duration) video.currentTime = scrub.value / 1000 * video.duration; });
  playBtn.addEventListener("click", () => (comparing ? setPairsPlaying(!playing) : setPlaying(!playing)));
  speed.addEventListener("change", () => { video.playbackRate = +speed.value; pairVids.forEach((v) => { v.playbackRate = +speed.value; }); });

  
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
  $("#cad-reset").addEventListener("click", () => { reset(); speed.value = "0.5"; video.playbackRate = 0.5; setPlaying(true); });
  $("#cad-full").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => { $("#cad-full").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });

  
  const compare = $("#cad-compare"), pairVids = $$("#cad-compare video"), sync = $("#cad-sync");
  let comparing = false;
  function setPairsPlaying(on) {
    playing = on; playBtn.textContent = on ? "Pause" : "Play";
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
    $("#cad-use span").textContent = "Use both";
  }

  
  const PARTS = {
    modis: {
      name: "MODIS on Terra", src: "media/cad-modis.mp4", t: 2.09,
      parts: [
        { name: "Solar panels", x: 27, y: 37, text: "They turn sunlight into electricity for the satellite." },
        { name: "Dish antenna", x: 57, y: 13, text: "Sends the data back down to Earth." },
        { name: "Main body", x: 52, y: 36, text: "Holds the computers, batteries and radios." },
        { name: "Radiator panel", x: 42, y: 54, text: "Gets rid of extra heat so the electronics stay cool." },
        { name: "Instruments", x: 62, y: 42, text: "Terra carries 5 instruments. MODIS is one of them." },
      ],
      inside: [
        { name: "Scan mirror", text: "A spinning mirror sweeps the view across a 2,330 km strip, back and forth." },
        { name: "Telescope", text: "Collects light from the ground and focuses it." },
        { name: "Beam splitters", text: "Split the light by color so each color goes to its own detector." },
        { name: "Detectors", text: "36 bands. Fires show up best in the 4 µm band." },
        { name: "Cooler", text: "Keeps the infrared detectors very cold (about 83 K)." },
      ],
    },
    viirs: {
      name: "VIIRS on NOAA-20", src: "media/cad-viirs.mp4", t: 2.44,
      parts: [
        { name: "Solar panel", x: 30, y: 27, text: "Turns sunlight into electricity for the satellite." },
        { name: "Dish antenna", x: 56, y: 13, text: "Sends the data back down to Earth." },
        { name: "Main body", x: 50, y: 40, text: "The part with the NOAA logo. Holds the computers, batteries and radios." },
        { name: "Instruments", x: 52, y: 76, text: "NOAA-20 carries 5 instruments. VIIRS is one of them." },
      ],
      inside: [
        { name: "Rotating telescope", text: "The whole telescope spins to sweep a 3,040 km strip." },
        { name: "Half-angle mirror", text: "Turns at half the speed so the picture stays still on the detectors." },
        { name: "Beam splitters", text: "Split the light by color." },
        { name: "Detectors", text: "22 bands. The fire bands are I4 (3.74 µm, 375 m pixels) and M13 (4.05 µm)." },
        { name: "Cooler", text: "Keeps the heat sensors cold (about 80 K)." },
      ],
    },
  };
  const partsBox = $("#cad-parts"), partsVideo = $("#parts-video"), partsTip = $("#parts-tip"), partsInfo = $("#parts-info");
  let partsInst = "modis";
  function describe(item) { partsInfo.textContent = item ? `${item.name}: ${item.text}` : "Hover a dot on the satellite, or a part below."; }
  function renderParts(k) {
    partsInst = k; const d = PARTS[k];
    $$("[data-pinst]", partsBox).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pinst === k)));
    $("#parts-name").textContent = d.name;
    if (!partsVideo.src.endsWith(d.src)) { partsVideo.src = d.src; partsVideo.preload = "auto"; }
    const seek = () => { partsVideo.currentTime = d.t; partsVideo.pause(); };
    partsVideo.readyState >= 1 ? seek() : partsVideo.addEventListener("loadedmetadata", seek, { once: true });
    partsTip.hidden = true; $("#parts-spot")?.classList.remove("on"); describe(null);
    const dots = $("#parts-dots"); dots.replaceChildren();
    const spot = $("#parts-spot");
    d.parts.forEach((p, i) => {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", p.name);
      b.textContent = i + 1; b.style.left = p.x + "%"; b.style.top = p.y + "%";
      const on = () => {
        const flip = p.x > 55;
        partsTip.className = flip ? "left" : "right";
        partsTip.innerHTML = "<i></i><div><b></b><span></span></div>";
        partsTip.querySelector("i").textContent = i + 1; partsTip.querySelector("b").textContent = p.name; partsTip.querySelector("span").textContent = p.text;
        partsTip.style.left = flip ? `calc(${p.x}% - 268px)` : `calc(${p.x}% + 24px)`;
        partsTip.style.top = `min(calc(${p.y}% - 18px), calc(100% - 100px))`;
        partsTip.hidden = false; requestAnimationFrame(() => partsTip.classList.add("show"));
        spot.style.setProperty("--sx", p.x + "%"); spot.style.setProperty("--sy", p.y + "%"); spot.classList.add("on");
        $$("#parts-dots button", partsBox).forEach((x) => x.classList.toggle("on", x === b));
        describe(p); $$("#parts-list button", partsBox).forEach((x) => x.classList.toggle("on", x.dataset.n === p.name));
      };
      const off = () => {
        partsTip.classList.remove("show"); partsTip.hidden = true; spot.classList.remove("on");
        $$("#parts-dots .on", partsBox).forEach((x) => x.classList.remove("on"));
        describe(null); $$("#parts-list .on", partsBox).forEach((x) => x.classList.remove("on"));
      };
      b.addEventListener("mouseenter", on); b.addEventListener("focus", on); b.addEventListener("mouseleave", off); b.addEventListener("blur", off);
      b.addEventListener("click", on);
      dots.append(b);
    });
    const fill = (ul, items, withDot) => {
      ul.replaceChildren();
      items.forEach((p) => {
        const li = document.createElement("li"), b = document.createElement("button"); b.type = "button"; b.textContent = withDot ? `${items.indexOf(p) + 1}  ${p.name}` : p.name; b.dataset.n = p.name;
        const show = () => { describe(p); b.classList.add("on"); if (withDot) $$("#parts-dots button", partsBox).forEach((x) => x.classList.toggle("on", x.getAttribute("aria-label") === p.name)); };
        const hide = () => { describe(null); b.classList.remove("on"); $$("#parts-dots .on", partsBox).forEach((x) => x.classList.remove("on")); };
        b.addEventListener("mouseenter", show); b.addEventListener("focus", show); b.addEventListener("mouseleave", hide); b.addEventListener("blur", hide); b.addEventListener("click", show);
        li.append(b); ul.append(li);
      });
    };
    fill($("#parts-list"), d.parts, true); fill($("#parts-inside"), d.inside, false);
  }
  $$("[data-pinst]", partsBox).forEach((b) => b.addEventListener("click", () => renderParts(b.dataset.pinst)));
  function leaveParts() { modal.classList.remove("explaining"); partsBox.hidden = true; partsVideo.pause(); }
  function showParts() {
    if (comparing) { comparing = false; modal.classList.remove("comparing"); compare.hidden = true; pairVids.forEach((v) => v.pause()); }
    current = "parts"; video.pause();
    $("#cad-title").textContent = "Explain parts";
    $$(".cad-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cad === "parts")));
    modal.classList.add("explaining"); partsBox.hidden = false;
    renderParts(partsInst);
  }

  function show(key) {
    if (key === "parts") { showParts(); return; }
    leaveParts();
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
    $("#cad-use span").textContent = `Use ${c.title}`;
  }
  $$(".cad-tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.cad)));

  
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
    modal.hidden = true; video.pause(); partsVideo.pause(); pairVids.forEach((v) => v.pause());
    lastFocus?.focus?.({ preventScroll: true });
  }
  $("#cad-x").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden && !document.fullscreenElement) close(); });

  
  $$(".cad-enlarge").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(b.dataset.cad); }));
  $("#cad-open-rail")?.addEventListener("click", () => {
    const pressed = document.querySelector(".sensor-switch button[aria-pressed=true]");
    open(CADS[pressed?.dataset.sensor] ? pressed.dataset.sensor : "both");   
  });

  
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
        b.classList.toggle("both", s === "harmonized");                  
        b.querySelector(".dock-state").textContent = s === "harmonized"
          ? (k === "modis" ? "2000 – 2011" : "2012 – today")
          : k === reading ? "Selected" : "Not in use";
      });
    }
    ["firescout:sensor-changed", "firescout:readout", "firescout:calendar", "firescout:area"].forEach((ev) => addEventListener(ev, syncDock));
    $("#slider")?.addEventListener("change", syncDock); $("#date")?.addEventListener("change", syncDock);
    $$(".dock-sat", dock).forEach((b) => b.addEventListener("click", () => open(b.dataset.cad)));
    $("#dock-both")?.addEventListener("click", () => open("both"));
    $("#dock-min").addEventListener("click", () => {
      const min = dock.classList.toggle("min");
      $("#dock-min").setAttribute("aria-expanded", String(!min)); $("#dock-min").textContent = min ? "+" : "–";
      try { localStorage.setItem("firescout.dockMin", min ? "1" : ""); } catch {  }
    });
    try { if (localStorage.getItem("firescout.dockMin")) $("#dock-min").click(); } catch {  }
    syncDock();
  }

  
  const introVids = $$("#intro video"), dockVids = $$("#sat-dock video");
  
  
  
  const spinRate = (v) => (v === video || pairVids.includes(v) ? +speed.value : 0.5);
  [...introVids, ...dockVids, ...pairVids, video].forEach((v) => {
    const apply = () => { v.defaultPlaybackRate = spinRate(v); if (v.playbackRate !== spinRate(v)) v.playbackRate = spinRate(v); };
    apply(); ["loadedmetadata", "play"].forEach((ev) => v.addEventListener(ev, apply));
  });
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
