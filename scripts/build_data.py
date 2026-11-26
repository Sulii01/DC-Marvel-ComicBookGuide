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
OUT = ROOT / "data" / "base"   # mezivýsledek; finální data pro web vytváří scripts/build_fandom.py
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
        if name:
            name = re.sub(r"\s*\((comics|character|comic book character|DC Comics|Marvel Comics)\)$", "", name, flags=re.I)
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


# ---------------------------------------------------------------- Fandom (DC Database / Marvel Database)

FANDOM = {"dc": ("dc", ["Prime Earth", "New Earth"]), "marvel": ("marvel", ["Earth-616"])}


def fandom_api(sub, params):
    return get(f"https://{sub}.fandom.com/api.php", {"format": "json", "formatversion": "2", **params})


def add_fandom(chars, key):
    """Ke každé postavě najde její stránku na Fandom wiki (dc.fandom.com / marvel.fandom.com)."""
    sub, earths = FANDOM[key]
    by_id = {c["id"]: c for c in chars}
    # 1) odkazy uložené ve Wikidatech (vlastnost P6262 „Fandom article ID“)
    linked = {}
    for part in chunks(list(by_id), 400):
        vals = " ".join(f"wd:{q}" for q in part)
        for r in sparql(f'SELECT ?c ?f WHERE {{ VALUES ?c {{ {vals} }} ?c wdt:P6262 ?f FILTER(STRSTARTS(?f, "{sub}:")) }}'):
            linked.setdefault(qid(r["c"]["value"]), r["f"]["value"].split(":", 1)[1].replace("_", " "))

    # 2) kandidáti podle jména – skutečné jméno sdílené více postavami dostane jen ta nejznámější
    fame = lambda c: len(c.get("films", [])) + len(c.get("tv", [])) + len(c.get("teams", [])) + (5 if c.get("wiki") else 0)
    owner = {}
    for c in chars:
        rn = (c.get("realName") or "").strip()
        if rn and (rn not in owner or fame(c) > fame(owner[rn])):
            owner[rn] = c
    cands = {}
    for c in chars:
        bases = []
        if c.get("realName") and owner.get(c["realName"]) is c:
            bases.append(c["realName"])
        if not c.get("baseName"):
            bases.append(c["name"])
        lst = [linked[c["id"]]] if c["id"] in linked else []
        for b in bases:
            lst += [f"{b} ({e})" for e in earths] + [b]
        cands[c["id"]] = list(dict.fromkeys(lst))

    # 3) které kandidátní stránky existují a jsou to postavy (kategorie Characters)
    titles = sorted({t for lst in cands.values() for t in lst})
    exists = {}
    for n, part in enumerate(chunks(titles, 50)):
        d = fandom_api(sub, {"action": "query", "titles": "|".join(part), "redirects": "1",
                             "prop": "categories", "clcategories": "Category:Characters", "cllimit": "max"})
        q = d.get("query", {})
        back = {}
        for x in q.get("normalized", []) + q.get("redirects", []):
            back.setdefault(x["to"], []).extend(back.get(x["from"], [x["from"]]))
        for pg in q.get("pages", []):
            if pg.get("missing") or not pg.get("categories"):
                continue
            for t in back.get(pg["title"], [pg["title"]]):
                exists[t] = pg["title"]
        if n % 20 == 0:
            print(f"    fandom {n * 50}/{len(titles)}", flush=True)

    # 4) počet výskytů v komiksech – rozhoduje mezi Prime Earth / New Earth
    pages = sorted(set(exists.values()))
    size = {}
    for part in chunks(pages, 50):
        d = fandom_api(sub, {"action": "query", "prop": "categoryinfo",
                             "titles": "|".join(f"Category:{t}/Appearances" for t in part)})
        for pg in d.get("query", {}).get("pages", []):
            size[pg["title"][9:-12]] = pg.get("categoryinfo", {}).get("size", 0)

    found = 0
    for q, lst in cands.items():
        ok = [exists[t] for t in lst if t in exists]
        if not ok:
            continue
        # odkaz z Wikidat má přednost, jinak stránka s nejvíce výskyty
        best = ok[0] if q in linked and lst and lst[0] in exists else max(ok, key=lambda t: size.get(t, 0))
        by_id[q]["fandom"] = best
        if size.get(best):
            by_id[q]["apps"] = size[best]
        found += 1
    print(f"    fandom: {found}/{len(chars)} postav má stránku na {sub}.fandom.com", flush=True)


