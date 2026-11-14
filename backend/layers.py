"""Earth Engine layer builders.

Everything here returns lazy ee objects; nothing is computed until .getInfo() or getMapId().
Date windows are inclusive of both start and end (ISO strings, YYYY-MM-DD).
"""
from datetime import date, timedelta

import ee

DU = 4.4615e-4  # mol/m2 in one Dobson unit
SO2_BAND = "SO2_column_number_density"
SO2_MIN, SO2_MAX = 0.0001, 0.0008  # mol/m2 display range

VIS = {
    # red giant theme (dark map): rose haze for gas, hot orange-white for fire, deep crimson for burn scars
    "so2": {"min": SO2_MIN, "max": SO2_MAX,
            "palette": ["#3A1A26", "#6E2A47", "#A8456F", "#E07A9E", "#FFC2D4"]},
    "fire": {"min": 0, "max": 1,
             "palette": ["#FFB36B", "#FF7A3D", "#FF5A2B", "#FF3D2E"]},   # hotspots are 1s, so they draw in the last color
    "burn": {"min": 0.1, "max": 1.0,
             "palette": ["#3D0A14", "#6E0F22", "#A3132F", "#D61F3C"]},
}

META = {
    "so2": {"title": "Sulfur dioxide", "palette": VIS["so2"]["palette"],
            "legend_min": f"{SO2_MIN / DU:.1f} DU", "legend_max": f"{SO2_MAX / DU:.1f} DU"},
    "fire": {"title": "Active fires", "palette": VIS["fire"]["palette"],
             "legend_min": "Fire detected", "legend_max": "Hotspot"},
    "burn": {"title": "Burn scars", "palette": VIS["burn"]["palette"],
             "legend_min": "Low severity", "legend_max": "High severity"},
}


# ---- small helpers ----------------------------------------------------------
def _d(s: str) -> date:
    return date.fromisoformat(s)


def plus(s: str, days: int) -> str:
    return (_d(s) + timedelta(days=days)).isoformat()


def _empty(band: str) -> ee.Image:
    return ee.Image.constant(0).rename(band).selfMask()


# ---- 1. Sulfur dioxide (Sentinel-5P) ------------------------------------------
def so2_collection(start: str, end: str) -> ee.ImageCollection:
    recent = (date.today() - _d(end)).days < 10
    name = "COPERNICUS/S5P/NRTI/L3_SO2" if recent else "COPERNICUS/S5P/OFFL/L3_SO2"
    return (ee.ImageCollection(name)
            .filterDate(start, plus(end, 1))
            .map(lambda i: i.updateMask(i.select("cloud_fraction").lt(0.3)))
            .select(SO2_BAND))


def so2_image(start: str, end: str) -> ee.Image:
    col = so2_collection(start, end)
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.median(), _empty(SO2_BAND)))


def so2_tile_image(start: str, end: str) -> ee.Image:
    img = so2_image(start, end)
    return img.updateMask(img.gte(SO2_MIN))


def so2_mean_du(region, start: str, end: str):
    v = so2_image(start, end).reduceRegion(ee.Reducer.mean(), region, 5000, maxPixels=1e9).get(SO2_BAND)
    v = v.getInfo()
    return None if v is None else v / DU


def so2_daily_du(region, end: str, days: int = 30):
    start = plus(end, -(days - 1))
    col = so2_collection(start, end)
    start_d = ee.Date(start)

    def per_day(i):
        d0 = start_d.advance(ee.Number(i), "day")
        sub = col.filterDate(d0, d0.advance(1, "day"))
        val = ee.Algorithms.If(
            sub.size().gt(0),
            sub.mean().reduceRegion(ee.Reducer.mean(), region, 5000, maxPixels=1e9).get(SO2_BAND),
            -9999,
        )
        return ee.Feature(None, {"t": d0.format("YYYY-MM-dd"), "v": val})

    rows = ee.FeatureCollection(ee.List.sequence(0, days - 1).map(per_day)).getInfo()["features"]
    out = []
    for r in rows:
        v = r["properties"].get("v")
        out.append({"t": r["properties"]["t"], "v": None if v is None or v == -9999 else v / DU})
    return out


