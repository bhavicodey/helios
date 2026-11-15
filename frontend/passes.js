// satellite fly-over on the map
const $ = (s, r = document) => r.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const KM = 1000, R_EARTH = 6371;

const SATS = {
  modis: { name: "MODIS", color: "#E5383B", altKm: 705, swathKm: 2330, heading: 192, scanS: 0.42, offsetS: 0, model: "media/models/modis-terra.glb" },
  viirs: { name: "VIIRS", color: "#FFD60A", altKm: 824, swathKm: 3040, heading: 12, scanS: 0.508, offsetS: 1.6, model: "media/models/viirs-noaa20.glb" },
};
const PASS_KM = 3600, PASS_S = 16, TOTAL_S = PASS_S + 1.6;

const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
function destination([lon, lat], bearingDeg, km) {
  const d = km / R_EARTH, b = rad(bearingDeg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((deg(l2) + 540) % 360) - 180, deg(p2)];
}
function bearing([lon1, lat1], [lon2, lat2]) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  return (deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) + 360) % 360;
}
const crossPoint = (ground, hdg, km) => destination(ground, hdg + 90, km);

let map, center = null, playing = false, startT = 0, raf = 0, lastPlaceKey = "";
const empty = { type: "FeatureCollection", features: [] };

function addLayers() {
  for (const id of ["pass-track", "pass-swath", "pass-edge", "pass-scan", "pass-spot"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: empty });
  const color = ["match", ["get", "sat"], "modis", SATS.modis.color, SATS.viirs.color];
  map.addLayer({ id: "pass-swath", type: "fill", source: "pass-swath", paint: { "fill-color": color, "fill-opacity": ["get", "a"] } });
  map.addLayer({ id: "pass-swath-edge", type: "line", source: "pass-edge", paint: { "line-color": color, "line-width": 1.2, "line-opacity": 0.5 } });
  map.addLayer({ id: "pass-track", type: "line", source: "pass-track", paint: { "line-color": color, "line-width": 1, "line-opacity": 0.35, "line-dasharray": [2, 3] } });
  map.addLayer({ id: "pass-scan", type: "line", source: "pass-scan", paint: { "line-color": color, "line-width": 2, "line-opacity": 0.8 } });
  map.addLayer({ id: "pass-spot", type: "circle", source: "pass-spot", paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": color, "circle-stroke-width": 2 } });
}

function satAt(s, t) {
  const tt = t - s.offsetS, visible = tt >= 0 && tt <= PASS_S;
  const along = PASS_KM * Math.min(Math.max(tt, 0), PASS_S) / PASS_S;
  const start = destination(center, s.heading + 180, PASS_KM / 2);
  const ground = destination(start, s.heading, along);
  const hdg = bearing(ground, destination(ground, s.heading, 1));
  return { visible, along, start, ground, hdg, scan: ((t / s.scanS) % 1 + 1) % 1 };
}

function update(t) {
  const track = [], swath = [], edge = [], scan = [], spot = [];
  for (const [k, s] of Object.entries(SATS)) {
    const p = satAt(s, t); s.now = p.visible ? p : null;
    if (!p.visible) continue;
    const half = s.swathKm / 2;
    const line = []; for (let i = 0; i <= 40; i++) line.push(destination(p.start, s.heading, PASS_KM * i / 40));
    track.push({ type: "Feature", properties: { sat: k }, geometry: { type: "LineString", coordinates: line } });
    // faint footprint behind the satellite
    const n = 24, keep = PASS_KM * 0.45;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, p.along - keep * (i + 1) / n), b = Math.max(0, p.along - keep * i / n);
      if (b - a < 1) continue;
      const ga = destination(p.start, s.heading, a), gb = destination(p.start, s.heading, b);
      const ring = [crossPoint(ga, s.heading, -half), crossPoint(gb, s.heading, -half), crossPoint(gb, s.heading, half), crossPoint(ga, s.heading, half)];
      ring.push(ring[0]);
      swath.push({ type: "Feature", properties: { sat: k, a: 0.07 * (1 - i / n) }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
    const from = Math.max(0, p.along - keep), L = [], R = [];
    for (let i = 0; i <= 16; i++) { const g = destination(p.start, s.heading, from + (p.along - from) * i / 16); L.push(crossPoint(g, s.heading, -half)); R.push(crossPoint(g, s.heading, half)); }
    if (p.along - from > 1) edge.push({ type: "Feature", properties: { sat: k }, geometry: { type: "MultiLineString", coordinates: [L, R] } });
    const x = -half + 2 * half * p.scan, stripe = [];
    for (let i = 0; i <= 16; i++) stripe.push(crossPoint(p.ground, p.hdg, -half + (x + half) * i / 16));
    scan.push({ type: "Feature", properties: { sat: k }, geometry: { type: "LineString", coordinates: stripe } });
    const look = crossPoint(p.ground, p.hdg, x);
    spot.push({ type: "Feature", properties: { sat: k }, geometry: { type: "Point", coordinates: look } });
    s.now = { ...p, look, x };
  }
  const set = (id, features) => map.getSource(id)?.setData({ type: "FeatureCollection", features });
  set("pass-track", track); set("pass-swath", swath); set("pass-edge", edge); set("pass-scan", scan); set("pass-spot", spot);
  updateTags();
}

function updateTags() {
  for (const [k, s] of Object.entries(SATS)) {
    if (!s.marker) {
      const el = document.createElement("div"); el.className = "pass-tag"; el.style.setProperty("--c", s.color);
      el.innerHTML = `<b>${s.name}</b><span>${s.altKm} km up</span>`;
      s.marker = new maplibregl.Marker({ element: el, anchor: "bottom-left", offset: [12, -18] });
    }
    if (s.now) { s.marker.setLngLat(s.now.ground); if (!s.marker._map) s.marker.addTo(map); } else s.marker.remove();
  }
}

// 3D satellites inside the map (three.js custom layer)
async function threeLayer() {
  const T = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
  const loader = new GLTFLoader(), draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/");
  loader.setDRACOLoader(draco);
  return {
    id: "pass-sats", type: "custom", renderingMode: "3d",
    onAdd(m, gl) {
      this.camera = new T.Camera(); this.scene = new T.Scene();
      this.scene.add(new T.AmbientLight(0xffffff, 1.4));
      const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(1, -1, 2); this.scene.add(sun);
      this.groups = {};
      for (const [k, s] of Object.entries(SATS)) {
        const g = new T.Group(); g.visible = false; this.scene.add(g);
        const beam = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.45 }));
        beam.frustumCulled = false; g.add(beam);
        const holder = new T.Group(); g.add(holder);
        loader.load(s.model, (gltf) => {
          const obj = gltf.scene, box = new T.Box3().setFromObject(obj), size = box.getSize(new T.Vector3()).length();
          obj.position.sub(box.getCenter(new T.Vector3())); obj.scale.setScalar(2 / size); obj.rotation.x = Math.PI / 2; holder.add(obj);
        });
        this.groups[k] = { g, beam, holder };
      }
      this.renderer = new T.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },
    render(gl, args) {
      if (!playing) return;
      const z = map.getZoom();
      for (const [k, s] of Object.entries(SATS)) {
        const n = s.now; if (!n) continue;
        const { beam, holder } = this.groups[k];
        const mpp = 40075016.686 * Math.cos(rad(n.ground[1])) / (512 * 2 ** z);
        holder.scale.setScalar(mpp * 34); holder.rotation.z = -rad(n.hdg);
        const dE = (n.look[0] - n.ground[0]) * 111320 * Math.cos(rad(n.ground[1])), dN = (n.look[1] - n.ground[1]) * 110574;
        const pos = beam.geometry.attributes.position; pos.setXYZ(1, dE, dN, -s.altKm * KM); pos.needsUpdate = true;
        this.camera.projectionMatrix = new T.Matrix4().fromArray(args.defaultProjectionData.mainMatrix).multiply(new T.Matrix4().fromArray(map.transform.getMatrixForModel(n.ground, s.altKm * KM)));
        for (const kk of Object.keys(this.groups)) this.groups[kk].g.visible = kk === k;
        this.renderer.resetState(); this.renderer.render(this.scene, this.camera);
      }
    },
  };
}