# ---------------------------------------------------------------- Filmy a seriály z Wikipedie

MEDIA_SUFFIXES = ("in film", "in television", "in other media")
# samostatné články o filmové verzi postavy (např. „Thanos (Marvel Cinematic Universe)“)
FRANCHISE_SUFFIXES = ("(Marvel Cinematic Universe)", "(DC Extended Universe)", "(DC Universe)")
SKIP_SECTION = re.compile(r"^(references|notes|external links|see also|video games?|novels?|books?|music|comics|toys|"
                          r"theme parks?|merchandise|literature|radio|stage|further reading|bibliography)", re.I)
TV_DESC = re.compile(r"television|tv series|web series|miniseries|animated series|anime|streaming series", re.I)
FILM_DESC = re.compile(r"\bfilm\b|movie", re.I)
SKIP_DESC = re.compile(r"video game|comic|novel|album|song|soundtrack|porn|parody|actor|actress|character|episode|"
                       r"franchise|film series|toy|book|magazine|list of|television channel|company|"
                       r"producer|director|screenwriter|lawyer|writer|actor|businessman", re.I)
# film/seriál musí mít komiksovou nebo superhrdinskou kategorii (jinak jde o zmínku, např. inspiraci nebo filmografii herce)
COMIC_CAT = re.compile(r"superhero|supervillain|comics|based on (?:DC|Marvel)|DC Comics|Marvel|DC Extended|DC Universe|"
                       r"DC Animated|Batman|Superman|Justice League|Spider-Man|X-Men|Avengers|Teen Titans|Lego|"
                       r"animated television series based on|vigilante", re.I)
NOT_COMIC_CAT = re.compile(r"adapted into comics|comics (?:writers|artists|historians|scholars|creators)|people|births|deaths", re.I)
BAD_TITLE = re.compile(r"\bXXX\b|porn|parody", re.I)


def _italic_links(html):
    """Odkazy na díla – na Wikipedii jsou názvy filmů a seriálů psané kurzívou."""
    out = []
    for m in re.finditer(r'<i>\s*<a href="/wiki/([^"#]+)[^"]*"[^>]*>|<a href="/wiki/([^"#]+)[^"]*"[^>]*>\s*<i>', html):
        t = requests.utils.unquote(m.group(1) or m.group(2)).replace("_", " ")
        if ":" in t and re.match(r"^(File|Category|Help|Wikipedia|Template|Special|Portal|Talk):", t):
            continue
        out.append(t)
    return out


