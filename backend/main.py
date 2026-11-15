"""Helios API + static frontend.  Run:  python run.py"""
import calendar as cal
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Optional

import ee
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import config, ee_client
from . import layers as L

log = logging.getLogger("firescout")
app = FastAPI(title="Helios")

_cache: dict = {}
SENSOR = "^(modis|viirs|harmonized)$"
DAY_HISTORY = 24 * 3600


def cached(key, fn, ttl=config.CACHE_SECONDS):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


# ---- disk cache: finished months never change, so they are fetched from Earth Engine once, ever ----------
_DISK_FILE = config.ROOT / ".cache" / "firescout_cache.json"
_disk_lock = threading.Lock()
_disk_timer = None
try:
    _disk = json.loads(_DISK_FILE.read_text(encoding="utf-8"))
except (OSError, ValueError):
    _disk = {}


def _disk_flush():
    global _disk_timer
    with _disk_lock:
        _disk_timer = None
        data = json.dumps(_disk, separators=(",", ":"))
    try:
        _DISK_FILE.parent.mkdir(exist_ok=True)
        tmp = _DISK_FILE.with_suffix(".tmp")
        tmp.write_text(data, encoding="utf-8")
        os.replace(tmp, _DISK_FILE)
    except OSError as exc:
        log.warning("could not save the cache: %s", exc)


def disk_cached(key: str, fn):
    """Like cached(), but kept on disk across restarts. Only use for data that can't change any more."""
    global _disk_timer
    with _disk_lock:
        if key in _disk:
            return _disk[key]
    value = fn()
    with _disk_lock:
        _disk[key] = value
        if _disk_timer is None:                     # batch writes: save at most every 2 seconds
            _disk_timer = threading.Timer(2.0, _disk_flush)
            _disk_timer.daemon = True
            _disk_timer.start()
    return value


def finished(last_day: date) -> bool:
    """True once a period is safely in the past (near-real-time fire data can still arrive for ~a week)."""
    return last_day < date.today() - timedelta(days=8)


def require_ee():
    try:
        ee_client.ensure()
    except ee_client.EENotReady as exc:
        raise HTTPException(503, str(exc)) from exc


def check_dates(start: str, end: str, max_days: int = 40):
    try:
        s, e = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(400, "Dates must look like 2025-01-14.") from exc
    if e < s or (e - s).days > max_days:
        raise HTTPException(400, f"Date window must be between 1 and {max_days} days.")
    if e > date.today():
        raise HTTPException(400, "That date is in the future.")


