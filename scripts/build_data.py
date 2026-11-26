#!/usr/bin/env python3
"""Sestaví databázi postav Marvel a DC do data/marvel.json a data/dc.json.

Zdroje:
  * Wikidata (CC0) – seznam postav podle univerza (Marvel = Earth-616 / Marvel Universe,
    DC = DC Universe), jména, přezdívky, tvůrci, týmy, příbuzní, nepřátelé, schopnosti,
    první výskyt a jeho rok. Stahuje se několika hromadnými SPARQL dotazy.
  * Wikipedie – náhledový obrázek z infoboxu a kategorie (z nich zařazení hrdina/záporák/antihrdina).
    Text článků se do repozitáře neukládá, web si ho načítá živě s odkazem na zdroj.
  * Superhero API (akabab) – číselné statistiky schopností a výška/váha, kde existují.

Odpovědi se ukládají do .cache/, takže přerušené stahování lze bezpečně spustit znovu.

Spuštění:  python3 scripts/build_data.py
"""
import hashlib, json, re, sys, time, unicodedata
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"
CACHE = ROOT / ".cache"
UA = "ComicBookGuideBuilder/1.0 (fan site data build; https://github.com/Sulii01/DC-Marvel-ComicBookGuide)"
S = requests.Session()
S.headers["User-Agent"] = UA

UNIVERSES = {
    "marvel": {"items": ["Q2246088", "Q931597"], "publisher": "Marvel Comics"},
    "dc": {"items": ["Q1152150"], "publisher": "DC Comics"},
}

# Vlastnosti z Wikidat, které se zobrazují na stránce postavy
PROPS = {
    "creators": ["P170"], "occupation": ["P106"], "teams": ["P463", "P1416"],
    "enemies": ["P7047"], "abilities": ["P2563"], "pob": ["P19"], "gender": ["P21"],
    "eyes": ["P1340"], "hair": ["P1884"], "types": ["P31"],
    "relatives": ["P22", "P25", "P26", "P3373", "P40", "P1038", "P451"],
    "given": ["P735"], "family": ["P734"],
}

# Obecné typy, které nemá smysl zobrazovat jako „druh“
GENERIC_TYPES = re.compile(
    r"^(fictional character|comics character|film character|television character|animated character|"
    r"video game character|literary character|anime character|character|superhero|supervillain|"
    r"fictional (?:superhero|supervillain|vigilante|businessperson|scientist|soldier|detective|journalist|"
    r"criminal|spy|assassin|politician|police officer|warrior|king|queen|god|deity))$", re.I)


# ---------------------------------------------------------------- HTTP s cache

def get(url, params, tries=10):
    CACHE.mkdir(exist_ok=True)
    key = hashlib.sha1((url + json.dumps(params, sort_keys=True)).encode()).hexdigest()
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    for i in range(tries):
        wait = 10 * (i + 1)
        try:
            if len(json.dumps(params)) > 1500:
                r = S.post(url, data=params, timeout=180)
            else:
                r = S.get(url, params=params, timeout=180)
            if r.status_code == 429 or r.status_code >= 500 or "too many requests" in r.text[:300].lower():
                wait = int(r.headers.get("Retry-After") or 0) or min(30 * (i + 1), 300)
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            data = r.json()
            f.write_text(json.dumps(data))
            time.sleep(1.0)  # šetrné tempo vůči Wikimedia API
            return data
        except Exception as e:  # noqa: BLE001
            print(f"  ! {e} – zkouším znovu za {wait}s", file=sys.stderr, flush=True)
            time.sleep(wait)
    raise RuntimeError(f"Selhalo: {url}")


def sparql(q):
    return get("https://query.wikidata.org/sparql", {"query": q, "format": "json"})["results"]["bindings"]


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---------------------------------------------------------------- Wikidata

SEP = "\u001f"


def qid(v):
    return v.rsplit("/", 1)[1]


def wikidata_characters(items):
    """Vrátí {qid: {...}} se všemi údaji z Wikidat."""
    values = " ".join(f"wd:{q}" for q in items)
    ids = sorted({qid(r["c"]["value"]) for r in sparql(
        f"SELECT DISTINCT ?c WHERE {{ VALUES ?u {{ {values} }} ?c wdt:P1080 ?u . ?c wdt:P31/wdt:P279* wd:Q95074 . }}")},
        key=lambda q: int(q[1:]))
    print(f"    {len(ids)} postav", flush=True)
    chars = {q: {} for q in ids}
    for part in chunks(ids, 400):
        sub = "VALUES ?c { " + " ".join(f"wd:{q}" for q in part) + " }"
        query_batch(sub, chars)
    return chars