def add_media_wiki(chars):
    """Doplní filmy a seriály z článků „<postava> in film / in television / in other media“."""
    base_of = {}
    for c in chars:
        if c.get("wiki"):
            base_of.setdefault(re.sub(r"\s*\([^)]*\)$", "", c["wiki"]), []).append(c)
    cands = [f"{b} {suf}" for b in base_of for suf in MEDIA_SUFFIXES + FRANCHISE_SUFFIXES]
    exists = {}
    for part in chunks(cands, 50):
        d = get("https://en.wikipedia.org/w/api.php", {"action": "query", "format": "json", "formatversion": "2",
                                                        "titles": "|".join(part), "redirects": "1"})
        q = d.get("query", {})
        back = {}
        for x in q.get("normalized", []) + q.get("redirects", []):
            back[x["to"]] = back.get(x["from"], x["from"])
        for pg in q.get("pages", []):
            if not pg.get("missing"):
                exists[back.get(pg["title"], pg["title"])] = pg["title"]
    print(f"    články o filmech/seriálech: {len(exists)}", flush=True)

    found = {}   # base -> {"films": [titles], "tv": [titles], "other": [titles]}
    for cand, page in exists.items():
        base, suf = next((cand[:-len(x) - 1], x) for x in MEDIA_SUFFIXES + FRANCHISE_SUFFIXES if cand.endswith(x))
        d = get("https://en.wikipedia.org/w/api.php", {"action": "parse", "format": "json", "formatversion": "2",
                                                        "page": page, "prop": "text", "disableeditsection": "1"})
        html = d.get("parse", {}).get("text", "")
        bucket = found.setdefault(base, {"films": [], "tv": [], "other": []})
        default = "films" if suf == "in film" or suf in FRANCHISE_SUFFIXES else "tv" if suf == "in television" else "other"
        parts = re.split(r'<h2[^>]*>', html)
        for i, part in enumerate(parts):
            head = re.sub(r"<[^>]+>", "", part[:300].split("</h2>")[0]).strip() if i else ""
            if SKIP_SECTION.match(head):
                continue
            kind = "films" if re.search(r"film|movie|cinema|theatrical", head, re.I) else \
                   "tv" if re.search(r"television|tv|animat|series", head, re.I) else default
            bucket[kind] += _italic_links(part)

    # Postavy bez samostatného článku „X in film“: sekce „In other media“ přímo v článku o postavě
    # (jen u postav, kde se film/seriál dá čekat – už nějaký mají, nebo mají hodně výskytů v komiksech)
    MEDIA_HEAD = re.compile(r"in other media|other media|adaptations|in film|in television|film|television", re.I)
    main_pages = {}
    for base, cs in base_of.items():
        if any(c.endswith(" " + x) and c[:-len(x) - 1] == base for c in exists for x in MEDIA_SUFFIXES):
            continue
        if any(c.get("films") or c.get("tv") or (c.get("apps") or 0) >= 150 for c in cs):
            main_pages[base] = cs[0]["wiki"]
    print(f"    články postav se sekcí o filmech: {len(main_pages)} ke kontrole", flush=True)
    for n, (base, page) in enumerate(sorted(main_pages.items())):
        d = get("https://en.wikipedia.org/w/api.php", {"action": "parse", "format": "json", "formatversion": "2",
                                                        "page": page, "prop": "text", "disableeditsection": "1"})
        html = d.get("parse", {}).get("text", "")
        bucket = {"films": [], "tv": [], "other": []}
        for part in re.split(r'<h2[^>]*>', html)[1:]:
            head = re.sub(r"<[^>]+>", "", part[:300].split("</h2>")[0]).strip()
            if not MEDIA_HEAD.search(head) or SKIP_SECTION.match(head):
                continue
            # podsekce (h3) určují druh díla
            for sub_part in re.split(r'<h3[^>]*>', part):
                sub_head = re.sub(r"<[^>]+>", "", sub_part[:300].split("</h3>")[0]).strip()
                if SKIP_SECTION.match(sub_head) or re.search(r"video game|novel|book|toy|music|radio|stage|theme park", sub_head, re.I):
                    continue
                kind = "films" if re.search(r"film|movie|cinema", sub_head, re.I) else \
                       "tv" if re.search(r"television|tv|animat|series|web", sub_head, re.I) else "other"
                bucket[kind] += _italic_links(sub_part)
        if any(bucket.values()):
            old = found.setdefault(base, {"films": [], "tv": [], "other": []})
            for k, v in bucket.items():
                old[k] += v
        if n % 200 == 0:
            print(f"    články postav {n}/{len(main_pages)}", flush=True)

    titles = sorted({t for b in found.values() for lst in b.values() for t in lst})
    info = {}
    for part in chunks(titles, 50):
        d = get("https://en.wikipedia.org/w/api.php", {"action": "query", "format": "json", "formatversion": "2",
                                                        "titles": "|".join(part), "redirects": "1", "prop": "description"})
        q = d.get("query", {})
        norm = {x["from"]: x["to"] for x in q.get("normalized", [])}
        redir = {x["from"]: x["to"] for x in q.get("redirects", [])}
        pages = {pg["title"]: pg for pg in q.get("pages", [])}
        for orig in part:
            t = norm.get(orig, orig)
            t = redir.get(t, t)
            pg = pages.get(t)
            if not pg or pg.get("missing"):
                continue
            desc = pg.get("description") or ""
            if not desc or SKIP_DESC.search(desc) or BAD_TITLE.search(pg["title"]):
                continue
            kind = "tv" if TV_DESC.search(desc) else "films" if FILM_DESC.search(desc) else None
            if not kind:
                continue
            y = re.search(r"\b(19\d{2}|20\d{2})\b", desc) or re.search(r"\((19\d{2}|20\d{2})\b", pg["title"])
            item = {"name": re.sub(r"\s*\([^)]*\)$", "", pg["title"]), "wiki": pg["title"], "kind": kind}
            if y:
                item["year"] = int(y.group(1))
            info[orig] = item

    # kategorie kandidátů – ponechat jen komiksová/superhrdinská díla
    ok_titles = set()
    cand = sorted({m["wiki"] for m in info.values()})
    for part in chunks(cand, 50):
        params = {"action": "query", "format": "json", "formatversion": "2", "titles": "|".join(part),
                  "prop": "categories", "clshow": "!hidden", "cllimit": "max"}
        cats = {}
        while True:
            d = get("https://en.wikipedia.org/w/api.php", params)
            for pg in d.get("query", {}).get("pages", []):
                cats.setdefault(pg["title"], []).extend(c["title"] for c in pg.get("categories", []))
            if "continue" not in d:
                break
            params = {**params, **d["continue"]}
        ok_titles |= {t for t, cs in cats.items()
                      if any(COMIC_CAT.search(c) and not NOT_COMIC_CAT.search(c) for c in cs)
                      and not any(re.search(r"\b(births|deaths|living people)\b", c, re.I) for c in cs)}
    print(f"    komiksová díla podle kategorií: {len(ok_titles)}/{len(cand)}", flush=True)

    added = 0
    for base, bucket in found.items():
        items = {}
        for lst in bucket.values():
            for t in lst:
                if t in info:
                    items[info[t]["wiki"]] = info[t]
        if not items:
            continue
        for c in base_of[base]:
            who = (c.get("baseName") or c["name"]).lower()
            items = {k: m for k, m in items.items() if k in ok_titles or who in m["name"].lower() or base.lower() in m["name"].lower()}
            for key in ("films", "tv"):
                new = [dict((k, v) for k, v in m.items() if k != "kind") for m in items.values() if m["kind"] == key]
                if not new:
                    continue
                wiki_keys = {m["wiki"].lower() for m in new}
                old = c.get(key, [])
                if len(new) >= 3:   # Wikidata cameo (např. „Cars“ u Batmana) vyřadit
                    old = [m for m in old if (m.get("wiki") or "").lower() in wiki_keys or who in m["name"].lower()]
                seen = {(m.get("wiki") or m["name"]).lower() for m in old}
                merged = old + [m for m in new if m["wiki"].lower() not in seen]
                merged.sort(key=lambda m: (m.get("year", 9999), m["name"]))
                added += len(merged) - len(c.get(key, []))
                c[key] = merged[:150]
    print(f"    filmy/seriály z Wikipedie: +{added}", flush=True)


