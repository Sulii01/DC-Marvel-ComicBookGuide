// Jazyk webu: čeština (výchozí) / angličtina. Přepínač je vpravo nahoře na každé stránce.

const STRINGS = {
  cs: {
    'site.lead': 'Vyber si univerzum. Hrdinové, záporáci, antihrdinové – všichni na jednom místě.',
    'site.note': 'Neoficiální fanouškovský web. Marvel a DC a všechny postavy jsou ochranné známky svých vlastníků. Data postav: Marvel Database a DC Database (Fandom, CC BY-SA), Wikidata, Superhero API.',
    'nav.choose': 'Výběr univerza',
    'u.characters': '{u} postavy',
    'u.switch': 'Přepnout na',
    'u.search': 'Hledat',
    'u.searchPh': 'Jméno postavy…',
    'u.sort': 'Řadit',
    'u.sort.az': 'A → Z',
    'u.sort.za': 'Z → A',
    'u.sort.new': 'Od nejnovějších',
    'u.sort.old': 'Od nejstarších',
    'u.type': 'Typ postavy',
    'u.type.all': 'Všechny',
    'u.type.good': 'Hrdinové',
    'u.type.bad': 'Záporáci',
    'u.type.neutral': 'Antihrdinové / neutrální',
    'u.loading': 'Načítám postavy…',
    'u.none': 'Žádná postava neodpovídá filtru.',
    'u.count': '{n} z {total}',
    'align.good': 'Hrdina',
    'align.bad': 'Záporák',
    'align.neutral': 'Antihrdina',
    'c.loading': 'Načítám postavu…',
    'c.notFound': 'Postava nebyla nalezena.',
    'c.origin': 'Příběh a původ postavy',
    'c.originLoading': 'Načítám příběh z Fandom wiki…',
    'c.originError': 'Příběh se nepodařilo načíst ({e}).',
    'c.originEnOnly': '',
    'c.translate': 'Přeložit do češtiny',
    'c.translating': 'Překládám…',
    'c.translateGoogle': 'Přeložit pomocí Google Překladače',
    'c.machine': 'Strojový překlad z angličtiny.',
    'c.untranslated': 'Tento prohlížeč neumí překládat sám. Text je v angličtině – přeložit ho můžeš přes odkaz níže.',
    'c.loadMore': 'Načíst další',
    'c.noStory': 'Příběh této postavy zatím v databázi není.',
    'c.searchFandom': 'Hledat postavu na Fandom wiki',
    'c.appsCount': 'Celkem výskytů v komiksech: {n}',
    'c.appsPartial': 'Zobrazeno prvních {n} podle data vydání.',
    's.universe': 'Vesmír / realita',
    's.citizenship': 'Občanství',
    's.marital': 'Rodinný stav',
    's.education': 'Vzdělání',
    's.origin': 'Původ',
    'c.showAll': 'Zobrazit celý příběh',
    'c.source': 'Zdroj',
    'c.more': 'Více na',
    'c.image': 'Obrázek',
    'c.specs': 'Specifikace',
    'c.powers': 'Schopnosti',
    'c.appearance': 'Vzhled',
    'c.comics': 'Komiksy, ve kterých se postava objevila',
    'c.comicsSource': 'Seznam sestaven z článku {a}.',
    'c.noComics': 'Žádné komiksy nenalezeny.',
    'c.firstApp': 'První výskyt',
    'c.series': 'Komiksová série',
    'c.collected': 'Souborné vydání',
    'c.comic': 'Komiks',
    'c.cover': 'Obálka',
    'c.tv': 'TV seriály',
    'c.films': 'Filmy',
    'c.poster': 'Plakát',
    'c.tvShow': 'Seriál',
    'c.film': 'Film',
    'c.mediaSource': 'Seznam filmů a seriálů: Wikidata · plakáty: Wikipedie.',
    's.realName': 'Skutečné jméno',
    's.birthplace': 'Místo narození',
    's.firstApp': 'První výskyt',
    's.publisher': 'Vydavatel',
    's.creators': 'Tvůrci',
    's.occupation': 'Povolání',
    's.base': 'Základna',
    's.aliases': 'Přezdívky / alter ega',
    's.teams': 'Týmy / organizace',
    's.abilities': 'Schopnosti',
    's.relatives': 'Příbuzní a partneři',
    's.enemies': 'Nepřátelé',
    's.gender': 'Pohlaví',
    's.species': 'Druh',
    's.height': 'Výška',
    's.weight': 'Váha',
    's.eyes': 'Barva očí',
    's.hair': 'Barva vlasů',
    'st.intelligence': 'Inteligence',
    'st.strength': 'Síla',
    'st.speed': 'Rychlost',
    'st.durability': 'Odolnost',
    'st.power': 'Moc',
    'st.combat': 'Boj',
  },
  en: {
    'site.lead': 'Pick a universe. Heroes, villains, antiheroes – all in one place.',
    'site.note': 'Unofficial fan site. Marvel, DC and all characters are trademarks of their respective owners. Character data: Marvel Database and DC Database (Fandom, CC BY-SA), Wikidata, Superhero API.',
    'nav.choose': 'Choose a universe',
    'u.characters': '{u} characters',
    'u.switch': 'Switch to',
    'u.search': 'Search',
    'u.searchPh': 'Character name…',
    'u.sort': 'Sort',
    'u.sort.az': 'A → Z',
    'u.sort.za': 'Z → A',
    'u.sort.new': 'Newest first',
    'u.sort.old': 'Oldest first',
    'u.type': 'Character type',
    'u.type.all': 'All',
    'u.type.good': 'Heroes',
    'u.type.bad': 'Villains',
    'u.type.neutral': 'Antiheroes / neutral',
    'u.loading': 'Loading characters…',
    'u.none': 'No character matches the filter.',
    'u.count': '{n} of {total}',
    'align.good': 'Hero',
    'align.bad': 'Villain',
    'align.neutral': 'Antihero',
    'c.loading': 'Loading character…',
    'c.notFound': 'Character not found.',
    'c.origin': 'Origin story',
    'c.originLoading': 'Loading the story from Wikipedia…',
    'c.originError': 'Could not load the story ({e}).',
    'c.originEnOnly': '',
    'c.translate': 'Translate',
    'c.translating': 'Translating…',
    'c.translateGoogle': 'Translate with Google',
    'c.machine': '',
    'c.untranslated': '',
    'c.loadMore': 'Load more',
    'c.noStory': 'This character\'s story is not in the database yet.',
    'c.searchFandom': 'Search on the Fandom wiki',
    'c.appsCount': 'Total comic appearances: {n}',
    'c.appsPartial': 'Showing the first {n} by release date.',
    's.universe': 'Universe / reality',
    's.citizenship': 'Citizenship',
    's.marital': 'Marital status',
    's.education': 'Education',
    's.origin': 'Origin',
    'c.showAll': 'Show the full story',
    'c.source': 'Source',
    'c.more': 'More on',
    'c.image': 'Image',
    'c.specs': 'Specifications',
    'c.powers': 'Power stats',
    'c.appearance': 'Appearance',
    'c.comics': 'Comics this character appeared in',
    'c.comicsSource': 'List compiled from the {a} article.',
    'c.noComics': 'No comics found.',
    'c.firstApp': 'First appearance',
    'c.series': 'Comic series',
    'c.collected': 'Collected edition',
    'c.comic': 'Comic',
    'c.cover': 'Cover',
    'c.tv': 'TV series',
    'c.films': 'Movies',
    'c.poster': 'Poster',
    'c.tvShow': 'TV series',
    'c.film': 'Movie',
    'c.mediaSource': 'Movies and TV series: Wikidata · posters: Wikipedia.',
    's.realName': 'Real name',
    's.birthplace': 'Place of birth',
    's.firstApp': 'First appearance',
    's.publisher': 'Publisher',
    's.creators': 'Creators',
    's.occupation': 'Occupation',
    's.base': 'Base',
    's.aliases': 'Aliases / alter egos',
    's.teams': 'Teams / organizations',
    's.abilities': 'Abilities',
    's.relatives': 'Relatives and partners',
    's.enemies': 'Enemies',
    's.gender': 'Gender',
    's.species': 'Species',
    's.height': 'Height',
    's.weight': 'Weight',
    's.eyes': 'Eye color',
    's.hair': 'Hair color',
    'st.intelligence': 'Intelligence',
    'st.strength': 'Strength',
    'st.speed': 'Speed',
    'st.durability': 'Durability',
    'st.power': 'Power',
    'st.combat': 'Combat',
  },
};

