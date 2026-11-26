#!/usr/bin/env python3
"""Sestaví databázi postav Marvel a DC do data/marvel.json a data/dc.json.

Zdroje:
  * Wikidata (CC0) – seznam postav podle univerza (Marvel = Earth-616 / Marvel Universe,
    DC = DC Universe), jména, přezdívky, tvůrci, týmy, příbuzní, nepřátelé, schopnosti,
    první výskyt a jeho datum.
  * Wikipedie – náhledový obrázek z infoboxu a kategorie (z nich zařazení hrdina/záporák/antihrdina).
    Text článků se do repozitáře neukládá, web si ho načítá živě s odkazem na zdroj.
  * Superhero API (akabab) – číselné statistiky schopností a výška/váha, kde existují.

Spuštění:  python3 scripts/build_data.py
"""
import json, re, sys, time, unicodedata
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"
UA = "ComicBookGuideBuilder/1.0 (fan site data build; https://github.com/Sulii01/DC-Marvel-ComicBookGuide)"
S = requests.Session()
S.headers["User-Agent"] = UA

UNIVERSES = {
    "marvel": {"items": ["Q2246088", "Q931597"], "publisher": "Marvel Comics"},
    "dc": {"items": ["Q1152150"], "publisher": "DC Comics"},
}

# Obecné typy, které nemá smysl zobrazovat jako „druh“
GENERIC_TYPES = re.compile(
    r"^(fictional character|comics character|film character|television character|animated character|"
    r"video game character|literary character|anime character|character|superhero|supervillain|"
    r"fictional (?:superhero|supervillain|vigilante|businessperson|scientist|soldier|detective|journalist|"
    r"criminal|spy|assassin|politician|police officer|warrior|king|queen|god|deity))$", re.I)


def get(url, params, tries=6):
    for i in range(tries):
        try:
            r = S.get(url, params=params, timeout=90)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            wait = 2 ** i * 2
            print(f"  ! {e} – zkouším znovu za {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Selhalo: {url} {params}")


def sparql(q):
    return get("https://query.wikidata.org/sparql", {"query": q, "format": "json"})["results"]["bindings"]


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---------------------------------------------------------------- Wikidata

def list_characters(items):
    values = " ".join(f"wd:{q}" for q in items)
    rows = sparql(f"""
      SELECT DISTINCT ?c WHERE {{
        VALUES ?u {{ {values} }}
        ?c wdt:P1080 ?u .
        ?c wdt:P31/wdt:P279* wd:Q95074 .
      }}""")
    return sorted({r["c"]["value"].rsplit("/", 1)[1] for r in rows}, key=lambda q: int(q[1:]))


def get_entities(ids, props):
    out = {}
    for part in chunks(ids, 50):
        d = get("https://www.wikidata.org/w/api.php", {
            "action": "wbgetentities", "ids": "|".join(part), "props": props,
            "languages": "en", "sitefilter": "enwiki", "format": "json", "maxlag": "5"})
        out.update(d.get("entities", {}))
        time.sleep(0.2)
    return out


def claim_ids(e, prop):
    res = []
    for c in e.get("claims", {}).get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and "id" in v:
            res.append(v["id"])
    return res


def claim_values(e, prop):
    res = []
    for c in e.get("claims", {}).get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if v is not None:
            res.append(v)
    return res


def year_of(e):
    for prop in ("P577", "P571", "P580"):
        for v in claim_values(e, prop):
            m = re.match(r"[+-]?(\d{4})", v.get("time", "") if isinstance(v, dict) else "")
            if m and 1890 < int(m.group(1)) < 2100:
                return int(m.group(1))
    return None


def label(e):
    return e.get("labels", {}).get("en", {}).get("value")


# ---------------------------------------------------------------- Wikipedie

def wiki_info(titles):
    """Vrátí {title: {img, cats}} – obrázek z infoboxu a nekryté kategorie."""
    info = {}
    for part in chunks(titles, 50):
        params = {"action": "query", "format": "json", "formatversion": "2", "redirects": "1",
                  "titles": "|".join(part), "prop": "pageimages|categories", "piprop": "thumbnail",
                  "pithumbsize": "400", "pilicense": "any", "clshow": "!hidden", "cllimit": "max",
                  "maxlag": "5"}
        alias = {}
        while True:
            d = get("https://en.wikipedia.org/w/api.php", params)
            q = d.get("query", {})
            for n in q.get("normalized", []) + q.get("redirects", []):
                alias[n["to"]] = alias.get(n["from"], n["from"])
            for p in q.get("pages", []):
                key = alias.get(p["title"], p["title"])
                rec = info.setdefault(key, {"img": None, "cats": []})
                if p.get("thumbnail"):
                    rec["img"] = p["thumbnail"]["source"]
                rec["cats"] += [c["title"][9:] for c in p.get("categories", [])]
            if "continue" not in d:
                break
            params.update(d["continue"])
        time.sleep(0.3)
    return info


def alignment(cats):
    t = " | ".join(cats).lower()
    anti = re.search(r"anti-?hero", t)
    villain = re.search(r"supervillain|villains", t)
    hero = re.search(r"superheroes|superheroines|heroes", t.replace("antiheroes", "").replace("anti-heroes", ""))
    if anti or (hero and villain):
        return "neutral"
    if villain:
        return "bad"
    if hero:
        return "good"
    return None