EARTHS = {
    "dc": re.compile(r"\((Prime Earth|New Earth|Earth-One|Earth-Two|Earth-S|Earth-X|Earth-Four)\)$"),
    "marvel": re.compile(r"\(Earth-616\)$"),
}


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower())


def fandom_resolve_unmapped(chars, key):
    """Postavám bez Fandom stránky ji dohledá (rozcestník se jménem, pak vyhledávání).
    Stránka se přijme jen po ověření: je to stránka postavy (ne týmu) z hlavní reality
    a jméno postavy je v infoboxu jako SOUČASNÁ přezdívka nebo skutečné jméno.
    Pokud Wikidata znají skutečné jméno, musí souhlasit i to."""
    sub = FANDOM[key][0]
    earth = EARTHS[key]
    taken = {c["fandom"] for c in chars if c.get("fandom")}
    todo = [c for c in chars if not c.get("fandom")]
    names_of = {}
    for c in todo:
        names = [c.get("baseName") or c["name"], c.get("realName")]
        names_of[c["id"]] = [n for n in dict.fromkeys(n.strip() for n in names if n) if len(n) > 1]

    # 1) stránky se jménem postavy: rovnou stránka postavy, nebo rozcestník s odkazy
    bare = sorted({n for c in todo for n in names_of[c["id"]]})
    direct, links = {}, {}
    for part in chunks(bare, 50):
        params = {"action": "query", "titles": "|".join(part), "redirects": "1", "prop": "links",
                  "pllimit": "max", "plnamespace": "0"}
        back = {}
        while True:
            d = fandom_api(sub, params)
            q = d.get("query", {})
            for x in q.get("normalized", []) + q.get("redirects", []):
                back.setdefault(x["to"], set()).update(back.get(x["from"], {x["from"]}))
            for pg in q.get("pages", []):
                for o in back.get(pg["title"], {pg["title"]}) | {pg["title"]}:
                    if earth.search(pg["title"]):           # přesměrování přímo na postavu z hlavní reality
                        direct[o] = pg["title"]
                    links.setdefault(o, set()).update(l["title"] for l in pg.get("links", []) if earth.search(l["title"]))
            if "continue" not in d:
                break
            params = {**params, **d["continue"]}

    # 2) vyhledávání pro jména bez výsledku
    searched = {}
    for c in todo:
        for n in names_of[c["id"]][:1]:
            if n in direct or links.get(n):
                continue
            d = fandom_api(sub, {"action": "query", "list": "search", "srsearch": n, "srlimit": "10"})
            searched[n] = [r["title"] for r in d.get("query", {}).get("search", []) if earth.search(r["title"])]

    cands = sorted(({*direct.values()} | {t for ls in links.values() for t in ls}
                    | {t for ls in searched.values() for t in ls}) - taken)

    # 3) infobox kandidátů: šablona postavy, současná přezdívka, skutečné jméno
    info = {}
    for part in chunks(cands, 50):
        d = fandom_api(sub, {"action": "query", "titles": "|".join(part), "prop": "revisions",
                             "rvprop": "content", "rvslots": "main"})
        for pg in d.get("query", {}).get("pages", []):
            rev = (pg.get("revisions") or [{}])[0]
            text = rev.get("slots", {}).get("main", {}).get("content", "") or rev.get("content", "")

            def field(name):
                m = re.search(r"\|\s*" + name + r"\s*=\s*(.*)", text)
                if not m:
                    return set()
                v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", m.group(1))
                v = re.sub(r"\{\{[^}]*\}\}|<[^>]+>|'{2,3}", " ", v)
                return {_norm(x) for x in re.split(r"[;,]| or ", v) if _norm(x)}
            info[pg["title"]] = {
                "char": bool(re.search(r"Character Template", text)),
                "current": field("CurrentAlias") | field("Codename"),
                "real": field("RealName"),
            }
    size = {}
    for part in chunks(cands, 50):
        d = fandom_api(sub, {"action": "query", "prop": "categoryinfo",
                             "titles": "|".join(f"Category:{t}/Appearances" for t in part)})
        for pg in d.get("query", {}).get("pages", []):
            size[pg["title"][9:-12]] = pg.get("categoryinfo", {}).get("size", 0)

    def ok(page, c):
        i = info.get(page)
        if not i or not i["char"]:
            return False
        name = _norm(c.get("baseName") or c["name"])
        real = _norm(c.get("realName"))
        base = _norm(re.sub(r"\s*\(.*\)$", "", page))
        page_real = i["real"] | {base}
        if real and real not in page_real and not any(real in r or r in real for r in page_real):
            return False                      # Wikidata znají skutečné jméno a nesouhlasí
        return name == base or name in i["current"] or name in i["real"] or (real and real in page_real)

    def best(opts):
        # přednost: stránka bez dalšího přívlastku („(Clone)“, „(Inhuman)“…), pak nejvíc výskytů
        return max(opts, key=lambda t: (t.count("(") == 1, size.get(t, 0)))

    found = 0
    for c in sorted(todo, key=lambda c: -(len(c.get("films", [])) + len(c.get("tv", [])) + len(c.get("teams", [])))):
        opts = set()
        for n in names_of[c["id"]]:
            if n in direct:
                opts.add(direct[n])
            opts |= links.get(n, set())
            opts |= set(searched.get(n, []))
        opts = [t for t in opts if t not in taken and ok(t, c)]
        if opts:
            page = best(opts)
            c["fandom"] = page
            taken.add(page)
            if size.get(page):
                c["apps"] = size[page]
            found += 1
    print(f"    dohledáno na Fandomu (ověřeno): {found}/{len(todo)}", flush=True)