// ?lang=en v adrese má přednost (dá se sdílet), jinak uložená volba, jinak čeština
function readLang() {
  const forced = new URLSearchParams(location.search).get('lang');
  if (forced === 'en' || forced === 'cs') {
    try { localStorage.setItem('lang', forced); } catch { /* ignore */ }
    return forced;
  }
  try { return localStorage.getItem('lang') === 'en' ? 'en' : 'cs'; } catch { return 'cs'; }
}

export const lang = readLang();
document.documentElement.lang = lang;

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.cs[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Slovník hodnot z Wikidat (týmy, povolání, schopnosti…) – en -> cs.
// data/cs.json = české názvy z Wikidat, data/cs-extra.json = ruční překlady (null = nezobrazovat).
let dict = {};
const hidden = new Set();
export async function loadDictionary() {
  const load = async f => { try { return await (await fetch(f)).json(); } catch { return {}; } };
  const [wd, extra] = await Promise.all([lang === 'cs' ? load('data/cs.json') : {}, load('data/cs-extra.json')]);
  for (const [k, v] of Object.entries(extra)) if (v === null) hidden.add(k);
  dict = lang === 'cs' ? { ...wd, ...extra } : {};
}
export function tv(v) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(tv).filter(Boolean);
  if (hidden.has(v)) return null;
  return (lang === 'cs' && (dict[v] || dict[String(v).toLowerCase()])) || v;
}