# ---- 2. Active fires (NASA FIRMS) -----------------------------------------------
FIRE_DATASETS = {
    "modis": {"id": "FIRMS", "first": "2000-11-01", "description": "MODIS FIRMS (~1 km)"},
    "viirs": {"id": "NASA/VIIRS/002/VNP14A1", "first": "2012-01-19", "description": "VIIRS VNP14A1 daily 1 km composite"},
}


def fire_collection(start: str, end: str, sensor: str = "modis") -> ee.ImageCollection:
    """Choose one consistent active-fire product per request."""
    ds = FIRE_DATASETS[sensor]
    return ee.ImageCollection(ds["id"]).filterDate(start, plus(end, 1))


def fire_detection(img: ee.Image, sensor: str) -> ee.Image:
    if sensor == "viirs":
        # VNP14A1 classes 7/8/9 are low/nominal/high-confidence detections.
        mask = img.select("FireMask").gte(7)
    else:
        mask = img.select("T21").mask()
    return ee.Image.constant(1).rename("hotspot").updateMask(mask)


def fire_image(start: str, end: str, sensor: str = "modis") -> ee.Image:
    col = fire_collection(start, end, sensor)
    detections = col.map(lambda i: fire_detection(i, sensor))
    return ee.Image(ee.Algorithms.If(detections.size().gt(0), detections.max(), _empty("hotspot")))


def fire_tile_image(start: str, end: str, sensor: str = "modis") -> ee.Image:
    return fire_image(start, end, sensor).focalMax(1.5, "circle", "pixels")


def fire_pixel_count(region, start: str, end: str, sensor: str = "modis"):
    return fire_image(start, end, sensor).reduceRegion(
        ee.Reducer.count(), region, 1000, maxPixels=1e9, bestEffort=True
    ).get("hotspot").getInfo()


def fire_calendar(region, year: int, month: int, sensor: str = "modis"):
    """Daily detection-pixel counts in one requested month. Missing observations stay null."""
    import calendar
    days = calendar.monthrange(year, month)[1]
    start = date(year, month, 1).isoformat()
    end = (date(year, month, days) + timedelta(days=1)).isoformat()
    col = ee.ImageCollection(FIRE_DATASETS[sensor]["id"]).filterDate(start, end)
    start_ee = ee.Date(start)

    def daily(index):
        day = start_ee.advance(ee.Number(index), "day")
        sample = col.filterDate(day, day.advance(1, "day"))
        image = ee.Image(ee.Algorithms.If(
            sample.size().gt(0),
            sample.map(lambda i: fire_detection(i, sensor)).max(),
            _empty("hotspot"),
        ))
        count = image.reduceRegion(ee.Reducer.count(), region, 1000,
                                   maxPixels=1e9, bestEffort=True).get("hotspot")
        return ee.Feature(None, {"date": day.format("YYYY-MM-dd"),
                                 "count": ee.Algorithms.If(sample.size().gt(0),
                                                            ee.Algorithms.If(count, count, 0), None),
                                 "observations": sample.size()})

    features = ee.FeatureCollection(ee.List.sequence(0, days - 1).map(daily)).getInfo()["features"]
    return [{"date": f["properties"]["date"],
             "count": f["properties"].get("count"),
             "observations": f["properties"].get("observations", 0)} for f in features]


# ---- 3. Burn scars (Sentinel-2 dNBR) --------------------------------------------
def s2_collection(region, start: str, end: str) -> ee.ImageCollection:
    def mask(img):
        scl = img.select("SCL")
        bad = scl.eq(3).Or(scl.eq(8)).Or(scl.eq(9)).Or(scl.eq(10)).Or(scl.eq(11))
        return img.updateMask(bad.Not())

    return (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(region)
            .filterDate(start, plus(end, 1))
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80))
            .map(mask))


def burn_windows(end: str):
    """Post-fire = the 30 days up to `end`. Pre-fire = a 60-day window ending 45 days before `end`."""
    return (plus(end, -104), plus(end, -45)), (plus(end, -29), end)


def _nbr(img):
    return img.normalizedDifference(["B8", "B12"]).rename("NBR")