def safe(fn):
    """Run an Earth Engine call; return None instead of failing the whole request."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        log.warning("Earth Engine call failed: %s", exc)
        return None


# ---- area of interest: a circle (pin + radius) or a drawn polygon --------------------
def parse_geom(geom: Optional[str]):
    """`geom` is a JSON list of [lon, lat] points (a polygon drawn on the map)."""
    if not geom:
        return None
    try:
        pts = json.loads(geom)
        pts = [[float(p[0]), float(p[1])] for p in pts]
    except (ValueError, TypeError, IndexError) as exc:
        raise HTTPException(400, "The drawn area could not be read.") from exc
    if not 3 <= len(pts) <= 300 or any(not (-180 <= x <= 180 and -90 <= y <= 90) for x, y in pts):
        raise HTTPException(400, "The drawn area needs 3 to 300 points on the globe.")
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts


def region_of(lat, lon, radius_km, pts, cap_km=None):
    if pts:
        return ee.Geometry.Polygon([pts], None, False)
    return ee.Geometry.Point([lon, lat]).buffer((min(radius_km, cap_km) if cap_km else radius_km) * 1000)


def area_key(lat, lon, radius_km, pts):
    if pts:
        return "poly:" + hashlib.sha1(json.dumps(pts).encode()).hexdigest()[:16]
    return f"circle:{round(lat, 3)}:{round(lon, 3)}:{radius_km}"


GEOM = Query(None, max_length=20000, description="JSON list of [lon, lat] points for a drawn area")


# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    try:
        ee_client.ensure()
        return {"ok": True, "project": config.EE_PROJECT}
    except ee_client.EENotReady as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/meta")
def meta():
    return L.META


@app.get("/api/tiles/{layer}", dependencies=[Depends(require_ee)])
def tiles(
    layer: str,
    start: str,
    end: str,
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    sensor: str = Query("modis", pattern=SENSOR),
    geom: Optional[str] = GEOM,
):
    if layer not in L.VIS:
        raise HTTPException(404, "Unknown layer.")
    check_dates(start, end)
    pts = parse_geom(geom)
    if layer == "burn" and not pts and (lat is None or lon is None):
        raise HTTPException(400, "Click the globe to choose an area for burn scars.")
    # harmonized draws MODIS and VIIRS together (before 2012 only MODIS exists, so only red appears)
    key_sensor = sensor

    key = ("tiles", layer, start, end,
           area_key(lat, lon, radius_km, pts) if layer == "burn" else None,
           key_sensor if layer == "fire" else None)

    def build():
        if layer == "so2":
            if L.so2_collection(start, end).size().getInfo() == 0:
                raise HTTPException(404, "No sulfur dioxide data for this window yet. Try an earlier date.")
            img = L.so2_tile_image(start, end)
        elif layer == "fire":
            probe = "modis" if sensor == "harmonized" else sensor
            if L.fire_collection(start, end, probe).size().getInfo() == 0 and (
                    sensor != "harmonized" or L.fire_collection(start, end, "viirs").size().getInfo() == 0):
                raise HTTPException(404, "No fire data for this window yet. Try an earlier date.")
            img = L.fire_tile_coded(start, end, sensor)
        else:
            region = region_of(lat, lon, radius_km, pts)
            (_, _), (post_a, post_b) = L.burn_windows(end)
            if L.s2_collection(region, post_a, post_b).size().getInfo() == 0:
                raise HTTPException(404, "No clear Sentinel-2 images in the 30 days before this date.")
            img = L.burn_tile_image(region, end)
        try:
            vis = L.FIRE_VIS[sensor] if layer == "fire" else L.VIS[layer]
            return img.getMapId(vis)["tile_fetcher"].url_format
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc

    return {"url": cached(key, build), "sensor": sensor}


def _calendar(region, akey, sensor, year, month):
    """Daily counts for one month; 'harmonized' months switch from MODIS to VIIRS on VIIRS's first day."""
    first, last = date(year, month, 1), date(year, month, cal.monthrange(year, month)[1])

    def one(s):
        build = lambda: {"sensor": s, "year": year, "month": month, "days": L.fire_calendar(region, year, month, s)}
        if finished(last):
            return disk_cached(f"cal|{s}|{year}-{month:02d}|{akey}", build)
        return cached(("fire_calendar", s, year, month, akey), build)

    if sensor != "harmonized":
        res = one(sensor)
        return [{**d, "source": sensor.upper()} for d in res["days"]]
    if last < L.VIIRS_FIRST:
        return [{**d, "source": "MODIS"} for d in one("modis")["days"]]
    if first >= L.VIIRS_FIRST:
        return [{**d, "source": "VIIRS"} for d in one("viirs")["days"]]
    mo, vi = one("modis")["days"], one("viirs")["days"]
    return [({**v, "source": "VIIRS"} if date.fromisoformat(v["date"]) >= L.VIIRS_FIRST else {**m, "source": "MODIS"})
            for m, v in zip(mo, vi)]


@app.get("/api/fire_calendar", dependencies=[Depends(require_ee)])
def fire_calendar(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    sensor: str = Query("modis", pattern=SENSOR),
    geom: Optional[str] = GEOM,
):
    first = date.fromisoformat(L.FIRE_DATASETS["modis" if sensor == "harmonized" else sensor]["first"])
    if date(year, month, cal.monthrange(year, month)[1]) < first:
        raise HTTPException(400, f"{sensor.upper()} records start {first.isoformat()}.")
    if date(year, month, 1) > date.today():
        raise HTTPException(400, "This month is in the future.")
    pts = parse_geom(geom)
    region = region_of(lat, lon, radius_km, pts)
    days = _calendar(region, area_key(lat, lon, radius_km, pts), sensor, year, month)
    return {"sensor": sensor, "year": year, "month": month, "days": days}


