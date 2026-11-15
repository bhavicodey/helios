"use strict";
(function () {
  const $ = (s) => document.querySelector(s);
  const COLORS = { modis: "#E5383B", viirs: "#FFD60A" };
  const DAYS = 365, SECONDS = 26, LIFE = 26;
  const btn = $("#tl-btn"), hud = $("#tl-hud");
  let raf = 0, running = false, loading = false, points = [], t0 = 0, startMs = 0, token = 0;

  function ensureLayer() {
    if (!map.getSource("tl-fires")) map.addSource("tl-fires", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!map.getLayer("tl-fires")) {
      map.addLayer({
        id: "tl-fires", type: "circle", source: "tl-fires",
        paint: {
          "circle-color": ["match", ["get", "sat"], "modis", COLORS.modis, COLORS.viirs],
          "circle-radius": ["interpolate", ["linear"], ["get", "age"], 0, 11, 0.08, 6, 1, 2.5],
          "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 1, 1, 0.12],
          "circle-blur": ["interpolate", ["linear"], ["get", "age"], 0, 0.7, 1, 0],
        },
      });
    }
  }

  function clearLayer() {
    map.getSource("tl-fires")?.setData({ type: "FeatureCollection", features: [] });
  }

  function setHud(state) {
    hud.hidden = false;
    hud.dataset.state = state;
  }

  function stop() {
    cancelAnimationFrame(raf); raf = 0; running = false; token++;
    clearLayer(); hud.hidden = true;
    btn.disabled = !state.pin; btn.textContent = "time-lapse";
  }

  async function load() {
    const end = iso(state.end), start = iso(state.end - (DAYS - 1) * DAY), area = areaParams();
    const jobs = [["modis", api("hotspots", { ...area, start, end, sensor: "modis", confidence: "all" })]];
    if (state.end >= Date.UTC(2012, 1, 1)) jobs.push(["viirs", api("hotspots", { ...area, start, end, sensor: "viirs", confidence: "all" })]);
    const results = await Promise.all(jobs.map(([sat, p]) => p.then((r) => r.records.map((x) => ({ sat, lat: x.latitude, lon: x.longitude, t: Date.parse(x.date + "T12:00:00Z") })))));
    return results.flat().filter((p) => Number.isFinite(p.t) && p.lat != null && p.lon != null).sort((a, b) => a.t - b.t);
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    const day = Math.min(DAYS, ((now - t0) / 1000) / SECONDS * DAYS), cur = startMs + day * DAY;
    const feats = []; let m = 0, v = 0;
    for (const p of points) {
      if (p.t > cur) break;
      if (p.sat === "modis") m++; else v++;
      const age = (cur - p.t) / (LIFE * DAY);
      if (age < 1) feats.push({ type: "Feature", properties: { sat: p.sat, age }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
    }
    map.getSource("tl-fires")?.setData({ type: "FeatureCollection", features: feats });
    $("#tl-date").textContent = fmt(cur);
    $("#tl-n-modis").textContent = m.toLocaleString(); $("#tl-n-viirs").textContent = v.toLocaleString();
    $("#tl-bar").style.width = `${day / DAYS * 100}%`;
    if (day >= DAYS) {
      running = false; setHud("done"); btn.disabled = false; btn.textContent = "replay";
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  async function start() {
    if (!state.pin || loading) return;
    if (running) { stop(); return; }
    window.FirePasses?.stop?.();
    const mine = ++token;
    loading = true; btn.disabled = true; btn.textContent = "loading…";
    setHud("loading");
    $("#tl-date").textContent = "loading a year of fires…";
    $("#tl-n-modis").textContent = "0"; $("#tl-n-viirs").textContent = "0"; $("#tl-bar").style.width = "0%";
    try {
      const data = await load();
      if (mine !== token) return;
      if (!data.length) { toast("no fires found here in the last year."); stop(); return; }
      points = data; startMs = state.end - (DAYS - 1) * DAY;
      ensureLayer(); setHud("playing");
      running = true; btn.textContent = "stop"; btn.disabled = false;
      t0 = performance.now(); raf = requestAnimationFrame(frame);
    } catch (err) {
      if (mine === token) { toast("couldn't load the time-lapse. try again."); stop(); }
    } finally { loading = false; }
  }

  btn.addEventListener("click", start);
  $("#tl-stop").addEventListener("click", stop);
  addEventListener("firescout:area", () => { if (running || hud.hidden === false) stop(); btn.disabled = !state.pin; });
  btn.disabled = !state.pin;
})();
