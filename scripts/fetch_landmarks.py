#!/usr/bin/env python3
"""
fetch_landmarks.py — real scenic thumbnails for the cities on the route.

Source: Wikimedia Commons geosearch (geotagged photos within ~10 km of each
city center, returned closest-first → most representative of the place). Commons
images are CC / public-domain, so they are LEGAL to store + re-serve as long as
we keep the author + license (we do — see manifest). This is the only source
where "fetch the real landmark AND host it ourselves" is allowed; Google/Baidu
ToS forbid caching their photos.

Scope: only the cities actually on the 30-yr route (the clickable dots) — read
from docs/map_data.json so this never drifts from the engine output.

Output:
  docs/landmarks/<city_id>/1.jpg .. 3.jpg     (480px thumbnails, ~30-50 KB each)
  docs/landmarks/manifest.json                { city_id: { images:[{src,author,license,license_url,page}] } }

The map reads manifest.json at runtime and looks images up by city id — no image
paths are ever hardcoded in the HTML (dynamic-loading contract). Cities with no
free photo simply get no entry; the card falls back to a generated gradient tile.

Re-runnable: skips a city whose files already exist, so top-ups are cheap.
"""
import json, os, re, time, html, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, "docs", "landmarks")
API = "https://commons.wikimedia.org/w/api.php"
UA = "travelOS-landmark-fetcher/1.0 (https://github.com/alexkou/travelOS; static map thumbnails)"

WANT = 3                      # images per city
RADIUS_M = 10000              # geosearch max
THUMB_W = 480
JUNK = re.compile(r"(locator|location_map|\bmap\b|flag|coat_of_arms|emblem|seal|"
                  r"logo|icon|diagram|chart|plaque|\.svg$|panorama_of_china|"
                  r"administrative|district_map)", re.I)


def _open(url, attempts=4):
    """GET with retry/backoff — the sandbox proxy throws intermittent SSL/503s."""
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=30).read()
        except Exception as e:
            last = e
            time.sleep(0.8 * (i + 1))
    raise last


def api_get(params):
    params = {**params, "format": "json", "formatversion": "2"}
    return json.loads(_open(API + "?" + urllib.parse.urlencode(params)))


def strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def geosearch_images(lat, lng):
    """Return candidate Commons File pages near (lat,lng), closest-first, with imageinfo."""
    try:
        data = api_get({
            "action": "query",
            "generator": "geosearch",
            "ggscoord": f"{lat}|{lng}",
            "ggsradius": RADIUS_M,
            "ggslimit": 40,
            "ggsnamespace": 6,            # File:
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|mime|size",
            "iiurlwidth": THUMB_W,
        })
    except Exception as e:
        print(f"    geosearch error: {e}")
        return []
    pages = data.get("query", {}).get("pages", [])
    # geosearch order isn't preserved by 'pages'; sort by its index if present
    pages.sort(key=lambda p: p.get("index", 1e9))
    return pages


def pick(pages):
    """Filter junk/maps/svg, dedup, keep up to WANT good photos with attribution."""
    out, seen = [], set()
    for p in pages:
        title = p.get("title", "")
        if JUNK.search(title):
            continue
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if (ii.get("width") or 0) < 320:
            continue
        thumb = ii.get("thumburl")
        if not thumb or thumb in seen:
            continue
        seen.add(thumb)
        meta = ii.get("extmetadata", {})
        out.append({
            "thumb": thumb,
            "author": strip_html(meta.get("Artist", {}).get("value", "")) or "Unknown",
            "license": (meta.get("LicenseShortName", {}).get("value") or "").strip() or "see source",
            "license_url": (meta.get("LicenseUrl", {}).get("value") or "").strip(),
            "page": ii.get("descriptionurl", ""),
        })
        if len(out) >= WANT:
            break
    return out


def download(url, dst):
    data = _open(url)
    with open(dst, "wb") as f:
        f.write(data)
    return len(data)


def main():
    md = json.load(open(os.path.join(ROOT, "docs", "map_data.json"), encoding="utf-8"))
    cities = {}
    for s in md["trajectory"]:
        cities.setdefault(s["id"], {"id": s["id"], "n": s["n"], "z": s["z"],
                                    "p": s["p"], "lat": s["lat"], "lng": s["lng"]})
    cities = list(cities.values())
    print(f"{len(cities)} cities on the route\n")

    os.makedirs(LAND, exist_ok=True)
    manifest_path = os.path.join(LAND, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}

    full = partial = empty = 0
    for i, c in enumerate(cities, 1):
        cid = c["id"]
        cdir = os.path.join(LAND, cid)
        # skip only cities already FULL — partials get retried/topped up each run
        have_prev = len(manifest.get(cid, {}).get("images", []))
        if have_prev >= WANT:
            print(f"[{i:>2}/{len(cities)}] {c['n']:<16} cached ({have_prev})")
            full += 1
            continue

        print(f"[{i:>2}/{len(cities)}] {c['n']:<16} {c['z']:<6} {c['p']}", end="  ")
        picks = pick(geosearch_images(c["lat"], c["lng"]))
        if not picks:
            print("→ no free photo")
            manifest[cid] = {"name": c["n"], "images": []}
            empty += 1
            time.sleep(0.3)
            continue

        os.makedirs(cdir, exist_ok=True)
        images = []
        for k, ph in enumerate(picks, 1):
            try:
                rel = f"{cid}/{k}.jpg"
                kb = download(ph["thumb"], os.path.join(LAND, f"{cid}/{k}.jpg")) / 1024
                images.append({"src": f"landmarks/{rel}", "author": ph["author"],
                               "license": ph["license"], "license_url": ph["license_url"],
                               "page": ph["page"]})
            except Exception as e:
                print(f"(dl fail {k}: {e})", end=" ")
        manifest[cid] = {"name": c["n"], "images": images}
        print(f"→ {len(images)} img")
        full += len(images) >= WANT
        partial += 0 < len(images) < WANT
        empty += len(images) == 0
        # be polite to the API
        time.sleep(0.4)
        # checkpoint manifest each city so a crash doesn't lose progress
        json.dump(manifest, open(manifest_path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=0)

    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    print(f"\ncoverage: {full} full(≥{WANT})  {partial} partial  {empty} none "
          f"/ {len(cities)} cities")
    print(f"manifest → docs/landmarks/manifest.json")


if __name__ == "__main__":
    main()
