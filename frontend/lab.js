/* Helios satellite lab: MODIS (Terra) and VIIRS (NOAA-20) in one synchronized 3D scene.
   Both satellites pass over the same region; each sweeps its scan line across track, painting its
   swath (footprint) on Earth and flagging fires in its own color (MODIS amber, VIIRS red).
   The side panel shows each instrument's optical path: incoming radiation → scanning optics →
   telescope → dichroic beam splitters → cooled detector arrays, synced to the scan in the 3D scene.
   Three.js loads only the first time the lab opens. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const COLOR = { modis: "#FFB020", viirs: "#FF3355" };
// real values (drawn exaggerated in the scene so the satellites and scan are visible)
const SAT = {
  modis: { name: "MODIS", host: "Terra", altKm: 705, swathKm: 2330, scanS: 1.477, rDraw: 1.30, scanDraw: 0.36, heading: 190, phase: 0.0,
           detect: 0.45, model: "media/models/modis-terra.glb" },
  viirs: { name: "VIIRS", host: "NOAA-20", altKm: 824, swathKm: 3040, scanS: 1.786, rDraw: 1.36, scanDraw: 0.435,   /* same 1.477 : 1.786 ratio as the real scans */ heading: 10, phase: -0.22,
           detect: 0.2, model: "media/models/viirs-noaa20.glb" },
};
const R_EARTH = 6371, ORBIT_S = 46;          // one drawn orbit = 46 s of animation

let T, ctl, built = false, building = null, raf = 0, running = true, warp = 1, simT = 0, last = 0;
let renderer, scene, camera, controls, earth, regionVec, fires = [], sats = {}, focus = "both", inst = "modis", part = "";
const modal = $("#lab");

// ------------------------------------------------------------------ geometry helpers
function latLonVec(lat, lon, r = 1) {
  const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
  return new T.Vector3(-Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)).multiplyScalar(r);
}
function rotAround(v, axis, ang) { return v.clone().applyAxisAngle(axis, ang); }