# ---------------------------------------------------------------- Superhero API

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def load_akabab():
    d = get("https://cdn.jsdelivr.net/gh/akabab/superhero-api@0.3.0/api/all.json", {})
    idx = {}
    for c in d:
        idx[(c["biography"]["publisher"], norm(c["name"]))] = c
    return idx


# ---------------------------------------------------------------- Sestavení

PEOPLE_PROPS = {
    "creators": ["P170"], "occupation": ["P106"], "teams": ["P463", "P1416"],
    "enemies": ["P7047"], "abilities": ["P2563"], "pob": ["P19"], "gender": ["P21"],
    "eyes": ["P1340"], "hair": ["P1884"], "types": ["P31"],
    "relatives": ["P22", "P25", "P26", "P3373", "P40", "P1038", "P451"],
    "firstApp": ["P4584"], "given": ["P735"], "family": ["P734"],
}


def build(key, conf, akabab):
    print(f"[{key}] seznam postav z Wikidat…")
    ids = list_characters(conf["items"])
    print(f"[{key}] {len(ids)} postav, stahuji detaily…")
    ents = get_entities(ids, "labels|aliases|descriptions|claims|sitelinks")

    refs = set()
    for e in ents.values():
        for props in PEOPLE_PROPS.values():
            for p in props:
                refs.update(claim_ids(e, p))
    print(f"[{key}] {len(refs)} odkazovaných položek (jména, týmy, komiksy)…")
    ref_ents = get_entities(sorted(refs), "labels|claims")

    titles = [e["sitelinks"]["enwiki"]["title"] for e in ents.values() if e.get("sitelinks", {}).get("enwiki")]
    print(f"[{key}] {len(titles)} článků na Wikipedii – obrázky a kategorie…")
    winfo = wiki_info(titles)

    def labels(e, prop_key, limit=40):
        out = []
        for p in PEOPLE_PROPS[prop_key]:
            for q in claim_ids(e, p):
                lb = label(ref_ents.get(q, {}))
                if lb and lb not in out:
                    out.append(lb)
        return out[:limit]

    chars = []
    for q, e in ents.items():
        name = label(e)
        title = e.get("sitelinks", {}).get("enwiki", {}).get("title")
        if not name and title:
            name = re.sub(r"\s*\(.*\)$", "", title)
        if not name:
            continue
        w = winfo.get(title, {"img": None, "cats": []}) if title else {"img": None, "cats": []}

        fa_label, year = None, None
        for fq in claim_ids(e, "P4584"):
            fe = ref_ents.get(fq, {})
            fa_label = label(fe) or fa_label
            year = year_of(fe) or year
            if fa_label:
                break
        year = year or year_of(e)

        real = " ".join(x for x in (labels(e, "given")[:1] + labels(e, "family")[:1]) if x)
        aka = [a["value"] for a in e.get("aliases", {}).get("en", [])][:15]
        types = [t for t in labels(e, "types") if not GENERIC_TYPES.match(t)]

        ak = akabab.get((conf["publisher"], norm(name)))
        if ak:
            fa_label = fa_label or (ak["biography"]["firstAppearance"] if ak["biography"]["firstAppearance"] != "-" else None)
            if not year and fa_label:
                m = re.findall(r"\b(19[3-9]\d|20[0-4]\d)\b", fa_label)
                year = int(m[-1]) if m else None
            if real == "" and ak["biography"]["fullName"]:
                real = ak["biography"]["fullName"]

        align = alignment(w["cats"]) or (ak["biography"]["alignment"] if ak and ak["biography"]["alignment"] != "-" else None)

        c = {
            "id": q, "name": name, "wiki": title, "desc": e.get("descriptions", {}).get("en", {}).get("value"),
            "img": w["img"] or (ak["images"]["md"] if ak else None),
            "align": align, "year": year, "firstApp": fa_label, "realName": real or None,
            "aliases": aka, "creators": labels(e, "creators"), "gender": (labels(e, "gender") or [None])[0],
            "species": types[:6], "occupation": labels(e, "occupation", 12), "teams": labels(e, "teams"),
            "relatives": labels(e, "relatives", 25), "enemies": labels(e, "enemies"),
            "abilities": labels(e, "abilities"), "birthplace": (labels(e, "pob") or [None])[0],
            "eyes": (labels(e, "eyes") or [None])[0], "hair": (labels(e, "hair") or [None])[0],
        }
        if ak:
            c["powerstats"] = ak["powerstats"]
            h = [x for x in ak["appearance"]["height"] if not x.startswith(("-", "0 "))]
            wgt = [x for x in ak["appearance"]["weight"] if not x.startswith(("-", "0 "))]
            c["height"] = " / ".join(h) or None
            c["weight"] = " / ".join(wgt) or None
            c["base"] = ak["work"]["base"] if ak["work"]["base"] not in ("-", "") else None
        # odstranit prázdné hodnoty, ať je soubor menší
        chars.append({k: v for k, v in c.items() if v not in (None, [], "")})

    chars.sort(key=lambda c: c["name"].lower())
    return chars


def main():
    OUT.mkdir(exist_ok=True)
    print("Superhero API…")
    akabab = load_akabab()
    for key, conf in UNIVERSES.items():
        chars = build(key, conf, akabab)
        (OUT / f"{key}.json").write_text(json.dumps(chars, ensure_ascii=False, separators=(",", ":")))
        with_img = sum(1 for c in chars if c.get("img"))
        print(f"[{key}] hotovo: {len(chars)} postav, {with_img} s obrázkem")


if __name__ == "__main__":
    main()