@app.get("/api/insights", dependencies=[Depends(require_ee)])
def insights(
    start: str,
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    sensor: str = Query("modis", pattern=SENSOR),
    geom: Optional[str] = GEOM,
    include_burn: bool = Query(True, description="false = skip burned area (fetch it from /api/burned instead)"),
):
    check_dates(start, end)
    pts = parse_geom(geom)
    used = L.resolve_sensor(sensor, end)

    def build():
        region = region_of(lat, lon, radius_km, pts)
        burn_region = region_of(lat, lon, radius_km, pts, cap_km=150)
        base_start, base_end = L.plus(start, -30), L.plus(start, -1)
        jobs = {
            "so2": lambda: L.so2_mean_du(region, start, end),
            "base": lambda: L.so2_mean_du(region, base_start, base_end),
            "fire": lambda: L.fire_pixel_count(region, start, end, "harmonized" if sensor == "harmonized" else used),
        }
        if include_burn:
            jobs["burn"] = lambda: L.burned_hectares(burn_region, end, min(radius_km, 150))
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {k: pool.submit(safe, fn) for k, fn in jobs.items()}
            r = {k: f.result() for k, f in futures.items()}

        ratio = r["so2"] / r["base"] if r["so2"] is not None and r["base"] and r["base"] > 0 else None
        level, reason = classify(r["fire"], ratio)
        return {
            "fire_pixels": r["fire"], "so2_du": r["so2"], "so2_baseline_du": r["base"],
            "so2_ratio": ratio, "burned_ha": r.get("burn"),
            "signal": level, "signal_reason": reason, "sensor": sensor, "sensor_used": used,
        }

    return cached(("ins", start, end, area_key(lat, lon, radius_km, pts), used, include_burn), build)


@app.get("/api/burned", dependencies=[Depends(require_ee)])
def burned(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    geom: Optional[str] = GEOM,
):
    """Burned hectares on its own, so the faster fire and SO2 numbers don't have to wait for it."""
    check_dates(L.plus(end, -1), end)
    pts = parse_geom(geom)

    def build():
        return {"burned_ha": safe(lambda: L.burned_hectares(region_of(lat, lon, radius_km, pts, cap_km=150), end, min(radius_km, 150)))}

    return cached(("burn", end, area_key(lat, lon, radius_km, pts)), build)


def classify(fire, ratio):
    fire = fire or 0
    if fire >= config.ALERT_MIN_FIRE_PIXELS and ratio and ratio >= config.ALERT_SO2_RATIO:
        return "alert", f"Last 7 days: {fire} fire pixels and sulfur dioxide at {ratio:.1f} times the usual level."
    if fire >= config.WATCH_FIRE_PIXELS:
        return "watch", f"Last 7 days: {fire} fire pixels in this area."
    if ratio and ratio >= config.WATCH_SO2_RATIO:
        return "watch", f"Last 7 days: sulfur dioxide at {ratio:.1f} times the usual level."
    return "none", "Nothing unusual in the last 7 days."


@app.get("/api/hotspots", dependencies=[Depends(require_ee)])
def hotspots(
    start: str,
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    sensor: str = Query("modis", pattern=SENSOR),
    confidence: str = Query("all", pattern="^(all|nominal|high)$"),
    geom: Optional[str] = GEOM,
    limit: int = Query(50000, ge=1, le=50000),
):
    """Filtered hotspot records (one row per fire pixel per day) for any range up to a year.
    The range is fetched in month-sized chunks (Earth Engine returns at most 5,000 rows per request)."""
    check_dates(start, end, max_days=366)
    pts = parse_geom(geom)
    s, e = date.fromisoformat(start), date.fromisoformat(end)

    chunks, a = [], s
    while a <= e:
        b = min(e, a + timedelta(days=30))
        if sensor == "harmonized" and a < L.VIIRS_FIRST <= b:   # split at the MODIS -> VIIRS hand-over
            b = L.VIIRS_FIRST - timedelta(days=1)
        chunks.append((a, b, L.resolve_sensor(sensor, a)))
        a = b + timedelta(days=1)

    def build():
        region = region_of(lat, lon, radius_km, pts)

        def one(c):
            a_, b_, s_ = c
            return L.hotspot_records(region, a_.isoformat(), b_.isoformat(), s_, confidence, 5000)

        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                parts = list(pool.map(one, chunks))
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc
        rows = [r for p in parts for r in p]
        truncated = any(len(p) >= 5000 for p in parts) or len(rows) > limit
        return {"sensor": sensor, "start": start, "end": end, "confidence": confidence,
                "truncated": truncated, "records": rows[:limit]}

    return cached(("hotspots", start, end, area_key(lat, lon, radius_km, pts), sensor, confidence, limit), build)


