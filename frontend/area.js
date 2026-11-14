"use strict";
/* Helios area of interest: type a latitude / longitude, or draw your own shape on the map.
   Loaded after app.js, so it shares app.js's globals (state, map, setPin, stopSpin, toast, place). */
(function () {
  const q = (s) => document.querySelector(s);
  const bar = q("#draw-bar"), msg = q("#draw-msg"), navBtn = q("#draw-nav"), railBtn = q("#draw-area");
  let pts = [];

  // ---- 1. latitude / longitude
  q("#coord-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const lat = +q("#coord-lat").value, lon = +q("#coord-lon").value;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      toast("latitude goes from -90 to 90 and longitude from -180 to 180."); return;
    }
    stopSpin();
    setPin(lat, lon);
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 6), duration: reduceMotion ? 0 : 1800 });
  });
  addEventListener("firescout:area", () => {
    if (!state.pin) return;
    q("#coord-lat").value = state.pin.lat.toFixed(4); q("#coord-lon").value = state.pin.lon.toFixed(4);
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
      ? `click to add corners (${pts.length} so far, at least 3) · esc to cancel`
      : `${pts.length} corners · click the first corner, double-click, or press enter to finish`;
  }
  function start() {
    if (!map.loaded()) { toast("the map is still loading, try again in a moment."); return; }
    stopSpin(); sources();
    pts = []; state.drawing = true; bar.hidden = false;
    navBtn.setAttribute("aria-pressed", "true"); railBtn.classList.add("on");
    map.doubleClickZoom.disable(); map.getCanvas().style.cursor = "crosshair";
    paint();
  }
  function stop() {
    state.drawing = false; bar.hidden = true; pts = [];
    navBtn.setAttribute("aria-pressed", "false"); railBtn.classList.remove("on");
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
    toast("area saved. everything now reads inside your shape.");
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
  navBtn.addEventListener("click", () => (state.drawing ? stop() : start()));
  railBtn.addEventListener("click", () => (state.drawing ? stop() : start()));
})();