def dnbr_image(region, end: str) -> ee.Image:
    (pre_a, pre_b), (post_a, post_b) = burn_windows(end)
    pre = _nbr(s2_collection(region, pre_a, pre_b).median())
    post = _nbr(s2_collection(region, post_a, post_b).median())
    dnbr = pre.subtract(post).rename("dNBR")
    return dnbr.updateMask(pre.gt(0.1)).clip(region)  # only land that was green before


def burn_tile_image(region, end: str) -> ee.Image:
    img = dnbr_image(region, end)
    return img.updateMask(img.gte(0.1))


def burned_hectares(region, end: str, radius_km: float = 50):
    """Burned hectares. Sentinel-2 is 20-30 m, but adding up a 150 km circle at 30 m means ~80 million
    pixels; the sampling scale grows with the area (30 m for small areas, ~100 m at 150 km) so it stays fast.
    Area is summed with pixelArea(), so the hectare total stays comparable across scales."""
    scale = max(30, min(120, round(radius_km * 0.65)))
    img = dnbr_image(region, end)
    area = img.gt(0.27).selfMask().multiply(ee.Image.pixelArea())
    v = area.reduceRegion(ee.Reducer.sum(), region, scale, maxPixels=1e10, bestEffort=True, tileScale=4).get("dNBR")
    v = v.getInfo()
    return 0 if v is None else v / 10000


# ---- 4. Exports: filtered hotspot records + monthly summaries ---------------------
# Confidence classes, harmonised across sensors:
#   MODIS FIRMS "confidence" is 0-100  -> low < 30 <= nominal < 80 <= high
#   VIIRS VNP14A1 "FireMask" 7/8/9      -> low / nominal / high
CONFIDENCE_MIN = {
    "modis": {"all": 0, "nominal": 30, "high": 80},
    "viirs": {"all": 7, "nominal": 8, "high": 9},
}


def hotspot_records(region, start: str, end: str, sensor: str = "modis",
                    confidence: str = "all", limit: int = 5000):
    """One row per detected fire pixel per day inside `region`, filtered by confidence."""
    col = fire_collection(start, end, sensor)
    floor = CONFIDENCE_MIN[sensor][confidence]

    def per_image(img):
        img = ee.Image(img)
        if sensor == "viirs":
            conf = img.select("FireMask")
            keep = conf.gte(floor)
            extra = conf.rename("conf").addBands(img.select("MaxFRP").multiply(0.1).rename("frp"))
        else:
            conf = img.select("confidence")
            keep = img.select("T21").mask().And(conf.gte(floor))
            extra = conf.rename("conf").addBands(img.select("T21").rename("t21"))
        stack = ee.Image.pixelLonLat().addBands(extra).updateMask(keep)
        day = img.date().format("YYYY-MM-dd")
        pts = stack.sample(region=region, scale=1000, geometries=False, dropNulls=True, tileScale=4)
        return pts.map(lambda f: f.set("date", day))

    fc = ee.FeatureCollection(col.map(per_image)).flatten().sort("date").limit(limit)
    rows = []
    for f in fc.getInfo()["features"]:
        p = f["properties"]
        conf = p.get("conf")
        if sensor == "viirs":
            cls = {7: "low", 8: "nominal", 9: "high"}.get(int(conf) if conf is not None else -1, "")
        else:
            cls = "" if conf is None else ("high" if conf >= 80 else "nominal" if conf >= 30 else "low")
        rows.append({
            "date": p.get("date"),
            "latitude": round(p["latitude"], 5) if p.get("latitude") is not None else None,
            "longitude": round(p["longitude"], 5) if p.get("longitude") is not None else None,
            "sensor": sensor.upper(),
            "product": FIRE_DATASETS[sensor]["description"],
            "confidence": conf,
            "confidence_class": cls,
            "brightness_t21_k": round(p["t21"], 2) if p.get("t21") is not None else None,
            "frp_mw": round(p["frp"], 2) if p.get("frp") is not None else None,
        })
    return rows


