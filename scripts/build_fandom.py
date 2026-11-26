#!/usr/bin/env python3
"""Rozšíří databázi o všechny postavy z Fandom wiki (Marvel Database, DC Database)
s aspoň MIN_APPS výskyty v komiksech a doplní jim údaje z infoboxu.

Vstup:  data/base/<univerzum>.json  (výstup scripts/build_data.py – Wikidata, filmy, seriály, čeština)
Výstup: data/<univerzum>.json        lehký index pro seznam postav
        data/<univerzum>/NN.json     detaily postav rozdělené do SHARDS souborů

Ukládají se jen fakta z infoboxu (jména, týmy, výška…) a odkazy na obrázky.
Text příběhu se do repozitáře neukládá – stránka postavy ho načítá živě s odkazem na zdroj.

Spuštění:  python3 scripts/build_fandom.py
"""
import json, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data as B   # noqa: E402  (HTTP s cache, chunks, disambiguate…)

ROOT = B.ROOT
BASE = ROOT / "data" / "base"
OUT = ROOT / "data"
CACHE = ROOT / ".cache" / "fandom-fields"
MIN_APPS = 10
SHARDS = 64

WIKIS = {
    "marvel": {"sub": "marvel", "cats": ["Category:Earth-616/Characters"]},
    "dc": {"sub": "dc", "cats": ["Category:New Earth Characters", "Category:Prime Earth Characters",
                                 "Category:Earth-One Characters", "Category:Earth-Two Characters"]},
}

# pole infoboxu -> klíč v datech
FIELDS = {
    "CurrentAlias": "alias", "Name": "realName", "RealName": "realName", "Aliases": "aliasesF",
    "Nicknames": "nicknames", "Affiliation": "affiliation", "Relatives": "relativesF",
    "MaritalStatus": "marital", "Gender": "genderF", "Height": "height", "Weight": "weight",
    "Eyes": "eyesF", "Hair": "hairF", "Skin": "skin", "UnusualFeatures": "features",
    "Origin": "origin", "Universe": "universe", "Reality": "universe", "PlaceOfBirth": "birthplaceF",
    "Identity": "identity", "Citizenship": "citizenship", "Occupation": "occupationF",
    "Education": "education", "BaseOfOperations": "base", "Creators": "creatorsF", "First": "firstF",
}
LIST_KEYS = {"aliasesF", "nicknames", "affiliation", "relativesF", "creatorsF", "occupationF"}


# ---------------------------------------------------------------- úprava wikitextu na čistý text

def clean(v):
    v = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"<br\s*/?>", "; ", v)
    v = re.sub(r"<[^>]+>", "", v)
    for _ in range(4):   # šablony {{x|a|b}} -> poslední argument (u {{cl|Komiks}} název komiksu)
        v = re.sub(r"\{\{([^{}]*)\}\}", lambda m: m.group(1).split("|")[-1] if "|" in m.group(1) else "", v)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", v)
    v = re.sub(r"'{2,3}", "", v)
    v = re.sub(r"\s+", " ", v).strip(" ;,")
    return v


def split_list(v, limit=40):
    parts = [p.strip(" ;,.") for p in re.split(r";|\n|\*|, (?=[A-Z])", v)]
    out = []
    for p in parts:
        p = re.sub(r"\s*\((?:formerly|former|deceased|currently)[^)]*\)?$", "", p, flags=re.I).strip()
        if 1 < len(p) <= 80 and p not in out:
            out.append(p)
    return out[:limit]


def parse_fields(text):
    data = {}
    for fld, key in FIELDS.items():
        m = re.search(r"^\|\s*" + fld + r"\s*=\s*(.*?)(?=^\||^\}\}|\Z)", text, re.M | re.S)
        if not m:
            continue
        v = clean(m.group(1))
        if not v or v.lower() in ("none", "unknown", "n/a"):
            continue
        if key in LIST_KEYS:
            lst = split_list(v)
            if lst:
                data[key] = lst
        elif key not in data:
            data[key] = v[:300]
    return data


# ---------------------------------------------------------------- Fandom API

def api(sub, params, cache=True):
    params = {"format": "json", "formatversion": "2", **params}
    if cache:
        return B.get(f"https://{sub}.fandom.com/api.php", params)
    for i in range(8):   # velké odpovědi (wikitext) se necachují celé, ukládají se jen vytažená pole
        try:
            r = B.S.get(f"https://{sub}.fandom.com/api.php", params=params, timeout=180)
            if r.status_code == 429 or r.status_code >= 500:
                raise RuntimeError(f"HTTP {r.status_code}")
            time.sleep(1.0)
            return r.json()
        except Exception as e:  # noqa: BLE001
            print(f"  ! {e} – zkouším znovu", file=sys.stderr, flush=True)
            time.sleep(15 * (i + 1))
    raise RuntimeError("Fandom nedostupný")