def fandom_images(chars, key):
    """Obrázky z Fandomu: doplní je postavám bez obrázku a nahradí duplicitní obrázky
    (např. Azrael a Jean-Paul Valley mají na Wikipedii jeden společný článek)."""
    sub = FANDOM[key][0]
    # dvě postavy na stejné Fandom stránce: duplicitní záznam z Wikidat vyřadit, jinak stránku nechat jen jedné
    fame = lambda c: (bool(c.get("wiki")), len(c.get("films", [])) + len(c.get("tv", [])) + len(c.get("teams", [])), -int(c["id"][1:]))
    by_page = {}
    for c in chars:
        if c.get("fandom"):
            by_page.setdefault(c["fandom"], []).append(c)
    drop = set()
    for page, group in by_page.items():
        if len(group) < 2:
            continue
        group.sort(key=fame, reverse=True)
        keep = group[0]
        base = lambda c: re.sub(r"\s*\(.*\)$", "", c.get("baseName") or c["name"]).lower()
        for c in group[1:]:
            if not c.get("wiki") or base(c) == base(keep) or base(keep).startswith(base(c)) or base(c).startswith(base(keep)) and not c.get("wiki"):
                drop.add(c["id"])
            else:
                c.pop("fandom", None)
                c.pop("apps", None)
    if drop:
        chars[:] = [c for c in chars if c["id"] not in drop]
        print(f"    duplicitní záznamy vyřazeny: {len(drop)}", flush=True)
        disambiguate(chars)   # jména bez dvojníků už dovětek v závorce nepotřebují
    titles = sorted({c["fandom"] for c in chars if c.get("fandom")})
    thumbs = {}
    for part in chunks(titles, 50):
        d = fandom_api(sub, {"action": "query", "titles": "|".join(part), "prop": "pageimages",
                             "piprop": "thumbnail", "pithumbsize": "400"})
        for pg in d.get("query", {}).get("pages", []):
            if pg.get("thumbnail"):
                thumbs[pg["title"]] = pg["thumbnail"]["source"]
    added = replaced = 0
    for c in chars:
        # obrázky z Wikipedie se už nepoužívají
        if "wikimedia.org" in (c.get("img") or ""):
            c.pop("img")
        f = thumbs.get(c.get("fandom"))
        if f:
            c["fimg"] = f
            if c.get("img") != f:
                c["img"] = f      # Fandom má přednost
                added += 1
    same = {}
    for c in chars:
        if c.get("img"):
            same.setdefault(c["img"], []).append(c)
    for group in same.values():
        if len(group) < 2:
            continue
        # obrázek patří postavě, jejíž jméno odpovídá názvu článku na Wikipedii
        owner = next((c for c in group if _strip(c.get("wiki")).lower() == (c.get("baseName") or c["name"]).lower()), group[0])
        for c in group:
            if c is owner:
                continue
            if c.get("fimg") and c["fimg"] != c.get("img"):
                c["img"] = c["fimg"]
            else:
                c.pop("img", None)
            replaced += 1
    for c in chars:
        c.pop("fimg", None)
    print(f"    obrázky z Fandomu: {added} doplněno, {replaced} duplicit nahrazeno", flush=True)