def query_batch(sub, chars):
    for r in sparql(f"""
      SELECT ?c ?label ?desc ?title WHERE {{
        {sub}
        OPTIONAL {{ ?c rdfs:label ?label FILTER(lang(?label)="en") }}
        OPTIONAL {{ ?c schema:description ?desc FILTER(lang(?desc)="en") }}
        OPTIONAL {{ ?a schema:about ?c; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title }}
      }}"""):
        c = chars.setdefault(qid(r["c"]["value"]), {})
        for k in ("label", "desc", "title"):
            if k in r:
                c[k] = r[k]["value"]

    for r in sparql(f"""
      SELECT ?c (GROUP_CONCAT(DISTINCT ?al; separator="{SEP}") AS ?vals) WHERE {{
        {sub}
        ?c skos:altLabel ?al FILTER(lang(?al)="en")
      }} GROUP BY ?c"""):
        chars.setdefault(qid(r["c"]["value"]), {})["aliases"] = r["vals"]["value"].split(SEP)

    for key, props in PROPS.items():
        pv = " ".join(f"wdt:{p}" for p in props)
        rows = sparql(f"""
          SELECT ?c (GROUP_CONCAT(DISTINCT ?vl; separator="{SEP}") AS ?vals) WHERE {{
            {sub}
            VALUES ?p {{ {pv} }}
            ?c ?p ?v . ?v rdfs:label ?vl FILTER(lang(?vl)="en")
          }} GROUP BY ?c""")
        for r in rows:
            chars.setdefault(qid(r["c"]["value"]), {})[key] = r["vals"]["value"].split(SEP)

    for r in sparql(f"""
      SELECT ?c ?fl ?fd ?inc WHERE {{
        {sub}
        OPTIONAL {{ ?c wdt:P4584 ?fa . ?fa rdfs:label ?fl FILTER(lang(?fl)="en")
                   OPTIONAL {{ ?fa wdt:P577 ?fd }} }}
        OPTIONAL {{ ?c wdt:P571 ?inc }}
      }}"""):
        c = chars.setdefault(qid(r["c"]["value"]), {})
        if "fl" in r and "firstApp" not in c:
            c["firstApp"] = r["fl"]["value"]
        for k in ("fd", "inc"):
            if k in r:
                m = re.match(r"(\d{4})", r[k]["value"])
                if m and 1890 < int(m.group(1)) < 2100:
                    c["year"] = min(c.get("year", 9999), int(m.group(1)))


# ---------------------------------------------------------------- Wikipedie

def wiki_info(titles):
    """Vrátí {title: {img, cats}} – obrázek z infoboxu a viditelné kategorie."""
    info = {}
    for n, part in enumerate(chunks(titles, 50)):
        params = {"action": "query", "format": "json", "formatversion": "2", "redirects": "1",
                  "titles": "|".join(part), "prop": "pageimages|categories", "piprop": "thumbnail",
                  "pithumbsize": "400", "pilicense": "any", "clshow": "!hidden", "cllimit": "max",
                  "maxlag": "5"}
        alias = {}
        while True:
            d = get("https://en.wikipedia.org/w/api.php", params)
            q = d.get("query", {})
            for x in q.get("normalized", []) + q.get("redirects", []):
                alias[x["to"]] = alias.get(x["from"], x["from"])
            for p in q.get("pages", []):
                rec = info.setdefault(alias.get(p["title"], p["title"]), {"img": None, "cats": []})
                if p.get("thumbnail"):
                    rec["img"] = p["thumbnail"]["source"]
                rec["cats"] += [c["title"][9:] for c in p.get("categories", [])]
            if "continue" not in d:
                break
            params = {**params, **d["continue"]}
        if n % 10 == 0:
            print(f"    wiki {n * 50}/{len(titles)}", flush=True)
    return info


def alignment(cats):
    t = " | ".join(cats).lower()
    anti = re.search(r"anti-?hero", t)
    villain = re.search(r"supervillain|villains", t)
    hero = re.search(r"superheroes|superheroines|heroes", re.sub(r"anti-?heroes", "", t))
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
    return {(c["biography"]["publisher"], norm(c["name"])): c for c in d}


# ---------------------------------------------------------------- Sestavení

