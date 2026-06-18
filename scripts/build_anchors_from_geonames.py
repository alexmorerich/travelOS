#!/usr/bin/env python3
"""Travel Life OS — data pipeline: build city anchors from GeoNames.

Downloads the GeoNames China dump, filters to administrative seats
(PPLA = provincial capital, PPLA2 = prefecture seat), and emits
data/city_anchors.json with REAL lat/lng/elevation plus deterministic
tier / coastal / remote tags consumed by `npm run enrich`.

Reproducible: re-run to regenerate. Source: https://www.geonames.org (CC BY).
"""
import io, json, math, os, re, unicodedata, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = "https://download.geonames.org/export/dump"

# --- tier / culture knowledge (small curated overrides; everything else by rule)
TIER1 = {"beijing", "shanghai", "guangzhou", "shenzhen"}
NEW_TIER1 = {"chengdu", "hangzhou", "chongqing", "wuhan", "xian", "suzhou",
             "tianjin", "nanjing", "changsha", "zhengzhou", "dongguan",
             "qingdao", "shenyang", "ningbo", "kunming", "hefei", "foshan",
             "wuxi", "xiamen", "fuzhou", "jinan", "dalian", "harbin"}
WEST = {"tibet", "xizang", "qinghai", "xinjiang", "gansu", "ningxia",
        "inner mongolia", "nei mongol"}
# Standard 2-letter province codes -> stable, config-friendly city ids.
PROV_ABBR = {
    "beijing": "BJ", "tianjin": "TJ", "hebei": "HE", "shanxi": "SX",
    "inner mongolia": "NM", "nei mongol": "NM", "liaoning": "LN", "jilin": "JL",
    "heilongjiang": "HL", "shanghai": "SH", "jiangsu": "JS", "zhejiang": "ZJ",
    "anhui": "AH", "fujian": "FJ", "jiangxi": "JX", "shandong": "SD",
    "henan": "HA", "hubei": "HB", "hunan": "HN", "guangdong": "GD",
    "guangxi": "GX", "hainan": "HI", "chongqing": "CQ", "sichuan": "SC",
    "guizhou": "GZ", "yunnan": "YN", "tibet": "XZ", "xizang": "XZ",
    "shaanxi": "SN", "gansu": "GS", "qinghai": "QH", "ningxia": "NX",
    "xinjiang": "XJ",
}
CULTURE = {  # famous cultural/scenic value overrides (0-10)
    "xian": 10, "lhasa": 10, "beijing": 9, "hangzhou": 9, "chengdu": 9,
    "guilin": 9, "dali": 9, "lijiang": 9, "nanjing": 8, "suzhou": 8,
    "luoyang": 8, "kaifeng": 8, "shanghai": 8, "xiamen": 8, "datong": 7,
    "yangzhou": 7, "shaoxing": 7, "quanzhou": 8, "jingdezhen": 7, "shigatse": 8,
    "kashgar": 8, "sanya": 7, "qingdao": 7, "guangzhou": 7, "wuhan": 7,
    "changsha": 7, "chongqing": 7, "kunming": 8,
}
# Curated Chinese names for major cities (GeoNames alternatenames are noisy:
# they mix in districts and other scripts). Tail cities fall back to a pure-Han
# token, then to pinyin.
CURATED_ZH = {
    "beijing": "北京", "shanghai": "上海", "guangzhou": "广州", "shenzhen": "深圳",
    "chengdu": "成都", "chongqing": "重庆", "hangzhou": "杭州", "wuhan": "武汉",
    "xian": "西安", "nanjing": "南京", "suzhou": "苏州", "tianjin": "天津",
    "changsha": "长沙", "zhengzhou": "郑州", "qingdao": "青岛", "shenyang": "沈阳",
    "dalian": "大连", "ningbo": "宁波", "kunming": "昆明", "hefei": "合肥",
    "foshan": "佛山", "dongguan": "东莞", "wuxi": "无锡", "xiamen": "厦门",
    "fuzhou": "福州", "jinan": "济南", "harbin": "哈尔滨", "changchun": "长春",
    "shijiazhuang": "石家庄", "taiyuan": "太原", "nanning": "南宁", "guiyang": "贵阳",
    "lanzhou": "兰州", "xining": "西宁", "yinchuan": "银川", "hohhot": "呼和浩特",
    "urumqi": "乌鲁木齐", "lhasa": "拉萨", "haikou": "海口", "sanya": "三亚",
    "nanchang": "南昌", "guilin": "桂林", "zhuhai": "珠海", "shantou": "汕头",
    "wenzhou": "温州", "yantai": "烟台", "weihai": "威海", "luoyang": "洛阳",
    "kaifeng": "开封", "datong": "大同", "baotou": "包头", "dali": "大理",
    "lijiang": "丽江", "shigatse": "日喀则", "kashgar": "喀什", "yangzhou": "扬州",
    "shaoxing": "绍兴", "quanzhou": "泉州", "zhongshan": "中山", "jiangmen": "江门",
    "zhanjiang": "湛江", "beihai": "北海", "jingdezhen": "景德镇", "zunyi": "遵义",
    "mianyang": "绵阳", "yichang": "宜昌", "xiangyang": "襄阳", "ganzhou": "赣州",
    "tangshan": "唐山", "qinhuangdao": "秦皇岛",
}
# Coastline reference points (lng, lat) from Liaoning to Hainan.
COAST = [(124.4,40.1),(121.6,38.9),(122.2,40.7),(119.6,39.9),(117.7,38.9),
         (121.4,37.5),(120.4,36.1),(119.5,35.4),(119.2,34.7),(120.5,33.4),
         (121.0,32.0),(121.8,31.2),(121.8,29.9),(121.6,28.7),(120.9,28.0),
         (119.6,26.1),(118.1,24.5),(116.7,23.4),(114.2,22.5),(113.6,22.2),
         (110.4,21.2),(109.1,21.5),(110.3,20.0),(109.5,18.3)]


