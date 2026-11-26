# DC-Marvel-ComicBookGuide

Neoficiální fanouškovský průvodce postavami Marvelu a DC. Čistě statický web (HTML + CSS + JS), bez buildu.

## Stránky
- `index.html` – výběr univerza kliknutím na logo Marvel / DC
- `universe.html?u=marvel|dc` – mřížka „hlav“ postav se jménem nad obrázkem; hledání, řazení A→Z, Z→A, od nejnovějších, od nejstarších (podle roku prvního výskytu) a filtr hrdina / záporák / antihrdina
- `character.html?u=…&id=…` – detail postavy: obrázek celé postavy, origin story, specifikace, schopnosti, vzhled a na konci seznam komiksů

## Zdroje dat (načítají se v prohlížeči za běhu)
- **Superhero API** (`akabab/superhero-api` přes jsDelivr) – seznam postav, portréty, specifikace, první výskyt, zařazení
- **Wikipedie** (MediaWiki API) – origin story / biografie postavy, obrázek celé postavy z infoboxu a seznam komiksů (souborná vydání + série z historie vydávání). Text je pod licencí CC BY-SA 4.0, na stránce je vždy uveden odkaz na zdroj.

## Loga
Oficiální loga do repa nejsou přiložená. Ulož je jako `assets/marvel-logo.png` a `assets/dc-logo.png` a úvodní stránka je automaticky použije (jinak se zobrazí textová náhrada).

## Spuštění
```bash
python3 -m http.server 8000
```
a otevři http://localhost:8000. Lze nasadit i na GitHub Pages.