@app.get("/api/monthly_summary", dependencies=[Depends(require_ee)])
def monthly_summary(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    months: int = Query(12, ge=1, le=24),
    geom: Optional[str] = GEOM,
):
    """MODIS and VIIRS monthly summaries on one shared schema, for the months up to `end`."""
    try:
        e = date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(400, "Dates must look like 2025-01-14.") from exc
    if e > date.today():
        raise HTTPException(400, "That date is in the future.")
    pts = parse_geom(geom)
    akey = area_key(lat, lon, radius_km, pts)

    ym = []
    y, m = e.year, e.month
    for _ in range(months):
        ym.append((y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    ym.reverse()

    def one(sensor, y, m):
        first = date.fromisoformat(L.FIRE_DATASETS[sensor]["first"])
        if date(y, m, cal.monthrange(y, m)[1]) < first:
            row = L.summarize_month([], y, m, sensor)
            row["note"] = f"before {sensor.upper()} record start ({first.isoformat()})"
            return row
        res = safe(lambda: _calendar(region_of(lat, lon, radius_km, pts), akey, sensor, y, m))
        row = L.summarize_month(res or [], y, m, sensor)
        row["note"] = "" if res is not None else "earth engine request failed"
        return row

    jobs = [(s, y, m) for (y, m) in ym for s in ("modis", "viirs")]
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(lambda j: one(*j), jobs))
    area = "drawn polygon" if pts else f"{round(lat, 4)}, {round(lon, 4)} ± {radius_km} km"
    for r in rows:
        r["area"] = area
    return {"months": [f"{y}-{m:02d}" for y, m in ym], "rows": rows}


@app.get("/api/history", dependencies=[Depends(require_ee)])
def history(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    geom: Optional[str] = GEOM,
    current: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$", description="month to compare with its history"),
):
    """Harmonised MODIS + VIIRS monthly hotspot record, Nov 2000 → last month with data, plus anomalies."""
    pts = parse_geom(geom)
    akey = area_key(lat, lon, radius_km, pts)
    latest = date.today() - timedelta(days=3)

    def build():
        region = region_of(lat, lon, radius_km, pts)
        months = []
        y, m = 2000, 11
        while (y, m) <= (latest.year, latest.month):
            months.append(f"{y}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

        # one Earth Engine request per sensor-year, run in parallel
        jobs = []
        for sensor in ("modis", "viirs"):
            first = date.fromisoformat(L.FIRE_DATASETS[sensor]["first"])
            for year in range(first.year, latest.year + 1):
                start_m = first.month if year == first.year else 1
                end_m = latest.month if year == latest.year else 12
                if year == latest.year and end_m > start_m:            # this year: past months (cacheable) + this month
                    jobs.append((sensor, date(year, start_m, 1), end_m - start_m))
                    jobs.append((sensor, date(year, end_m, 1), 1))
                else:
                    jobs.append((sensor, date(year, start_m, 1), end_m - start_m + 1))

        def run(job):
            sensor, start, n = job
            last_m = start.month + n - 1
            last_day = date(start.year, last_m, cal.monthrange(start.year, last_m)[1])
            fetch = lambda: L.monthly_counts(region, sensor, start, n)
            if finished(last_day):
                return sensor, safe(lambda: disk_cached(f"mc|{sensor}|{start.isoformat()}|{n}|{akey}", fetch)) or {}
            return sensor, safe(fetch) or {}

        out = {"modis": {}, "viirs": {}}
        with ThreadPoolExecutor(max_workers=8) as pool:
            for sensor, part in pool.map(run, jobs):
                out[sensor].update(part)
        return months, out

    months, counts = cached(("history", akey), build, ttl=DAY_HISTORY)
    cur = current or months[-1]
    res = L.harmonize(months, counts["modis"], counts["viirs"], cur)
    res["area"] = "drawn polygon" if pts else {"lat": lat, "lon": lon, "radius_km": radius_km}
    return res


@app.get("/api/so2_series", dependencies=[Depends(require_ee)])
def so2_series(
    end: str,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: int = Query(150, ge=5, le=300),
    days: int = Query(30, ge=7, le=60),
    geom: Optional[str] = GEOM,
):
    check_dates(L.plus(end, -6), end)
    pts = parse_geom(geom)

    def build():
        region = region_of(lat, lon, radius_km, pts)
        try:
            return L.so2_daily_du(region, end, days)
        except ee.EEException as exc:
            raise HTTPException(502, f"Earth Engine error: {exc}") from exc

    return cached(("series", end, area_key(lat, lon, radius_km, pts), days), build)


# Browsers must re-check the page files (html/js/css) on every visit, so updates show up right away
# instead of an old cached copy. Videos and images can be cached for a day.
@app.middleware("http")
async def cache_headers(request, call_next):
    resp = await call_next(request)
    path = request.url.path
    if not path.startswith("/api/"):
        resp.headers["Cache-Control"] = "public, max-age=86400" if path.startswith("/media/") else "no-cache"
    return resp


# Serve the web app from the same server (no CORS, one command to run).
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