// Strojový překlad delších anglických textů (origin story, popis) přímo v prohlížeči.
// Používá vestavěný překladač prohlížeče (Translator API v Chrome 138+), který běží v zařízení.
// Vrací: 'done' | 'unsupported' | funkci, kterou je nutné spustit kliknutím (stažení jazykového modelu).
export async function translateEnglish(elements) {
  if (lang !== 'cs') return 'done';
  const els = elements.filter(e => e && e.textContent.trim());
  if (!els.length) return 'done';
  if (!('Translator' in self)) return 'unsupported';
  const opts = { sourceLanguage: 'en', targetLanguage: 'cs' };
  let avail;
  try {
    // některé prohlížeče na dotaz neodpoví – po 4 s to bereme jako nepodporované
    avail = await Promise.race([self.Translator.availability(opts), new Promise(r => setTimeout(() => r('unavailable'), 4000))]);
  } catch { return 'unsupported'; }
  if (avail === 'unavailable') return 'unsupported';
  const run = async () => {
    const tr = await self.Translator.create(opts);
    for (const e of els) {
      try { e.textContent = await tr.translate(e.textContent); } catch { /* ponechat anglicky */ }
    }
    return 'done';
  };
  if (avail === 'available') { try { return await run(); } catch { return run; } }
  return run;   // 'downloadable' / 'downloading' – vyžaduje kliknutí uživatele
}

// Přeloží prvky s atributy data-i18n / data-i18n-placeholder / data-i18n-aria
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(n => { n.placeholder = t(n.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
}

// Přepínač jazyka vpravo nahoře
function addSwitcher() {
  const wrap = document.createElement('div');
  wrap.className = 'lang-switch';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Jazyk / Language');
  for (const [code, label] of [['cs', 'CZ'], ['en', 'EN']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(code === lang));
    b.onclick = () => {
      if (code === lang) return;
      try { localStorage.setItem('lang', code); } catch { /* bez úložiště jen pro tuto stránku */ }
      const url = new URL(location.href);
      url.searchParams.set('lang', code);
      location.href = url.toString();
    };
    wrap.append(b);
  }
  const bar = document.querySelector('.topbar');
  if (bar) bar.append(wrap);
  else { wrap.classList.add('floating'); document.body.append(wrap); }
}

addSwitcher();
applyStatic();
