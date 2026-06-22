#!/usr/bin/env python3
"""
fetch_landmarks.py — real scenic thumbnails for EVERY county on the tour map.

Source: Wikimedia Commons geosearch (geotagged photos within 10 km of each
county center, returned closest-first → most representative of the place).
Commons images are CC / public-domain, so they are LEGAL to display with
attribution (author + license + source page are kept in the manifest).

Hosting modes (the manifest stores whatever `src` we record; docs/tour.html
handles both an absolute URL and a repo-relative path):
  • HOTLINK  (default): src = the Commons thumbnail URL on upload.wikimedia.org.
    Nothing is downloaded — the repo stays tiny and the card loads the image
    straight from Wikimedia's CDN. This is the mode used for full coverage.
  • DOWNLOAD (--download): src = landmarks/<id>/<k>.jpg, self-hosted. Kept for
    the rare case you want offline copies of a subset.

Scope: ALL counties in docs/map_data.json (`counties`) — i.e. every clickable
dot on docs/tour.html — so no county is left on the hatched placeholder.

Re-runnable + checkpointed: each finished entry is stamped `"src_mode"`, so a
resumed run skips it and only the un-stamped counties are queried. The manifest
is saved every CHECKPOINT_EVERY counties and on Ctrl-C, so an interrupted run
resumes cheaply.

Flags:
  --download   self-host the picked thumbnails instead of hotlinking
  --limit N    only process the first N un-stamped counties (smoke test)
  --refresh    re-query every county, even ones already stamped
"""
import json, os, re, sys, time, html, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, "docs", "landmarks")
API = "https://commons.wikimedia.org/w/api.php"
UA = "travelOS-landmark-fetcher/1.0 (https://github.com/alexkou/travelOS; static map thumbnails)"

WANT = 3                      # images per county
RADIUS_M = 10000              # geosearch hard max (Commons caps ggsradius at 10 km)
THUMB_W = 480
CHECKPOINT_EVERY = 20

DOWNLOAD = "--download" in sys.argv
REFRESH = "--refresh" in sys.argv
LIMIT = None
for a in sys.argv[1:]:
    if a.startswith("--limit"):
        # accept --limit N  or  --limit=N
        if "=" in a:
            LIMIT = int(a.split("=", 1)[1])
        else:
            i = sys.argv.index(a)
            LIMIT = int(sys.argv[i + 1])

JUNK = re.compile(r"(locator|location_map|\bmap\b|flag|coat_of_arms|emblem|seal|"
                  r"logo|icon|diagram|chart|plaque|\.svg$|panorama_of_china|"
                  r"administrative|district_map|"
                  r"view of (the )?earth|view of china|\biss[\- ]?\d|astronaut|"
                  r"from space|space station|landsat|sentinel[\- ]?\d|earth observ|"
                  r"satellite (image|view|photo))", re.I)

# Remote counties often have only orbital/satellite shots of Earth (NASA ISS,
# ESA) geotagged near them — useless as scenery and visually identical. Their
# File: titles vary, so filter by the tell-tale author/source as well.
ORBITAL = re.compile(r"(remote sensing|johnson space|earth science|\bnasa\b|"
                     r"\besa\b|copernicus|space center|space flight|astronaut)", re.I)


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
        meta = ii.get("extmetadata", {})
        author = strip_html(meta.get("Artist", {}).get("value", "")) or "Unknown"
        if ORBITAL.search(author) or ORBITAL.search(title):   # drop satellite/ISS shots
            continue
        seen.add(thumb)
        out.append({
            "thumb": thumb,
            "author": author,
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
    counties = md["counties"]
    mode = "download + self-host" if DOWNLOAD else "hotlink Commons URLs"
    print(f"{len(counties)} counties on the tour map  (mode: {mode}"
          f"{', refresh ALL' if REFRESH else ''}{f', limit {LIMIT}' if LIMIT else ''})\n")

    os.makedirs(LAND, exist_ok=True)
    manifest_path = os.path.join(LAND, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}
    pre = len(manifest)

    def save():
        json.dump(manifest, open(manifest_path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=0)

    def done_already(cid):
        # an entry is "done" once it carries the src_mode stamp this pipeline writes
        return manifest.get(cid, {}).get("src_mode") == ("file" if DOWNLOAD else "url")

    full = partial = empty = processed = 0
    try:
        for c in counties:
            cid = c["id"]
            if not REFRESH and done_already(cid):
                continue
            if LIMIT is not None and processed >= LIMIT:
                break
            processed += 1

            picks = pick(geosearch_images(c["lat"], c["lng"]))
            images = []
            for k, ph in enumerate(picks, 1):
                if DOWNLOAD:
                    try:
                        os.makedirs(os.path.join(LAND, cid), exist_ok=True)
                        download(ph["thumb"], os.path.join(LAND, f"{cid}/{k}.jpg"))
                        src = f"landmarks/{cid}/{k}.jpg"
                    except Exception as e:
                        print(f"    (dl fail {cid} {k}: {e})")
                        continue
                else:
                    src = ph["thumb"]          # hotlink the Commons thumbnail URL directly
                images.append({"src": src, "author": ph["author"],
                               "license": ph["license"], "license_url": ph["license_url"],
                               "page": ph["page"]})

            manifest[cid] = {"name": c["n"], "images": images,
                             "src_mode": "file" if DOWNLOAD else "url"}
            full += len(images) >= WANT
            partial += 0 < len(images) < WANT
            empty += len(images) == 0

            if processed % 50 == 0 or (LIMIT and processed <= LIMIT):
                print(f"[{processed}] {c['z']:<6} {c['n']:<18} → {len(images)} img   "
                      f"({full} full, {partial} partial, {empty} none)")
            if processed % CHECKPOINT_EVERY == 0:
                save()
            time.sleep(0.3)                   # be polite to the Commons API
    except KeyboardInterrupt:
        print("\ninterrupted — saving checkpoint")
    finally:
        save()

    print(f"\nprocessed this run: {processed}   "
          f"(+{len(manifest) - pre} new manifest entries, {len(manifest)} total)")
    print(f"coverage of processed: {full} full(≥{WANT})  {partial} partial  {empty} none")
    print(f"manifest → docs/landmarks/manifest.json")


if __name__ == "__main__":
    main()
