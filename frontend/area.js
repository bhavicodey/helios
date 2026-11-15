"use strict";
/* Helios area of interest: enter a place (city, town, address), or draw your own shape on the map.
   Place search uses OpenStreetMap's free Nominatim service: only the typed text is sent, once per search.
   Loaded after app.js, so it shares app.js's globals (state, map, setPin, stopSpin, toast, place). */
(function () {
  const q = (s) => document.querySelector(s);
  const bar = q("#draw-bar"), msg = q("#draw-msg"), navBtn = q("#draw-nav"), railBtn = q("#draw-area");
  let pts = [];

  // ---- 1. enter a place
  const form = q("#place-form"), input = q("#place-q"), list = q("#place-results");
  let searching = false, placeName = "", fromSearch = false;
  function goTo(r) {
    const lat = +r.lat, lon = +r.lon;
    list.hidden = true; list.replaceChildren();
    placeName = r.display_name.split(",").slice(0, 2).join(",").trim();
    input.value = placeName;
    stopSpin();
    fromSearch = true; setPin(lat, lon); fromSearch = false;
    // fit the place's own size (a city vs a county), but never closer than zoom 6 or further than 9
    const zoom = r.boundingbox ? Math.min(9, Math.max(6, 9 - Math.log2(Math.max(0.05, +r.boundingbox[1] - +r.boundingbox[0]) / 0.1))) : 7;
    map.flyTo({ center: [lon, lat], zoom, duration: reduceMotion ? 0 : 1800 });
    q("#place").textContent = placeName;
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || searching) return;
    searching = true; form.classList.add("busy");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      if (!res.ok) throw new Error(`place search failed (${res.status})`);
      const found = await res.json();
      if (!found.length) { toast(`couldn't find "${text}". try adding the state or country.`); return; }
      if (found.length === 1) { goTo(found[0]); return; }
      // several matches (e.g. Springfield): let the user pick
      list.replaceChildren(...found.map((r) => {
        const li = document.createElement("li"), b = document.createElement("button");
        b.type = "button"; b.textContent = r.display_name; b.addEventListener("click", () => goTo(r));
        li.append(b); return li;
      }));
      list.hidden = false; list.querySelector("button")?.focus();
    } catch (err) {
      toast(`place search isn't available right now (${err.message}). you can click the globe instead.`);
    } finally { searching = false; form.classList.remove("busy"); }
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !list.hidden) { list.hidden = true; input.focus(); } });
  // when the pin moves for another reason (click, preset), clear the stale place name
  addEventListener("firescout:area", () => {
    if (!state.pin || !placeName || fromSearch) return;
    placeName = ""; input.value = "";
  });

  // ---- 2. drawing
  function sources() {
    if (map.getSource("draw")) return;
    map.addSource("draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#2457c5", "fill-opacity": 0.12 } });
    map.addLayer({ id: "draw-line", type: "line", source: "draw", filter: ["!=", "$type", "Point"], paint: { "line-color": "#2457c5", "line-width": 2.2, "line-dasharray": [1.5, 1] } });
    map.addLayer({ id: "draw-pts", type: "circle", source: "draw", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5.5, "circle-color": "#fff", "circle-stroke-color": "#2457c5", "circle-stroke-width": 2.5 } });
  }
  function paint(cursor) {
    const ring = cursor ? [...pts, cursor] : pts;
    const f = ring.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p } }));
    if (ring.length >= 3) f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
    else if (ring.length === 2) f.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring } });
    map.getSource("draw")?.setData({ type: "FeatureCollection", features: f.filter((x, i) => i < pts.length || x.geometry.type !== "Point") });
    msg.textContent = pts.length < 3
      ? `click the map to add corners (${pts.length}, need 3+) · esc to cancel`
      : `${pts.length} corners · double-click or press enter to finish`;
  }
  function start() {
    if (!map.loaded()) { toast("the map is still loading, try again in a moment."); return; }
    stopSpin(); sources();
    pts = []; state.drawing = true; bar.hidden = false;
    navBtn?.setAttribute("aria-pressed", "true"); railBtn.classList.add("on");
    map.doubleClickZoom.disable(); map.getCanvas().style.cursor = "crosshair";
    paint();
  }
  function stop() {
    state.drawing = false; bar.hidden = true; pts = [];
    navBtn?.setAttribute("aria-pressed", "false"); railBtn.classList.remove("on");
    map.getSource("draw")?.setData({ type: "FeatureCollection", features: [] });
    setTimeout(() => map.doubleClickZoom.enable(), 300);
    map.getCanvas().style.cursor = "";
  }
  function finish() {
    if (pts.length < 3) { toast("an area needs at least 3 corners."); return; }
    const poly = pts.slice();
    // centre of the shape = where the pin goes (and what lat / lon the server receives)
    const lon = poly.reduce((a, p) => a + p[0], 0) / poly.length, lat = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    stop();
    setPin(lat, lon, { poly });
    const b = poly.reduce((bb, p) => [Math.min(bb[0], p[0]), Math.min(bb[1], p[1]), Math.max(bb[2], p[0]), Math.max(bb[3], p[1])], [180, 90, -180, -90]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 120, duration: reduceMotion ? 0 : 1200, maxZoom: 9 });
    toast("area set. all numbers are now for your drawn area.");
  }
  const near = (a, b) => { const pa = map.project(a), pb = map.project(b); return Math.hypot(pa.x - pb.x, pa.y - pb.y) < 12; };

  map.on("click", (e) => {
    if (!state.drawing) return;
    const p = [((e.lngLat.lng + 540) % 360) - 180, e.lngLat.lat];
    if (pts.length >= 3 && near(p, pts[0])) { finish(); return; }
    if (pts.length && near(p, pts[pts.length - 1])) return;      // ignore a repeat click on the same corner
    if (pts.length >= 300) { toast("that's the most corners an area can have."); return; }
    pts.push(p); paint();
  });
  map.on("dblclick", (e) => { if (state.drawing) { e.preventDefault(); if (pts.length > 3) pts.pop(); finish(); } });
  map.on("mousemove", (e) => { if (state.drawing && pts.length) paint([((e.lngLat.lng + 540) % 360) - 180, e.lngLat.lat]); });
  addEventListener("keydown", (e) => {
    if (!state.drawing) return;
    if (e.key === "Escape") stop();
    else if (e.key === "Enter") finish();
    else if ((e.key === "z" && (e.ctrlKey || e.metaKey)) || e.key === "Backspace") { pts.pop(); paint(); }
  });
  q("#draw-undo").addEventListener("click", () => { pts.pop(); paint(); });
  q("#draw-cancel").addEventListener("click", stop);
  navBtn?.addEventListener("click", () => (state.drawing ? stop() : start()));
  railBtn.addEventListener("click", () => (state.drawing ? stop() : start()));
})();
