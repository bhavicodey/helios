"""Wildfires reported by US fire agencies, from the NIFC WFIGS incident database (IRWIN).

Satellites see heat; this is the ground truth fire managers file: each incident's name, start date and size.
It covers the United States only, and the records are complete from 2014 on.
"""
import json
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

URL = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
       "WFIGS_Incident_Locations/FeatureServer/0/query")
FIRST = date(2014, 1, 1)
LOOKBACK_DAYS = 14   # a fire found a little before the window can still be burning in it
FIELDS = "IncidentName,FireDiscoveryDateTime,FireOutDateTime,ContainmentDateTime,IncidentSize,FireCauseGeneral,POOState"


def _ts(d: date) -> str:
    return f"TIMESTAMP '{d.isoformat()} 00:00:00'"


def _query(params: dict) -> dict:
    params = {k: v for k, v in params.items() if v is not None}
    req = urllib.request.Request(URL, data=urllib.parse.urlencode(params).encode(),
                                 headers={"User-Agent": "helios-fire-app"})
    with urllib.request.urlopen(req, timeout=25) as r:
        out = json.load(r)
    if "error" in out:
        raise RuntimeError(out["error"].get("message", "NIFC query failed"))
    return out


def reported_fires(start: str, end: str, lat: float, lon: float, radius_km: float, pts=None, limit: int = 200):
    """Wildfire incidents active in [start, end] inside the area, biggest first."""
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if e < FIRST:
        return {"coverage": "before", "count": None, "total_acres": None, "fires": []}
    where = (f"IncidentTypeCategory = 'WF'"
             f" AND FireDiscoveryDateTime >= {_ts(s - timedelta(days=LOOKBACK_DAYS))}"
             f" AND FireDiscoveryDateTime < {_ts(e + timedelta(days=1))}"
             f" AND (FireOutDateTime IS NULL OR FireOutDateTime >= {_ts(s)})")
    params = {"where": where, "outFields": FIELDS, "returnGeometry": "true", "outSR": 4326, "inSR": 4326,
              "spatialRel": "esriSpatialRelIntersects", "orderByFields": "IncidentSize DESC",
              "resultRecordCount": limit, "f": "json"}
    if pts:
        params.update(geometryType="esriGeometryPolygon",
                      geometry=json.dumps({"rings": [pts], "spatialReference": {"wkid": 4326}}))
    else:
        params.update(geometryType="esriGeometryPoint", geometry=f"{lon},{lat}",
                      distance=radius_km, units="esriSRUnit_Kilometer")

    count = _query({**params, "returnCountOnly": "true", "resultRecordCount": None,
                    "orderByFields": None, "outFields": None}).get("count", 0)
    feats = _query(params).get("features", []) if count else []

    def day(ms):
        return None if ms is None else datetime.fromtimestamp(ms / 1000, timezone.utc).date().isoformat()

    fires = []
    for f in feats:
        a, g = f.get("attributes", {}), f.get("geometry") or {}
        fires.append({
            "name": (a.get("IncidentName") or "unnamed").strip().title(),
            "discovered": day(a.get("FireDiscoveryDateTime")),
            "contained": day(a.get("ContainmentDateTime")),
            "acres": None if a.get("IncidentSize") is None else round(a["IncidentSize"], 1),
            "cause": (a.get("FireCauseGeneral") or a.get("FireCause") or "").lower() or None,
            "state": (a.get("POOState") or "").replace("US-", "") or None,
            "lat": g.get("y"), "lon": g.get("x"),
        })
    acres = [f["acres"] for f in fires if f["acres"]]
    return {"coverage": "us", "count": count, "total_acres": round(sum(acres), 1) if acres else 0,
            "shown": len(fires), "fires": fires,
            "source": "NIFC WFIGS wildfire incidents (US fire agencies, via IRWIN)"}