def build(key, conf, akabab):
    print(f"[{key}] Wikidata…", flush=True)
    wd = wikidata_characters(conf["items"])
    titles = sorted({c["title"] for c in wd.values() if c.get("title")})
    print(f"[{key}] {len(wd)} postav, {len(titles)} článků na Wikipedii – obrázky a kategorie…", flush=True)
    winfo = wiki_info(titles)

    chars = []
    for q, e in wd.items():
        title = e.get("title")
        name = e.get("label") or (re.sub(r"\s*\(.*\)$", "", title) if title else None)
        if not name or re.fullmatch(r"Q\d+", name):
            continue
        w = winfo.get(title) or {"img": None, "cats": []}
        fa_label, year = e.get("firstApp"), e.get("year")
        # Wikipedie: kategorie „Comics characters introduced in 1963“ apod.
        cat_years = [int(m.group(1)) for cat in w["cats"]
                     for m in [re.search(r"introduced in (\d{4})$", cat)] if m]
        if cat_years:
            year = min([year] + cat_years) if year else min(cat_years)
        real = " ".join((e.get("given") or [])[:1] + (e.get("family") or [])[:1])
        types = [t for t in e.get("types", []) if not GENERIC_TYPES.match(t)]

        ak = akabab.get((conf["publisher"], norm(name)))
        if ak:
            akfa = ak["biography"]["firstAppearance"]
            if akfa and akfa != "-":
                fa_label = fa_label or akfa
                if not year:
                    m = re.findall(r"\b(19[3-9]\d|20[0-4]\d)\b", akfa)
                    year = int(m[-1]) if m else None
            if not real and ak["biography"]["fullName"]:
                real = ak["biography"]["fullName"]

        align = alignment(w["cats"]) or (ak["biography"]["alignment"] if ak and ak["biography"]["alignment"] != "-" else None)
        first = lambda k: (e.get(k) or [None])[0]  # noqa: E731
        c = {
            "id": q, "name": name, "wiki": title, "desc": e.get("desc"),
            "img": w["img"] or (ak["images"]["md"] if ak else None),
            "align": align, "year": year, "firstApp": fa_label, "realName": real or None,
            "aliases": (e.get("aliases") or [])[:15], "creators": e.get("creators", [])[:12],
            "gender": first("gender"), "species": types[:6], "occupation": e.get("occupation", [])[:12],
            "teams": e.get("teams", [])[:40], "relatives": e.get("relatives", [])[:25],
            "enemies": e.get("enemies", [])[:40], "abilities": e.get("abilities", [])[:40],
            "birthplace": first("pob"), "eyes": first("eyes"), "hair": first("hair"),
        }
        if ak:
            c["powerstats"] = ak["powerstats"]
            h = [x for x in ak["appearance"]["height"] if not x.startswith(("-", "0 "))]
            wgt = [x for x in ak["appearance"]["weight"] if not x.startswith(("-", "0 "))]
            c["height"] = " / ".join(h) or None
            c["weight"] = " / ".join(wgt) or None
            c["base"] = ak["work"]["base"] if ak["work"]["base"] not in ("-", "") else None
        chars.append({k: v for k, v in c.items() if v not in (None, [], "")})

    chars.sort(key=lambda c: c["name"].lower())
    return chars


# ---------------------------------------------------------------- Čeština

ALL_PROPS = sorted({p for props in PROPS.values() for p in props})


def add_czech(chars, dictionary):
    """Doplní české jméno, popis a název článku na české Wikipedii + slovník en -> cs."""
    by_id = {c["id"]: c for c in chars}
    pv = " ".join(f"wdt:{p}" for p in ALL_PROPS + ["P4584"])
    for part in chunks(list(by_id), 400):
        sub = "VALUES ?c { " + " ".join(f"wd:{q}" for q in part) + " }"
        for r in sparql(f"""
          SELECT ?c ?l ?d ?t WHERE {{
            {sub}
            OPTIONAL {{ ?c rdfs:label ?l FILTER(lang(?l)="cs") }}
            OPTIONAL {{ ?c schema:description ?d FILTER(lang(?d)="cs") }}
            OPTIONAL {{ ?a schema:about ?c; schema:isPartOf <https://cs.wikipedia.org/>; schema:name ?t }}
          }}"""):
            c = by_id[qid(r["c"]["value"])]
            if "l" in r and r["l"]["value"] != c["name"]:
                c["nameCs"] = r["l"]["value"]
            if "d" in r:
                c["descCs"] = r["d"]["value"]
            if "t" in r:
                c["wikiCs"] = r["t"]["value"]
        for r in sparql(f"""
          SELECT DISTINCT ?en ?cs WHERE {{
            {sub}
            VALUES ?p {{ {pv} }}
            ?c ?p ?v . ?v rdfs:label ?en FILTER(lang(?en)="en") . ?v rdfs:label ?cs FILTER(lang(?cs)="cs")
          }}"""):
            en, cs = r["en"]["value"], r["cs"]["value"]
            if en != cs:
                dictionary[en] = cs


def main():
    OUT.mkdir(exist_ok=True)
    print("Superhero API…", flush=True)
    akabab = load_akabab()
    dictionary = {}
    for key, conf in UNIVERSES.items():
        chars = build(key, conf, akabab)
        print(f"[{key}] čeština…", flush=True)
        add_czech(chars, dictionary)
        (OUT / f"{key}.json").write_text(json.dumps(chars, ensure_ascii=False, separators=(",", ":")))
        print(f"[{key}] hotovo: {len(chars)} postav, {sum(1 for c in chars if c.get('img'))} s obrázkem, "
              f"{sum(1 for c in chars if c.get('wikiCs'))} s českým článkem", flush=True)
    (OUT / "cs.json").write_text(json.dumps(dict(sorted(dictionary.items())), ensure_ascii=False, indent=0))
    print(f"slovník: {len(dictionary)} výrazů", flush=True)


if __name__ == "__main__":
    main()