// ------------------------------------------------------------------ Earth texture (land from Natural Earth via world-atlas)
async function earthTexture() {
  const W = 2048, H = 1024, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#07050a"; g.fillRect(0, 0, W, H);
  try {
    const topo = await import("https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm");
    const world = await (await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json")).json();
    const land = topo.feature(world, world.objects.land);
    const px = ([lon, lat]) => [(lon + 180) / 360 * W, (90 - lat) / 180 * H];
    g.fillStyle = "#241517"; g.strokeStyle = "#6b3a40"; g.lineWidth = 1.2;
    for (const f of land.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        g.beginPath();
        for (const ring of poly) ring.forEach((p, i) => { const [x, y] = px(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.fill("evenodd"); g.stroke();
      }
    }
  } catch { /* offline: plain sphere with grid */ }
  g.strokeStyle = "rgba(255,120,110,.10)"; g.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) { const x = (lon + 180) / 360 * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const y = (90 - lat) / 180 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// ------------------------------------------------------------------ build the scene once
async function build() {
  T = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");

  const canvas = $("#lab-canvas");
  renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(40, 1, 0.01, 100);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.minDistance = 1.25; controls.maxDistance = 8; controls.enablePan = false;

  scene.add(new T.AmbientLight(0xffffff, 0.55));
  const sun = new T.DirectionalLight(0xfff1e6, 1.6); sun.position.set(4, 3, 5); scene.add(sun);

  // stars
  const starG = new T.BufferGeometry(), sp = [];
  for (let i = 0; i < 1500; i++) { const v = new T.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 20); sp.push(v.x, v.y, v.z); }
  starG.setAttribute("position", new T.Float32BufferAttribute(sp, 3));
  scene.add(new T.Points(starG, new T.PointsMaterial({ color: 0xffd6d0, size: 0.06, transparent: true, opacity: 0.7 })));

  // Earth + red atmosphere rim
  earth = new T.Mesh(new T.SphereGeometry(1, 128, 128), new T.MeshStandardMaterial({ map: await earthTexture(), roughness: 0.95, metalness: 0 }));
  scene.add(earth);
  scene.add(new T.Mesh(new T.SphereGeometry(1.04, 96, 96), new T.ShaderMaterial({
    transparent: true, side: T.BackSide, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: "varying vec3 n; void main(){ n = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: "varying vec3 n; void main(){ float i = pow(0.72 - dot(n, vec3(0.,0.,1.)), 3.); gl_FragColor = vec4(0.9,0.22,0.23,1.)*i; }",
  })));

  // the region (the area pinned in the app, or Los Angeles)
  const pin = window.firescout?.snapshot?.().pin || { lat: 34.05, lon: -118.55 };
  regionVec = latLonVec(pin.lat, pin.lon).normalize();
  const ring = new T.Mesh(new T.RingGeometry(0.035, 0.04, 64), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: T.DoubleSide }));
  ring.position.copy(regionVec.clone().multiplyScalar(1.002)); ring.lookAt(regionVec.clone().multiplyScalar(2)); scene.add(ring);
  $("#lab-region").textContent = window.firescout?.snapshot?.().place || "Los Angeles (example)";

  // example fires around the region: some big and hot, some small and cool
  const north = new T.Vector3(0, 1, 0), east = new T.Vector3().crossVectors(north, regionVec).normalize(), nn = new T.Vector3().crossVectors(regionVec, east).normalize();
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.07;
    const v = regionVec.clone().add(east.clone().multiplyScalar(Math.cos(a) * d)).add(nn.clone().multiplyScalar(Math.sin(a) * d)).normalize();
    const intensity = Math.random() ** 1.6;                     // most fires are small
    const m = new T.Mesh(new T.SphereGeometry(0.0035 + intensity * 0.004, 10, 10), new T.MeshBasicMaterial({ color: 0x5a4a4c }));
    m.position.copy(v.clone().multiplyScalar(1.003)); scene.add(m);
    fires.push({ v, intensity, mesh: m, seen: { modis: false, viirs: false }, pulse: [] });
  }

  // satellites
  const loader = new GLTFLoader(), draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/");
  loader.setDRACOLoader(draco);
  for (const [k, s] of Object.entries(SAT)) {
    const col = new T.Color(COLOR[k]);
    // orbit: a great circle through the region, heading roughly north (VIIRS, ascending) or south (MODIS, descending)
    const hd = s.heading * Math.PI / 180;
    const dir = nn.clone().multiplyScalar(Math.cos(hd)).add(east.clone().multiplyScalar(Math.sin(hd))).normalize();
    const axis = new T.Vector3().crossVectors(regionVec, dir).normalize();
    const pts = []; for (let i = 0; i <= 256; i++) pts.push(rotAround(regionVec, axis, i / 256 * Math.PI * 2).multiplyScalar(s.rDraw));
    const orbit = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineDashedMaterial({ color: col, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.55 }));
    orbit.computeLineDistances(); scene.add(orbit);

    const group = new T.Group(); scene.add(group);
    const glow = new T.Mesh(new T.SphereGeometry(0.012, 16, 16), new T.MeshBasicMaterial({ color: col })); group.add(glow);
    // swath ribbon (recent footprint), scan stripe, beam to the scan spot, and the field-of-view fan
    // the footprint is split into M strips across track so it hugs the curved Earth instead of cutting under it
    const N = 260, M = 13;
    const ribbon = new T.Mesh(new T.BufferGeometry(), new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide, uniforms: { col: { value: col } },
      vertexShader: "attribute float alpha; varying float a; void main(){ a = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: "uniform vec3 col; varying float a; void main(){ gl_FragColor = vec4(col, a); }",
    }));
    ribbon.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(N * M * 3), 3));
    ribbon.geometry.setAttribute("alpha", new T.BufferAttribute(new Float32Array(N * M), 1));
    const idx = []; for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) { const a = i * M + j, b = a + M; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    ribbon.geometry.setIndex(idx); ribbon.frustumCulled = false; scene.add(ribbon);
    const stripe = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95 }));
    stripe.frustumCulled = false; scene.add(stripe);
    const beam = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: col, transparent: true, opacity: 0.8 }));
    beam.frustumCulled = false; scene.add(beam);
    const fan = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, side: T.DoubleSide, depthWrite: false }));
    fan.geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(9), 3)); fan.frustumCulled = false; scene.add(fan);
    const spot = new T.Mesh(new T.SphereGeometry(0.008, 12, 12), new T.MeshBasicMaterial({ color: 0xffffff })); scene.add(spot);

    sats[k] = { ...s, k, col, axis, group, glow, ribbon, stripe, beam, fan, spot, N, M, hist: [], halfW: (s.swathKm / 2) / R_EARTH, count: 0, lastX: null };
    loader.load(s.model, (gltf) => {
      const m = gltf.scene; const box = new T.Box3().setFromObject(m), size = box.getSize(new T.Vector3()).length();
      m.scale.setScalar(0.11 / size); m.position.sub(box.getCenter(new T.Vector3()).multiplyScalar(0.11 / size));
      group.add(m); sats[k].model = m; checkLoaded();
    }, undefined, () => checkLoaded(true));
  }
  focusOn("both", true);
  addEventListener("resize", resize);
  built = true;
}
let loadedN = 0;
function checkLoaded(failed) { loadedN++; if (loadedN >= 2) $("#lab-loading").hidden = true; if (failed) $("#lab-loading").textContent = "a 3D model couldn't load; the scene still runs."; }

