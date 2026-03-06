#!/usr/bin/env python3
"""
Fetch Dutch province (provincie) boundary polygons from geoBoundaries
(full-resolution, CC0 licensed) and convert to the app's county GeoJSON schema.

Output: public/data/counties/NL.json

Property schema (mirrors US county files):
  countyRegion  — eBird region code  e.g. "NL-DR"
  stateCode     — parent region code  "NL"
  name          — province name  e.g. "Drenthe"
  countyCode    — short province code  e.g. "DR"
  stateFips     — null (not applicable outside US)
  countyFips    — null
  fips5         — null

Source:
  geoBoundaries NLD ADM1 (full resolution, ~5 MB, CC0)
  https://geoboundaries.org

NOTE: uses curl for download — Python's urllib may fail DNS on some machines.

Run:
  python3 scripts/fetch-nl-provinces.py
"""

import json
import subprocess
import sys
import os
import tempfile

GEOJSON_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09"
    "/releaseData/gbOpen/NLD/ADM1/geoBoundaries-NLD-ADM1.geojson"
)

def fetch_geojson(url):
    print(f"Fetching (curl): {url}")
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name
    result = subprocess.run(
        ["curl", "-sL", "--max-time", "120", url, "-o", tmp_path],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"curl error: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    with open(tmp_path, encoding="utf-8") as f:
        data = json.load(f)
    os.unlink(tmp_path)
    print(f"  → {len(data.get('features', []))} features received")
    return data

def convert_feature(feature):
    props = feature.get("properties", {})
    # geoBoundaries uses 'shapeISO' for the ISO 3166-2 code (e.g. "NL-GR")
    ebird_code = (props.get("shapeISO") or "").strip()
    name       = (props.get("shapeName") or "").strip()

    if not ebird_code.startswith("NL-"):
        print(f"  WARNING: unexpected ISO code '{ebird_code}' — skipping", file=sys.stderr)
        return None

    short_code = ebird_code.split("-")[1]  # "GR", "NH", etc.

    return {
        "type": "Feature",
        "properties": {
            "countyRegion": ebird_code,
            "stateCode":    "NL",
            "name":         name,
            "countyCode":   short_code,
            "fips5":        None,
            "stateFips":    None,
            "countyFips":   None,
        },
        "geometry": feature.get("geometry"),
    }

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.normpath(
        os.path.join(script_dir, "..", "public", "data", "counties", "NL.json")
    )

    raw = fetch_geojson(GEOJSON_URL)
    converted = [cf for cf in (convert_feature(f) for f in raw.get("features", [])) if cf]

    geojson = {"type": "FeatureCollection", "features": converted}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(out_path) / 1024
    print(f"\nWrote {len(converted)} provinces → {out_path} ({size_kb:.0f} KB)")
    if len(converted) != 12:
        print(f"  WARNING: expected 12 provinces, got {len(converted)}", file=sys.stderr)
    for feat in converted:
        print(f"  {feat['properties']['countyRegion']:8s}  {feat['properties']['name']}")

if __name__ == "__main__":
    main()


Output: public/data/counties/NL.json

Property schema (mirrors US county files):
  countyRegion  — eBird region code  e.g. "NL-DR"
  stateCode     — parent region code  "NL"
  name          — province name  e.g. "Drenthe"
  countyCode    — short province code  e.g. "DR"
  stateFips     — null (not applicable outside US)
  countyFips    — null
  fips5         — null

Run:
  python3 scripts/fetch-nl-provinces.py
"""

import json
import urllib.request
import sys
import os

# ---------------------------------------------------------------------------
# Name → eBird province code
# The PDOK "statnaam" field uses official Dutch province names.
# ---------------------------------------------------------------------------
NAME_TO_EBIRD = {
    "Drenthe":        "NL-DR",
    "Flevoland":      "NL-FL",
    "Friesland":      "NL-FR",
    "Gelderland":     "NL-GE",
    "Groningen":      "NL-GR",
    "Limburg":        "NL-LI",
    "Noord-Brabant":  "NL-NB",
    "Noord-Holland":  "NL-NH",
    "Overijssel":     "NL-OV",
    "Utrecht":        "NL-UT",
    "Zeeland":        "NL-ZE",
    "Zuid-Holland":   "NL-ZH",
}

# PDOK CBS WFS — 2022 generalised province layer, returned in EPSG:4326
WFS_URL = (
    "https://geodata.nationaalgeoregister.nl/cbsgebiedsindelingen/wfs"
    "?service=WFS"
    "&version=2.0.0"
    "&request=GetFeature"
    "&typename=cbsgebiedsindelingen:cbs_provincie_2022_gegeneraliseerd"
    "&outputFormat=application%2Fjson"
    "&srsname=EPSG:4326"
)

def fetch_geojson(url):
    print(f"Fetching: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "ebird-rarity-mobile/fetch-nl-provinces"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    data = json.loads(raw)
    print(f"  → {len(data.get('features', []))} features received")
    return data

def convert_feature(feature):
    props = feature.get("properties", {})
    # PDOK uses 'statnaam' for the province name
    name = props.get("statnaam") or props.get("provincienaam") or props.get("prov_naam") or ""
    name = name.strip()

    ebird_code = NAME_TO_EBIRD.get(name)
    if not ebird_code:
        print(f"  WARNING: unrecognised province name '{name}' — skipping", file=sys.stderr)
        return None

    short_code = ebird_code.split("-")[1]  # "DR", "NH", etc.

    return {
        "type": "Feature",
        "properties": {
            "countyRegion": ebird_code,
            "stateCode":    "NL",
            "name":         name,
            "countyCode":   short_code,
            "fips5":        None,
            "stateFips":    None,
            "countyFips":   None,
        },
        "geometry": feature.get("geometry"),
    }

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(script_dir, "..", "public", "data", "counties", "NL.json")
    out_path = os.path.normpath(out_path)

    raw = fetch_geojson(WFS_URL)

    converted = []
    for feat in raw.get("features", []):
        cf = convert_feature(feat)
        if cf:
            converted.append(cf)

    geojson = {
        "type": "FeatureCollection",
        "features": converted,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nWrote {len(converted)} provinces → {out_path}")
    if len(converted) != 12:
        print(f"  WARNING: expected 12 provinces, got {len(converted)}", file=sys.stderr)

if __name__ == "__main__":
    main()