# ---------------------------------------------------------------- Stejná jména

GENERIC_PAREN = re.compile(r"^(comics|character|comic book character|DC Comics|Marvel Comics|DC Comics character|"
                           r"Marvel Comics character|superhero|supervillain|comics character)$", re.I)
AKABAB_KEYS = ("powerstats", "height", "weight", "base")


def _strip(title):
    return re.sub(r"\s*\([^)]*\)$", "", title or "")


def _paren(title):
    m = re.search(r"\(([^)]*)\)$", title or "")
    return m.group(1) if m and not GENERIC_PAREN.match(m.group(1)) else None


def _short(text, n=40):
    return text if len(text) <= n else text[:n].rsplit(" ", 1)[0] + "…"


def disambiguate(chars):
    """Postavy se stejným jménem (Batman, Black Widow…) rozliší dovětkem v závorce.
    Hlavní postava (článek na Wikipedii se stejným názvem) jméno nemění."""
    groups = {}
    for c in chars:
        c["name"] = re.sub(r"\s+\(.*\)$", "", c["name"]) if c.get("baseName") else c["name"]
        groups.setdefault(c["name"].lower(), []).append(c)
    for same in groups.values():
        if len(same) < 2:
            continue
        def rank(c):
            exact = _strip(c.get("wiki")).lower() == c["name"].lower() and not _paren(c.get("wiki"))
            return (not exact, not c.get("wiki"), c.get("year") or 9999, int(c["id"][1:]))
        same.sort(key=rank)
        exact = rank(same[0])[0] is False
        primary = same[0] if exact else None
        # data ze Superhero API patří jen jedné (nejznámější) verzi
        fame = lambda c: len(c.get("films", [])) + len(c.get("tv", [])) + len(c.get("teams", [])) + bool(c.get("wiki")) * 5
        owner = primary or max(same, key=fame)
        akabab_img = next((c["img"] for c in same if "akabab" in (c.get("img") or "")), None)
        akabab = next(({k: c[k] for k in AKABAB_KEYS if k in c} for c in same if "powerstats" in c), {})
        for c in same:
            if c is not owner:
                if "akabab" in (c.get("img") or ""):
                    c.pop("img", None)
                for k in AKABAB_KEYS:
                    c.pop(k, None)
        owner.update(akabab)
        if akabab_img and not owner.get("img"):
            owner["img"] = akabab_img
        for c in same:
            if c is primary:
                continue
            wiki, base = c.get("wiki"), _strip(c.get("wiki"))
            if wiki and _paren(wiki):
                tag = _paren(wiki)
            elif wiki and base.lower() != c["name"].lower():
                tag = base
            elif c.get("realName") and c["realName"] != (primary or {}).get("realName"):
                tag = c["realName"]
            elif c.get("desc"):
                m = re.search(r"in (?:the )?(.+?)(?: [Uu]niverse)?$", c["desc"])
                tag = _short(m.group(1) if m and "alternate" in c["desc"] else c["desc"])
            else:
                tag = str(c.get("year") or c["id"])
            c["baseName"] = c["name"]
            c["name"] = f'{c["name"]} ({tag})'
            if c.get("nameCs"):
                c["nameCs"] = f'{c["nameCs"]} ({tag})'
        # pořád stejné? doplnit rok / ID
        seen = {}
        for c in same:
            seen.setdefault(c["name"].lower(), []).append(c)
        for lst in seen.values():
            for c in lst[1:]:
                c["name"] = f'{c["name"][:-1]}, {c.get("year") or c["id"]})' if c["name"].endswith(")") else f'{c["name"]} ({c.get("year") or c["id"]})'
    chars.sort(key=lambda c: c["name"].lower())


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