// play once, then clear
function frame(now) {
  raf = 0;
  if (!playing) return;
  const t = (now - startT) / 1000;
  if (t > TOTAL_S) return stop();
  update(t); map.triggerRepaint(); raf = requestAnimationFrame(frame);
}
function stop() {
  playing = false;
  for (const id of ["pass-track", "pass-swath", "pass-edge", "pass-scan", "pass-spot"]) map.getSource(id)?.setData(empty);
  for (const s of Object.values(SATS)) { s.now = null; s.marker?.remove(); }
  const b = $("#pass-play"); if (b) { b.disabled = !center; b.textContent = "watch a pass"; }
  map.triggerRepaint();
}
function play() {
  if (!center || reduce) return;
  if (playing) stop();
  playing = true; startT = performance.now();
  const b = $("#pass-play"); if (b) { b.disabled = true; b.textContent = "passing…"; }
  raf = requestAnimationFrame(frame);
}
function onArea() {
  const pin = window.firescout?.snapshot?.().pin;
  center = pin ? [pin.lon, pin.lat] : null;
  const b = $("#pass-play"); if (b && !playing) b.disabled = !center;
  const key = pin ? `${pin.lat.toFixed(2)},${pin.lon.toFixed(2)}` : "";
  if (center && key !== lastPlaceKey && !document.body.classList.contains("intro-on")) setTimeout(play, 1800);   // a new place: one pass
  lastPlaceKey = key;
}

async function start() {
  map = window.firescoutMap; if (!map) return;
  let ready = false;
  addEventListener("firescout:area", () => { if (ready) onArea(); });
  await new Promise((r) => { if (map.loaded() || map.isStyleLoaded()) return r(); map.once("load", r); map.once("idle", r); });
  addLayers();
  try { map.addLayer(await threeLayer()); } catch (err) { console.warn("3D satellites unavailable:", err); }
  ready = true;
  $("#pass-play")?.addEventListener("click", play);
  onArea();
}
start();
window.FirePasses = { play, stop };