// ------------------------------------------------------------------ per-frame update
function satState(s, t) {
  const th = (t / ORBIT_S) * Math.PI * 2 + s.phase;
  const p = rotAround(regionVec, s.axis, th);                                 // sub-satellite point (unit)
  const along = new T.Vector3().crossVectors(s.axis, p).normalize();          // flight direction
  const cross = new T.Vector3().crossVectors(p, along).normalize();           // scan direction
  return { th, p, along, cross };
}
// point on the ground `ang` radians across-track from p (positive = toward `cross`)
function onSurface(p, cross, ang, r = 1.004) { return rotAround(p, new T.Vector3().crossVectors(p, cross).normalize(), ang).multiplyScalar(r); }

function step(dt) {
  simT += dt * warp;
  for (const s of Object.values(sats)) {
    const { th, p, along, cross } = satState(s, simT);
    const pos = p.clone().multiplyScalar(s.rDraw);
    s.group.position.copy(pos);
    s.group.up.copy(p); s.group.lookAt(pos.clone().add(along));
    // scan: the mirror / rotating telescope sweeps the view across track, one sweep per scan period (sawtooth)
    s.scanPhase = ((simT / s.scanDraw) % 1 + 1) % 1;
    const x = -s.halfW + 2 * s.halfW * s.scanPhase;
    const left = onSurface(p, cross, -s.halfW), right = onSurface(p, cross, s.halfW), here = onSurface(p, cross, x);
    s.stripe.geometry.setFromPoints([left, here]); s.spot.position.copy(here);
    s.beam.geometry.setFromPoints([pos, here]);
    const fp = s.fan.geometry.attributes.position; fp.setXYZ(0, pos.x, pos.y, pos.z); fp.setXYZ(1, left.x, left.y, left.z); fp.setXYZ(2, right.x, right.y, right.z); fp.needsUpdate = true;
    // footprint history: one row per frame, fading with age
    s.hist.unshift(Array.from({ length: s.M }, (_, j) => onSurface(p, cross, -s.halfW + 2 * s.halfW * j / (s.M - 1), 1.0025)));
    if (s.hist.length > s.N) s.hist.pop();
    const P = s.ribbon.geometry.attributes.position, C = s.ribbon.geometry.attributes.alpha;
    for (let i = 0; i < s.N; i++) {
      const row = s.hist[Math.min(i, s.hist.length - 1)], f = i < s.hist.length ? Math.max(0, 1 - i / s.N) * 0.22 : 0;   // unused rows invisible
      for (let j = 0; j < s.M; j++) {
        const v = row[j], edge = j === 0 || j === s.M - 1 ? 3.5 : 1;   // brighter swath edges
        P.setXYZ(i * s.M + j, v.x, v.y, v.z); C.setX(i * s.M + j, Math.min(0.85, f * edge));
      }
    }
    P.needsUpdate = true; C.needsUpdate = true;
    // fire detection: a fire is flagged when the scan spot sweeps over it, if it's hot/big enough for this instrument
    const prevX = s.lastX; s.lastX = x;
    for (const f of fires) {
      const a = f.v.dot(along), c = f.v.dot(cross);
      // each sweep covers the strip the satellite advanced since the last one, so the swath has no gaps (like the real scan)
      const halfStrip = (Math.PI * 2 / ORBIT_S) * s.scanDraw * 0.5 + 0.004;
      if (Math.abs(a) > halfStrip || f.seen[s.k] || prevX == null) continue;
      const swept = prevX <= x ? (c >= prevX && c <= x) : (c >= prevX || c <= x);
      if (swept && Math.abs(c) <= s.halfW && f.intensity >= s.detect) detect(f, s);
    }
    // a new pass over the region starts: clear the flags so each pass detects afresh
    const wrapped = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (wrapped > Math.PI * 0.9 && wrapped < Math.PI * 1.1 && s.count) { s.count = 0; fires.forEach((f) => { f.seen[s.k] = false; colorFire(f); }); }
  }
  // pulses
  for (const f of fires) for (const pl of f.pulse) { pl.t += dt; pl.m.scale.setScalar(1 + pl.t * 6); pl.m.material.opacity = Math.max(0, 0.9 - pl.t * 0.9); }
  $("#lab-n-modis").textContent = sats.modis?.count ?? 0; $("#lab-n-viirs").textContent = sats.viirs?.count ?? 0;
  syncDiagram();
}
function colorFire(f) {
  const c = f.seen.modis && f.seen.viirs ? 0xffffff : f.seen.viirs ? 0xff3355 : f.seen.modis ? 0xffb020 : 0x5a4a4c;
  f.mesh.material.color.setHex(c);
}
function detect(f, s) {
  f.seen[s.k] = true; s.count++; colorFire(f);
  const ring = new T.Mesh(new T.RingGeometry(0.006, 0.008, 32), new T.MeshBasicMaterial({ color: s.col, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
  ring.position.copy(f.v.clone().multiplyScalar(1.004)); ring.lookAt(f.v.clone().multiplyScalar(2)); scene.add(ring);
  const pl = { m: ring, t: 0 }; f.pulse.push(pl);
  setTimeout(() => { scene.remove(ring); f.pulse.splice(f.pulse.indexOf(pl), 1); }, 1100);
  if (s.k === inst) flashDetector();
}

// labels that follow the satellites
function labels() {
  const box = $("#lab-labels"), r = renderer.domElement.getBoundingClientRect();
  for (const s of Object.values(sats)) {
    let el = box.querySelector(`[data-k="${s.k}"]`);
    if (!el) { el = document.createElement("div"); el.dataset.k = s.k; el.className = "lab-tag"; el.innerHTML = `<b>${s.name}</b><span>${s.host} · ${s.altKm} km</span>`; el.style.setProperty("--c", COLOR[s.k]); box.append(el); }
    const v = s.group.position.clone().project(camera);
    const behind = s.group.position.clone().normalize().dot(camera.position.clone().normalize()) < 0.15;
    el.style.transform = `translate(${(v.x + 1) / 2 * r.width}px, ${(1 - v.y) / 2 * r.height}px)`;
    el.style.opacity = behind ? 0 : 1;
  }
}

// ------------------------------------------------------------------ camera
function focusOn(k, instant) {
  focus = k;
  $$(".lab-controls [data-focus]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.focus === k)));
  if (k === "both") {
    const side = new T.Vector3().crossVectors(regionVec, new T.Vector3(0, 1, 0)).normalize();
    const to = regionVec.clone().multiplyScalar(2.35).add(side.multiplyScalar(0.55)).add(new T.Vector3(0, 0.35, 0));
    if (instant) camera.position.copy(to); else camTarget = to;
    controls.target.copy(regionVec.clone().multiplyScalar(0.9));
  }
}
let camTarget = null;
function followCam() {
  if (focus !== "both" && sats[focus]) {
    const s = sats[focus], p = s.group.position;
    const back = new T.Vector3().crossVectors(s.axis, p.clone().normalize()).normalize().multiplyScalar(-0.35);
    const want = p.clone().multiplyScalar(1.28).add(back);
    camera.position.lerp(want, 0.06); controls.target.lerp(p.clone().multiplyScalar(0.96), 0.12);
  } else if (camTarget) { camera.position.lerp(camTarget, 0.06); if (camera.position.distanceTo(camTarget) < 0.01) camTarget = null; }
}

function resize() {
  if (!renderer) return;
  const el = $("#lab-scene"), w = el.clientWidth, h = el.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function loop(now) {
  if (modal.hidden) { raf = 0; return; }
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  if (running && !reduce) step(dt); else if (!running) syncDiagram();
  followCam(); controls.update(); renderer.render(scene, camera); labels();
  raf = requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ instrument diagrams (optical path)
const PARTS = {
  modis: {
    title: "MODIS · Moderate Resolution Imaging Spectroradiometer",
    facts: [["flies on", "Terra (1999) · Aqua (2002)"], ["swath", "2,330 km"], ["scan", "one mirror sweep every 1.477 s"], ["bands · detectors", "36 bands · 490 detectors"], ["fire bands", "21/22 (3.96 µm) + 31 (11 µm)"], ["fire pixel", "~1 km"]],
    scan: { label: "double-sided scan mirror", text: "A two-sided mirror spins at 20.3 rpm. Each face sweeps the view ±55° across the satellite's path, so every 1.477 s MODIS records a 10 km-long strip of the 2,330 km swath." },
    optics: { label: "telescope + beam splitters", text: "Light from the scan mirror goes through an off-axis telescope (two curved mirrors) and fold optics. Dichroic beam splitters then send each wavelength range to its own focal plane." },
    detect: { label: "4 focal planes · 490 detectors", text: "Visible, near-IR, shortwave/midwave-IR and longwave-IR focal planes. The infrared ones are cooled to about 83 K by a radiative cooler. Fires stand out in band 21/22 (3.96 µm), where a hot fire glows far brighter than the land around it; band 31 (11 µm) is the background check." },
    fpa: [["VIS", "0.4–0.6 µm", "#9DB8FF"], ["NIR", "0.6–1 µm", "#C59BFF"], ["SWIR / MWIR", "band 21/22 · 3.96 µm · fire", "#FFB020"], ["LWIR · 83 K", "band 31 · 11 µm", "#FF7A6E"]],
    scanShape: "mirror",
  },
  viirs: {
    title: "VIIRS · Visible Infrared Imaging Radiometer Suite",
    facts: [["flies on", "Suomi NPP (2011) · NOAA-20 · NOAA-21"], ["swath", "3,040 km"], ["scan", "one telescope turn every 1.786 s"], ["bands · detectors", "22 bands · 16 or 32 detectors each"], ["fire bands", "I4 (3.74 µm) · M13 (4.05 µm) + I5 (11.45 µm)"], ["fire pixel", "375 m (I-bands) – 750 m"]],
    scan: { label: "rotating telescope + half-angle mirror", text: "The whole telescope rotates (33.6 rpm), sweeping the view across a 3,040 km swath. A half-angle mirror turns at half that speed so the image stays still on the detectors while the telescope spins." },
    optics: { label: "aft optics + dichroics", text: "After the half-angle mirror, aft optics focus the light and dichroic beam splitters divide it into visible/near-IR, short/midwave-IR and longwave-IR paths." },
    detect: { label: "3 focal planes · 22 bands", text: "VisNIR, S/MWIR and LWIR focal planes; the cold ones sit at about 80 K behind a passive cryoradiator. I4 (3.74 µm, 375 m pixels) and M13 (4.05 µm) catch smaller and cooler fires than MODIS; I5 (11.45 µm) is the background check." },
    fpa: [["VisNIR", "0.4–0.9 µm", "#9DB8FF"], ["S/MWIR · 80 K", "I4 3.74 µm · M13 4.05 µm · fire", "#FF3355"], ["LWIR · 80 K", "I5 11.45 µm · M15 10.8 µm", "#FF7A6E"]],
    scanShape: "rta",
  },
};

function diagramSVG(k) {
  const d = PARTS[k], n = d.fpa.length, col = COLOR[k];
  const ys = d.fpa.map((_, i) => 42 + i * (250 / n));
  const scan = d.scanShape === "mirror"
    ? `<g class="dg-part" data-part="scan" id="dg-scan-g"><g id="dg-scan" transform="rotate(0 62 172)"><rect x="34" y="168" width="56" height="8" rx="2" fill="#d8d8de"/><rect x="34" y="168" width="56" height="3" fill="#ffffff"/></g>
        <text x="62" y="152" class="dg-lbl">scan mirror</text></g>`
    : `<g class="dg-part" data-part="scan" id="dg-scan-g"><g id="dg-scan" transform="rotate(0 62 172)"><rect x="40" y="150" width="44" height="44" rx="8" fill="none" stroke="#d8d8de" stroke-width="3"/><line x1="44" y1="190" x2="80" y2="154" stroke="#fff" stroke-width="3"/></g>
        <g id="dg-ham" transform="rotate(0 130 172)"><rect x="112" y="168" width="36" height="7" rx="2" fill="#d8d8de"/></g>
        <text x="62" y="140" class="dg-lbl">rotating telescope</text><text x="130" y="198" class="dg-lbl">half-angle mirror</text></g>`;
  const optX = d.scanShape === "mirror" ? 112 : 156;
  const branches = ys.map((y, i) => `M262 172 L262 ${y + 14} L318 ${y + 14}`).join(" ");
  const photons = d.fpa.map(([, , c], i) => `<circle r="3.4" fill="${c}"><animateMotion dur="2.4s" begin="${i * 0.25}s" repeatCount="indefinite" path="M62 318 L62 172 L262 172 L262 ${ys[i] + 14} L318 ${ys[i] + 14}"/></circle>`).join("");
  return `<svg viewBox="0 0 420 330" class="dg" role="img" aria-label="${d.title} optical path">
    <defs><linearGradient id="dg-earth" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3a1a1e"/><stop offset="1" stop-color="#140a0c"/></linearGradient></defs>
    <rect x="0" y="300" width="420" height="30" fill="url(#dg-earth)"/>
    <text x="96" y="322" class="dg-lbl dg-left">Earth below · a fire emits strongly near 4 µm</text>
    <g class="dg-fire"><path d="M62 316c4-8 10-10 8-18 6 5 8 12 4 18z" fill="${col}"/></g>
    <path class="dg-ray" d="M62 300 L62 180" stroke="${col}"/>
    ${scan}
    <g class="dg-part" data-part="optics">
      <path class="dg-ray" d="M90 172 L262 172" stroke="#fff"/>
      <path d="M${optX} 150 q14 22 0 44" fill="none" stroke="#d8d8de" stroke-width="4"/><path d="M${optX + 40} 160 q-9 12 0 24" fill="none" stroke="#d8d8de" stroke-width="3"/>
      <text x="${optX + 22}" y="142" class="dg-lbl">telescope</text>
      ${ys.map((y) => `<line x1="252" y1="${y + 24}" x2="272" y2="${y + 4}" stroke="#9fd3ff" stroke-width="3" opacity=".85"/>`).join("")}
      <text x="262" y="${ys[n - 1] + 46}" class="dg-lbl">dichroic beam splitters</text>
      <path class="dg-ray dg-branch" d="${branches}" stroke="#fff"/>
    </g>
    <g class="dg-part" data-part="detect">
      ${d.fpa.map(([nm, band, c], i) => `<g class="dg-fpa" id="dg-fpa-${i}"><rect x="318" y="${ys[i]}" width="92" height="30" rx="6" fill="#1b1012" stroke="${c}" stroke-width="1.5"/>
        ${Array.from({ length: 8 }, (_, j) => `<rect class="dg-det" x="${324 + j * 10}" y="${ys[i] + 18}" width="7" height="7" fill="${c}" opacity=".35"/>`).join("")}
        <text x="324" y="${ys[i] + 12}" class="dg-fpa-n">${nm}</text><text x="410" y="${ys[i] - 4}" class="dg-band">${band}</text></g>`).join("")}
    </g>
    ${photons}
  </svg>`;
}
function renderInstrument(k) {
  inst = k;
  $$(".lab-tabs [data-inst]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.inst === k)));
  $("#lab-diagram").innerHTML = diagramSVG(k);
  $("#lab-diagram").style.setProperty("--c", COLOR[k]);
  const d = PARTS[k];
  $("#lab-facts").innerHTML = `<h3>${d.title}</h3><dl>${d.facts.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>`;
  setPart(part || "scan");
}
function setPart(p) {
  part = p;
  $$(".lab-parts [data-part]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.part === p)));
  $$("#lab-diagram .dg-part").forEach((g) => g.classList.toggle("on", g.dataset.part === p));
  const info = PARTS[inst][p];
  $("#lab-info").innerHTML = `<b>${info.label}</b><p>${info.text}</p>`;
  // echo the chosen part in the 3D scene: scan line, beam/fan, or the fire flags
  for (const s of Object.values(sats)) {
    const me = s.k === inst;
    s.stripe.material.opacity = p === "scan" && me ? 1 : 0.55;
    s.beam.material.opacity = p === "optics" && me ? 1 : 0.35;
    s.fan.material.opacity = p === "optics" && me ? 0.16 : 0.05;
  }
}
// keep the drawn scan mirror / telescope turning in step with the scan in the 3D scene
function syncDiagram() {
  const s = sats[inst]; if (!s) return;
  const a = (s.scanPhase || 0) * (inst === "modis" ? 180 : 360);
  $("#dg-scan")?.setAttribute("transform", `rotate(${a} 62 172)`);
  $("#dg-ham")?.setAttribute("transform", `rotate(${a / 2} 130 172)`);
}
let flashT;
function flashDetector() {
  const fireIdx = inst === "modis" ? 2 : 1;
  const g = $(`#dg-fpa-${fireIdx}`); if (!g) return;
  g.classList.add("hit"); clearTimeout(flashT); flashT = setTimeout(() => g.classList.remove("hit"), 500);
}

// ------------------------------------------------------------------ open / close
async function open(k = "both") {
  modal.hidden = false;
  window.FireCAD?.close?.();
  renderInstrument(k === "viirs" ? "viirs" : "modis");
  if (!built) { building ||= build(); await building; renderInstrument(inst); }
  resize(); focusOn(k === "both" ? "both" : k, true);
  if (k !== "both") { const s = sats[k]; if (s) camera.position.copy(s.group.position.clone().multiplyScalar(1.6)); }
  last = 0; if (!raf) raf = requestAnimationFrame(loop);
}
function close() { modal.hidden = true; }

$("#lab-x").addEventListener("click", close);
modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });
$("#lab-play").addEventListener("click", () => { running = !running; $("#lab-play").textContent = running ? "pause" : "play"; });
$("#lab-speed").addEventListener("change", (e) => { warp = +e.target.value; });
$$(".lab-controls [data-focus]").forEach((b) => b.addEventListener("click", () => built && focusOn(b.dataset.focus)));
$$(".lab-tabs [data-inst]").forEach((b) => b.addEventListener("click", () => renderInstrument(b.dataset.inst)));
$$(".lab-parts [data-part]").forEach((b) => b.addEventListener("click", () => setPart(b.dataset.part)));

// _advance(seconds): steps the simulation without drawing (used for testing when the page isn't visible)
window.FireLab = { open, close, _advance: (sec) => { for (let i = 0; i < sec * 60; i++) step(1 / 60); return { modis: sats.modis?.count, viirs: sats.viirs?.count, t: +simT.toFixed(1) }; } };