def summarize_month(days, year: int, month: int, sensor: str):
    """Collapse one month of daily calendar counts into a harmonised summary row."""
    import calendar
    n_days = calendar.monthrange(year, month)[1]
    observed = [d for d in (days or []) if d.get("count") is not None]
    active = [d for d in observed if d["count"] > 0]
    total = sum(d["count"] for d in observed)
    peak = max(observed, key=lambda d: d["count"], default=None)
    return {
        "month": f"{year}-{month:02d}",
        "sensor": sensor.upper(),
        "product": FIRE_DATASETS[sensor]["description"],
        "grid_km": 1,
        "days_in_month": n_days,
        "days_observed": len(observed),
        "days_with_detections": len(active),
        "fire_pixel_days": total if observed else None,
        "mean_daily_pixels": round(total / len(observed), 2) if observed else None,
        "max_daily_pixels": peak["count"] if peak else None,
        "peak_date": peak["date"] if peak and peak["count"] > 0 else None,
        "active_day_share": round(len(active) / len(observed), 3) if observed else None,
    }


# ---- 5. MODIS + VIIRS harmonisation --------------------------------------------------
# Unit everywhere: "hotspot pixel-days" = detected 1 km fire pixels, summed over the days of a month.
VIIRS_FIRST = date(2012, 1, 19)


def resolve_sensor(sensor: str, day) -> str:
    """'harmonized' reads VIIRS from its first day on, and MODIS before that."""
    if sensor != "harmonized":
        return sensor
    d = _d(day) if isinstance(day, str) else day
    return "viirs" if d >= VIIRS_FIRST else "modis"