def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1); dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlng/2)**2
    return 2*R*math.asin(min(1, math.sqrt(a)))


def norm(s):
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def parse_alt(c):
    for v in (c[15], c[16]):  # elevation, then SRTM dem
        if v and v.strip():
            try:
                f = float(v)
                if f > -500:
                    return int(round(f))
            except ValueError:
                pass
    return 0


def abbr(province):
    return PROV_ABBR.get(province.lower().strip(), re.sub(r"[^A-Z]", "", province.upper())[:2] or "XX")


def pick_zh(name_en, alts):
    n = norm(name_en)
    if n in CURATED_ZH:
        return CURATED_ZH[n]
    for t in alts.split(","):
        t = t.strip()
        if re.fullmatch(r"[一-龥]{2,6}", t):  # pure Han, excludes katakana/districts-with-suffix
            return t
    return name_en


def fetch(url):
    return urllib.request.urlopen(url, timeout=60).read()


def main():
    # province (admin1) code -> english name
    a1 = {}
    for line in fetch(f"{GEO}/admin1CodesASCII.txt").decode("utf-8").splitlines():
        p = line.split("\t")
        if p and p[0].startswith("CN."):
            a1[p[0]] = p[1]

    zip_bytes = fetch(f"{GEO}/CN.zip")
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        raw = z.read("CN.txt").decode("utf-8")

    seen, bykey = {}, {}
    for line in raw.splitlines():
        c = line.split("\t")
        if len(c) < 18 or c[6] != "P" or c[7] not in ("PPLA", "PPLA2", "PPLA3", "PPLC"):
            continue
        name_en = c[2].strip()
        if not name_en:
            continue
        province = a1.get("CN." + c[10], c[10])
        key = (norm(name_en), province)
        pop = int(c[14]) if c[14] else 0
        if key in seen and pop <= seen[key]:
            continue
        seen[key] = pop
        lat, lng = round(float(c[4]), 4), round(float(c[5]), 4)
        altitude = parse_alt(c)
        zh = pick_zh(name_en, c[3])

        n = norm(name_en)
        if n in TIER1:
            tier = 1
        elif c[7] == "PPLA" or n in NEW_TIER1:
            tier = 2
        else:
            tier = 3
        coastal = min(haversine(lat, lng, cy, cx) for cx, cy in COAST) < 60
        remote = province.lower() in WEST or altitude > 2500

        a = {"id": f"CN-{abbr(province)}-{n.upper()}",
             "name": zh, "name_en": name_en, "province": province,
             "lat": lat, "lng": lng, "altitude_m": altitude, "tier": tier,
             "_pop": pop, "_fc": c[7]}
        if c[7] == "PPLA3": a["county"] = True
        if coastal: a["coastal"] = True
        if remote: a["remote"] = True
        if n in CULTURE: a["culture"] = CULTURE[n]
        bykey[key] = a

    # Select ~700: keep all capitals/prefecture seats, then the most populous
    # county seats (PPLA3) to fill out the target.
    TARGET = 700
    allnodes = list(bykey.values())
    prefecture = [a for a in allnodes if a["_fc"] in ("PPLC", "PPLA", "PPLA2")]
    counties = sorted((a for a in allnodes if a["_fc"] == "PPLA3"), key=lambda a: -a["_pop"])
    anchors = prefecture + counties[: max(0, TARGET - len(prefecture))]
    for a in anchors:
        a.pop("_pop", None)
        a.pop("_fc", None)

    # ensure unique ids
    counts = {}
    for a in anchors:
        i = a["id"]
        if i in counts:
            counts[i] += 1; a["id"] = f"{i}{counts[i]}"
        else:
            counts[i] = 0

    # manual extras: a county with no tier-3A (exercises PARTIAL/BLOCK) + a scenic county
    anchors.append({"id": "CN-XZ-MEDOG", "name": "墨脱", "name_en": "Medog",
                    "province": "Tibet", "lat": 29.33, "lng": 95.30, "altitude_m": 1200,
                    "tier": 3, "remote": True, "med_access": "none", "culture": 7})

    anchors.sort(key=lambda a: (a["province"], a["name_en"]))
    out = {"_meta": {
        "description": "Real-geography anchors built from GeoNames (PPLA/PPLA2 seats) + curated tags.",
        "source": "GeoNames CN dump (CC BY 4.0), https://www.geonames.org",
        "generator": "scripts/build_anchors_from_geonames.py",
        "count": len(anchors),
        "tags": "tier 1|2|3; coastal (<60km to coast); remote (west region or >2500m); culture override; med_access 'none' => hospital=null"},
        "anchors": anchors}
    path = os.path.join(ROOT, "data", "city_anchors.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    prov = len({a["province"] for a in anchors})
    print(f"wrote {len(anchors)} anchors across {prov} provinces -> data/city_anchors.json")
    print("  tiers:", {t: sum(1 for a in anchors if a['tier'] == t) for t in (1, 2, 3)})
    print("  coastal:", sum(1 for a in anchors if a.get('coastal')),
          "remote:", sum(1 for a in anchors if a.get('remote')),
          "county-seats:", sum(1 for a in anchors if a.get('county')))


if __name__ == "__main__":
    main()