# ---------------------------------------------------------------- Filmy a seriály

MEDIA_TYPES = ('(wd:Q11424 "film") (wd:Q202866 "film") (wd:Q506240 "film") (wd:Q24862 "film") '
               '(wd:Q5398426 "tv") (wd:Q581714 "tv") (wd:Q1259759 "tv") (wd:Q526877 "tv") '
               '(wd:Q117467246 "tv") (wd:Q15416 "tv") (wd:Q63952888 "tv")')


def add_media(chars):
    """Filmy a seriály, ve kterých se postava (nebo její filmová/seriálová verze) objevila."""
    by_id = {c["id"]: c for c in chars}
    media = {}
    for part in chunks(list(by_id), 100):
        sub = "VALUES ?c { " + " ".join(f"wd:{q}" for q in part) + " }"
        for r in sparql(f"""
          SELECT ?c ?w ?kind ?wl ?wlc ?title (MIN(?d) AS ?date) WHERE {{
            {sub}
            {{ ?c wdt:P1441 ?w }} UNION {{ ?w wdt:P674 ?c }}
            UNION {{ ?x wdt:P144 ?c . ?x wdt:P1441 ?w }} UNION {{ ?x wdt:P144 ?c . ?w wdt:P674 ?x }}
            UNION {{ ?c wdt:P4969 ?x . ?x wdt:P1441 ?w }} UNION {{ ?c wdt:P4969 ?x . ?w wdt:P674 ?x }}
            VALUES (?t ?kind) {{ {MEDIA_TYPES} }}
            ?w wdt:P31 ?t .
            FILTER NOT EXISTS {{ ?w wdt:P136 ?g . VALUES ?g {{ wd:Q185529 wd:Q2483208 wd:Q7148982 }} }}
            ?w rdfs:label ?wl FILTER(lang(?wl)="en" && !REGEX(?wl, "XXX|porn|parody", "i"))
            OPTIONAL {{ ?w rdfs:label ?wlc FILTER(lang(?wlc)="cs") }}
            OPTIONAL {{ ?a schema:about ?w; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title }}
            OPTIONAL {{ ?w wdt:P577 ?d }}
          }} GROUP BY ?c ?w ?kind ?wl ?wlc ?title"""):
            c = qid(r["c"]["value"])
            kind = r["kind"]["value"]
            item = {"name": r["wl"]["value"]}
            if "wlc" in r and r["wlc"]["value"] != item["name"]:
                item["nameCs"] = r["wlc"]["value"]
            if "title" in r:
                item["wiki"] = r["title"]["value"]
            if "date" in r:
                m = re.match(r"(\d{4})", r["date"]["value"])
                if m:
                    item["year"] = int(m.group(1))
            media.setdefault((c, kind), {})[qid(r["w"]["value"])] = item
    for (c, kind), works in media.items():
        lst = sorted(works.values(), key=lambda x: (x.get("year", 9999), x["name"]))
        by_id[c]["films" if kind == "film" else "tv"] = lst[:80]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("Superhero API…", flush=True)
    akabab = load_akabab()
    dictionary = {}
    for key, conf in UNIVERSES.items():
        chars = build(key, conf, akabab)
        print(f"[{key}] čeština…", flush=True)
        add_czech(chars, dictionary)
        print(f"[{key}] filmy a seriály…", flush=True)
        add_media(chars)
        add_media_wiki(chars)
        disambiguate(chars)
        print(f"[{key}] Fandom…", flush=True)
        add_fandom(chars, key)
        fandom_resolve_unmapped(chars, key)
        fandom_images(chars, key)
        (OUT / f"{key}.json").write_text(json.dumps(chars, ensure_ascii=False, separators=(",", ":")))
        print(f"[{key}] hotovo: {len(chars)} postav, {sum(1 for c in chars if c.get('img'))} s obrázkem, "
              f"{sum(1 for c in chars if c.get('wikiCs'))} s českým článkem, "
              f"{sum(1 for c in chars if c.get('films'))} s filmy, {sum(1 for c in chars if c.get('tv'))} se seriály", flush=True)
    (ROOT / "data" / "cs.json").write_text(json.dumps(dict(sorted(dictionary.items())), ensure_ascii=False, indent=0))
    print(f"slovník: {len(dictionary)} výrazů", flush=True)


def postprocess_only():
    """Jen přepočítá rozlišení stejných jmen v hotových datech (bez stahování)."""
    for key in UNIVERSES:
        f = OUT / f"{key}.json"
        chars = json.loads(f.read_text())
        for c in chars:            # přiřazení k Fandomu vždy spočítat znovu
            c.pop("fandom", None)
            c.pop("apps", None)
            if "static.wikia" in (c.get("img") or ""):
                c.pop("img")       # obrázek z Fandomu se přiřadí znovu podle ověřené stránky
        disambiguate(chars)
        print(f"[{key}] Fandom…", flush=True)
        add_fandom(chars, key)
        fandom_resolve_unmapped(chars, key)
        fandom_images(chars, key)
        if "--media" in sys.argv:
            add_media_wiki(chars)
        f.write_text(json.dumps(chars, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    postprocess_only() if "--postprocess" in sys.argv else main()