def monthly_counts(region, sensor: str, first: date, n_months: int):
    """Hotspot pixel-days per month for `n_months` months starting at `first` (1st of a month)."""
    col = ee.ImageCollection(FIRE_DATASETS[sensor]["id"])
    start = ee.Date(first.isoformat())

    def per_month(i):
        m0 = start.advance(ee.Number(i), "month")
        sub = col.filterDate(m0, m0.advance(1, "month"))
        # per pixel: on how many days of the month it was detected burning (masked days are skipped)
        img = sub.map(lambda im: fire_detection(im, sensor)).count().rename("hotspot")
        total = img.reduceRegion(ee.Reducer.sum(), region, 1000, maxPixels=1e10, tileScale=4).get("hotspot")
        return ee.Feature(None, {"month": m0.format("YYYY-MM"), "days": sub.size(),
                                 "v": ee.Algorithms.If(sub.size().gt(0), total, None)})

    feats = ee.FeatureCollection(ee.List.sequence(0, n_months - 1).map(per_month)).getInfo()["features"]
    out = {}
    for f in feats:
        p = f["properties"]
        v = p.get("v")
        out[p["month"]] = None if v is None or not p.get("days") else round(v)
    return out


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = sum((x - mx) ** 2 for x in xs) ** .5
    sy = sum((y - my) ** 2 for y in ys) ** .5
    if not sx or not sy:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def harmonize(months, modis: dict, viirs: dict, current_month: str):
    """Join both records into one VIIRS-equivalent series, then add anomalies and summary stats.

    Method: in the months where both sensors observed the area (2012 → now), the ratio of their totals
    k = sum(VIIRS) / sum(MODIS) says how many VIIRS pixel-days one MODIS pixel-day is worth here.
    Calendar months with enough overlap get their own k (fire season can change the ratio);
    the rest use the overall k. Harmonised value = VIIRS where VIIRS exists, else MODIS × k.
    """
    # VIIRS starts 19 Jan 2012, so its January 2012 is a partial month: leave it out
    viirs = {m: v for m, v in viirs.items() if m >= "2012-02"}
    overlap = [m for m in months if modis.get(m) is not None and viirs.get(m) is not None]
    sm = sum(modis[m] for m in overlap)
    sv = sum(viirs[m] for m in overlap)
    k = sv / sm if sm > 0 else 1.0
    seasonal = {}
    for mm in range(1, 13):
        ms = [m for m in overlap if int(m[5:]) == mm]
        a, b = sum(modis[m] for m in ms), sum(viirs[m] for m in ms)
        if len(ms) >= 3 and a >= 30:
            seasonal[mm] = b / a
    r = _pearson([modis[m] for m in overlap], [viirs[m] for m in overlap])

    rows = []
    for m in months:
        mo, vi = modis.get(m), viirs.get(m)
        km = seasonal.get(int(m[5:]), k)
        if vi is not None:
            h, src = vi, "VIIRS"
        elif mo is not None:
            h, src = round(mo * km, 1), "MODIS x k"
        else:
            h, src = None, ""
        rows.append({"month": m, "year": int(m[:4]), "mon": int(m[5:]), "modis": mo, "viirs": vi,
                     "k_used": round(km, 3) if mo is not None and vi is None else None,
                     "harmonized": h, "source": src})

    # anomalies: each month vs the median of the same calendar month in the other years
    by_mon = {mm: [r_ for r_ in rows if r_["mon"] == mm and r_["harmonized"] is not None] for mm in range(1, 13)}
    for r_ in rows:
        others = [o["harmonized"] for o in by_mon[r_["mon"]] if o["year"] != r_["year"]]
        base = _median(others) if len(others) >= 3 else None
        r_["baseline_median"] = None if base is None else round(base, 1)
        h = r_["harmonized"]
        if h is None or base is None:
            r_["anomaly_pct"] = None
            r_["rank_in_month"] = None
            continue
        r_["anomaly_pct"] = round((h - base) / base * 100, 1) if base > 0 else (None if h == 0 else 999.0)
        same = sorted((o["harmonized"] for o in by_mon[r_["mon"]]), reverse=True)
        r_["rank_in_month"] = same.index(h) + 1

    # annual totals (only years with all 12 months observed count as complete)
    years = sorted({r_["year"] for r_ in rows})
    annual = []
    for y in years:
        ys = [r_ for r_ in rows if r_["year"] == y]
        vals = [r_["harmonized"] for r_ in ys if r_["harmonized"] is not None]
        annual.append({"year": y, "total": round(sum(vals), 1) if vals else None, "complete": len(vals) == 12})
    complete = [a for a in annual if a["complete"] and a["total"] is not None]
    slope = None
    if len(complete) >= 5:
        xs, ys_ = [a["year"] for a in complete], [a["total"] for a in complete]
        mx, my = sum(xs) / len(xs), sum(ys_) / len(ys_)
        den = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys_)) / den if den else None
    seasonal_median = [{"mon": mm, "median": _median([o["harmonized"] for o in by_mon[mm]])} for mm in range(1, 13)]
    ranked = sorted((s for s in seasonal_median if s["median"] is not None), key=lambda s: -s["median"])
    # critical months: the top 3 by median, but only if they really stand out (>= 20 pixel-days and
    # at least 1.5x the average month), so a quiet area doesn't get "critical" months made of noise
    avg_med = sum(s["median"] for s in ranked) / len(ranked) if ranked else 0
    critical = [s["mon"] for s in ranked[:3] if s["median"] >= 20 and s["median"] >= 1.5 * avg_med]
    peak_year = max(complete, key=lambda a: a["total"], default=None)
    peak_month = max((r_ for r_ in rows if r_["harmonized"] is not None), key=lambda r_: r_["harmonized"], default=None)
    cur = next((r_ for r_ in rows if r_["month"] == current_month), None)
    mean_complete = sum(a["total"] for a in complete) / len(complete) if complete else None

    return {
        "unit": "hotspot pixel-days (VIIRS-equivalent, 1 km)",
        "method": {
            "k": round(k, 3), "seasonal_k": {str(mm): round(v, 3) for mm, v in seasonal.items()},
            "r": None if r is None else round(r, 3), "overlap_months": len(overlap),
            "overlap_modis_total": sm, "overlap_viirs_total": sv,
            "text": "VIIRS where it exists (from Jan 2012); before that MODIS x k, where k = VIIRS/MODIS ratio of "
                    "totals in the overlap months for this area (per calendar month when there is enough overlap).",
        },
        "rows": rows,
        "annual": annual,
        "seasonal": seasonal_median,
        "stats": {
            "total": round(sum(r_["harmonized"] for r_ in rows if r_["harmonized"] is not None), 1),
            "peak_year": peak_year, "peak_month": peak_month and {"month": peak_month["month"], "value": peak_month["harmonized"]},
            "critical_months": critical,
            "trend_per_year": None if slope is None else round(slope, 2),
            "trend_pct_per_decade": None if slope is None or not mean_complete else round(slope * 10 / mean_complete * 100, 1),
            "current": cur,
        },
        "overlap_points": [[modis[m], viirs[m], m] for m in overlap],
    }