def category_members(sub, cat):
    out, cont = [], {}
    while True:
        d = api(sub, {"action": "query", "list": "categorymembers", "cmtitle": cat, "cmlimit": "500",
                      "cmtype": "page", "cmprop": "ids|title", **cont})
        out += d.get("query", {}).get("categorymembers", [])
        if "continue" not in d:
            return out
        cont = {"cmcontinue": d["continue"]["cmcontinue"]}


def appearance_counts(sub, titles):
    size = {}
    for n, part in enumerate(B.chunks(titles, 50)):
        d = api(sub, {"action": "query", "prop": "categoryinfo",
                      "titles": "|".join(f"Category:{t}/Appearances" for t in part)})
        for pg in d.get("query", {}).get("pages", []):
            size[pg["title"][9:-12]] = pg.get("categoryinfo", {}).get("size", 0)
        if n % 100 == 0:
            print(f"    výskyty {n * 50}/{len(titles)}", flush=True)
    return size


def page_details(sub, titles):
    """Pole z infoboxu, kategorie (rok debutu, zařazení) a obrázek – s vlastní cache po stránkách."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cf = CACHE / f"{sub}.json"
    cache = json.loads(cf.read_text()) if cf.exists() else {}
    todo = [t for t in titles if t not in cache]
    for n, part in enumerate(B.chunks(todo, 50)):
        d = api(sub, {"action": "query", "titles": "|".join(part), "prop": "revisions|pageimages|categories",
                      "rvprop": "content", "rvslots": "main", "piprop": "thumbnail", "pithumbsize": "400",
                      "cllimit": "max", "clshow": "!hidden"}, cache=False)
        for pg in d.get("query", {}).get("pages", []):
            rev = (pg.get("revisions") or [{}])[0]
            text = rev.get("slots", {}).get("main", {}).get("content", "") or ""
            cats = [c["title"][9:] for c in pg.get("categories", [])]
            rec = parse_fields(text) if text else {}
            debut = [int(m.group(1)) for c in cats for m in [re.match(r"(\d{4}) Character Debuts$", c)] if m]
            if debut:
                rec["year"] = min(debut)
            if "Good Characters" in cats:
                rec["align"] = "good"
            elif "Bad Characters" in cats:
                rec["align"] = "bad"
            elif "Neutral Characters" in cats:
                rec["align"] = "neutral"
            if pg.get("thumbnail"):
                rec["img"] = pg["thumbnail"]["source"]
            rec["pageid"] = pg.get("pageid")
            cache[pg["title"]] = rec
        if n % 20 == 0:
            cf.write_text(json.dumps(cache, ensure_ascii=False))
            print(f"    infoboxy {n * 50}/{len(todo)}", flush=True)
    cf.write_text(json.dumps(cache, ensure_ascii=False))
    return cache


# ---------------------------------------------------------------- sestavení

def display_name(title, rec):
    alias = (rec.get("alias") or "").split(";")[0].split(",")[0].strip()
    alias = re.sub(r"\s*\(.*?\)\s*", " ", alias).strip()
    if alias and len(alias) <= 40 and not re.match(r"^(none|unknown|formerly)", alias, re.I):
        return alias
    return re.sub(r"\s*\(.*\)$", "", title)


def merge(chars, key, conf):
    sub = conf["sub"]
    by_page = {c["fandom"]: c for c in chars if c.get("fandom")}

    print(f"[{key}] seznam postav z kategorií…", flush=True)
    members = {}
    for cat in conf["cats"]:
        for m in category_members(sub, cat):
            members[m["title"]] = m["pageid"]
    print(f"[{key}] {len(members)} postav v hlavních realitách", flush=True)

    titles = sorted(members)
    size = appearance_counts(sub, titles)
    keep = sorted({t for t in titles if size.get(t, 0) >= MIN_APPS} | set(by_page))
    print(f"[{key}] s aspoň {MIN_APPS} výskyty: {len(keep)}", flush=True)

    details = page_details(sub, keep)
    keep_set = set(keep)

    # varianty (klon, zombie, LMD…) přepojit na hlavní stránku postavy, pokud existuje a je volná
    VARIANT = re.compile(r"\((?:[^()]*\b(?:Clone|Zombie|LMD|Skrull|Duplicate|Doppelganger|Impostor|Heroes Reborn|"
                         r"Robot|Android|Simulacrum|Decoy|Life Model)\b[^()]*)\)\s*\(", re.I)
    for c in list(by_page.values()):
        if VARIANT.search(c["fandom"]):
            main = re.sub(r"\s*\([^()]*\)(?=\s*\([^()]*\)$)", "", c["fandom"])
            if main in keep_set and main not in by_page:
                del by_page[c["fandom"]]
                c["fandom"] = main
                by_page[main] = c
            elif main in by_page:
                # hlavní stránku už má jiný záznam téže osoby (např. Prowler × Hornet = Hobie Brown):
                # variantu vyřadit a její jméno nechat jako přezdívku, aby se dala dál vyhledat
                holder = by_page[main]
                del by_page[c["fandom"]]
                chars.remove(c)
                name = c.get("baseName") or c["name"]
                if name not in holder.get("aliases", []):
                    holder["aliases"] = [name] + holder.get("aliases", [])

    # stávající postavy bez Fandom stránky – párování podle jména (aby nevznikaly duplicity)
    def nn(x):
        return B._norm(re.sub(r"\s*\(.*\)$", "", x or ""))
    unmapped = {}
    for c in chars:
        if not c.get("fandom"):
            unmapped.setdefault(nn(c.get("baseName") or c["name"]), []).append(c)

    added = enriched = 0
    for t in keep:
        rec = details.get(t, {})
        c = by_page.get(t)
        if c is None:
            cands = unmapped.get(nn(display_name(t, rec)), [])
            same = [x for x in cands if not x.get("realName") or not rec.get("realName")
                    or B._norm(x["realName"]) == B._norm(rec["realName"])]
            if same:
                c = same[0]
                cands.remove(c)
                c["fandom"] = t
                by_page[t] = c
        if c is None and VARIANT.search(t):
            continue          # klon, LMD, Heroes Reborn… jako samostatná postava jen překáží
        if c is None:
            c = {"id": f"F{rec.get('pageid') or members.get(t)}", "name": display_name(t, rec), "fandom": t}
            chars.append(c)
            added += 1
        else:
            enriched += 1
        if size.get(t):
            c["apps"] = size[t]
        # údaje z Fandomu doplní jen to, co chybí (Wikidata/ruční data mají přednost)
        c.setdefault("realName", rec.get("realName"))
        c.setdefault("year", rec.get("year"))
        c.setdefault("align", rec.get("align"))
        if rec.get("img"):
            c["img"] = rec["img"]
        for k in ("alias", "aliasesF", "nicknames", "affiliation", "relativesF", "marital", "genderF", "height",
                  "weight", "eyesF", "hairF", "skin", "features", "origin", "universe", "birthplaceF", "identity",
                  "citizenship", "occupationF", "education", "base", "creatorsF", "firstF"):
            if rec.get(k) and not c.get(k):
                c[k] = rec[k]
        if not c.get("firstApp") and rec.get("firstF"):
            c["firstApp"] = rec["firstF"]
        for k in [k for k, v in c.items() if v in (None, "", [])]:
            del c[k]
    print(f"[{key}] přidáno {added} nových postav, doplněno {enriched} stávajících", flush=True)


# ---------------------------------------------------------------- výstup: index + detaily po částech

INDEX_KEYS = ("id", "name", "nameCs", "img", "align", "year", "realName", "aliases", "alias", "apps")


def shard_of(cid):
    h = 0
    for ch in cid:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % SHARDS


def write(chars, key):
    chars.sort(key=lambda c: c["name"].lower())
    index = []
    for c in chars:
        row = {k: c[k] for k in INDEX_KEYS if c.get(k) not in (None, "", [])}
        if "aliases" in row:
            row["aliases"] = row["aliases"][:6]
        index.append(row)
    (OUT / f"{key}.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    d = OUT / key
    d.mkdir(exist_ok=True)
    for f in d.glob("*.json"):
        f.unlink()
    shards = {}
    for c in chars:
        shards.setdefault(shard_of(c["id"]), {})[c["id"]] = c
    for n, part in shards.items():
        (d / f"{n:02d}.json").write_text(json.dumps(part, ensure_ascii=False, separators=(",", ":")))
    print(f"[{key}] zapsáno: {len(chars)} postav, index {(OUT / f'{key}.json').stat().st_size // 1024} kB", flush=True)


def clean_media(data):
    """Vyřadí zjevně chybná díla: přehledové články („Batman in film“) a filmy/seriály
    druhého vydavatele (např. „Eternals“ u Supermana), které se do dat dostaly z odkazů v textu."""
    use = {}
    for key, chars in data.items():
        for c in chars:
            for kind in ("films", "tv"):
                for m in c.get(kind, []):
                    w = (m.get("wiki") or m["name"]).lower()
                    use.setdefault(w, {}).setdefault(key, 0)
                    use[w][key] += 1
    removed = 0
    for key, chars in data.items():
        for c in chars:
            for kind in ("films", "tv"):
                keep = []
                for m in c.get(kind, []):
                    w = (m.get("wiki") or m["name"]).lower()
                    u = use[w]
                    other = max(v for k, v in u.items() if k != key) if len(u) > 1 else 0
                    if re.search(r"\bin (film|television|other media)$", w) or (other >= 3 and other > 2 * u[key]):
                        removed += 1
                        continue
                    keep.append(m)
                if c.get(kind):
                    c[kind] = keep
    print(f"    vyřazeno chybných děl: {removed}", flush=True)


def main():
    data = {}
    for key, conf in WIKIS.items():
        chars = json.loads((BASE / f"{key}.json").read_text())
        merge(chars, key, conf)
        B.disambiguate(chars)
        data[key] = chars
    clean_media(data)
    for key, chars in data.items():
        write(chars, key)


if __name__ == "__main__":
    main()
