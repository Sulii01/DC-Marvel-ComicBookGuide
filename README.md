# DC-Marvel-ComicBookGuide

Neoficiální fanouškovský průvodce postavami Marvelu a DC. Čistě statický web (HTML + CSS + JS), bez buildu.

## Stránky
- `index.html` – výběr univerza kliknutím na logo Marvel / DC
- `universe.html?u=marvel|dc` – mřížka „hlav“ postav se jménem nad obrázkem; hledání, řazení A→Z, Z→A, od nejnovějších, od nejstarších (podle roku prvního výskytu) a filtr hrdina / záporák / antihrdina
- `character.html?u=…&id=…` – detail postavy: obrázek celé postavy, origin story, specifikace, schopnosti, vzhled a na konci seznam komiksů

## Zdroje dat
Databáze postav je uložená v `data/marvel.json` a `data/dc.json`. Vytváří ji skript:

```bash
python3 scripts/build_data.py
```

- **Wikidata** (CC0): seznam všech postav, které mají v Wikidatech univerzum Marvel (Earth-616) nebo DC Universe, včetně jmen, přezdívek, tvůrců, týmů, příbuzných, nepřátel, schopností a prvního výskytu.
- **Wikipedie**: obrázek z infoboxu a kategorie, ze kterých se určuje hrdina / záporák / antihrdina. Origin story, větší obrázek a seznam komiksů s obálkami si stránka postavy načítá živě z článku, vždy s odkazem na zdroj (CC BY-SA 4.0).
- **Superhero API** (akabab): statistiky schopností a výška/váha, kde existují.

## Vlastní obrázky postav
Ulož obrázek do `assets/characters/` a přidej řádek do `IMAGE_OVERRIDES` v `js/data.js` (klíč je Wikidata ID postavy, je vidět v URL stránky postavy). Batman už je připravený, stačí nahrát `assets/characters/batman.jpg`.

## Loga
Oficiální loga do repa nejsou přiložená. Ulož je jako `assets/marvel-logo.png` a `assets/dc-logo.png` a úvodní stránka je automaticky použije (jinak se zobrazí textová náhrada).

## Spuštění
```bash
python3 -m http.server 8000
```
a otevři https://sulii01.github.io/DC-Marvel-ComicBookGuide/
