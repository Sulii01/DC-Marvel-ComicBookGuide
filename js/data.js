import { t, lang } from './i18n.js';

// Společná data a pomocné funkce pro celý web.
// Databáze postav je v data/marvel.json a data/dc.json (generuje scripts/build_data.py).

export const UNIVERSES = {
  marvel: { key: 'marvel', label: 'Marvel', publisher: 'Marvel Comics', fandom: 'https://marvel.fandom.com' },
  dc:     { key: 'dc',     label: 'DC',     publisher: 'DC Comics',     fandom: 'https://dc.fandom.com' },
};

export const ALIGNMENT = {
  good:    { get label() { return t('align.good'); },    cls: 'good' },
  bad:     { get label() { return t('align.bad'); },     cls: 'bad' },
  neutral: { get label() { return t('align.neutral'); }, cls: 'neutral' },
};

// Jméno a popis postavy v aktuálním jazyce
export function nameOf(c) { return (lang === 'cs' && c.nameCs) || c.name; }
export function descOf(c) { return lang === 'cs' ? (c.descCs || null) : (c.desc || null); }

// Vlastní obrázky postav (Wikidata ID -> soubor v assets/characters/).
// Řetězec = stejný obrázek všude; objekt { head, full } = zvlášť hlava pro seznam a celé tělo pro detail.
// Když soubor chybí, použije se automaticky obrázek z databáze.
export const IMAGE_OVERRIDES = {
  Q2695156: { head: 'assets/characters/batman-head.png', full: 'assets/characters/batman-full.webp' }, // Batman
  Q63197020: 'assets/characters/batman-who-laughs.webp', // The Batman Who Laughs
};

export function overrideFor(c, kind = 'head') {
  const o = IMAGE_OVERRIDES[c.id];
  if (!o) return null;
  return typeof o === 'string' ? o : (o[kind] || o.full || o.head || null);
}

// Nastaví obrázek s náhradou: vlastní obrázek -> databáze -> nic.
// Po načtení označí vysoké (celopostavové) obrázky třídou „tall“ – seznam je přiblíží víc na hlavu.
export function setImage(img, c, onNone, kind = 'head') {
  const custom = overrideFor(c, kind);
  const list = [custom, c.img].filter(Boolean);
  const next = () => {
    const src = list.shift();
    // vlastní obrázky se zobrazují tak, jak jsou (bez prolnutí do rastru)
    img.classList.toggle('custom', !!src && src === custom);
    if (src) img.src = src;
    else { img.onerror = null; onNone?.(); }
  };
  img.onerror = next;
  img.addEventListener('load', () => {
    const r = img.naturalHeight / (img.naturalWidth || 1);
    img.classList.toggle('tall', r > 1.25);
    img.classList.toggle('very-tall', r > 1.7);
  });
  next();
}

export function getUniverse() {
  const key = new URLSearchParams(location.search).get('u');
  return UNIVERSES[key] || null;
}

const cache = {};
export async function loadAll(key) {
  if (cache[key]) return cache[key];
  const res = await fetch(`data/${key}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (cache[key] = await res.json());
}

export async function loadOne(key, id) {
  const c = (await loadAll(key)).find(x => x.id === id);
  if (!c) throw new Error(t('c.notFound'));
  return c;
}

export function clean(v) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.filter(Boolean).join(', ');
  return String(v).trim();
}

export function initials(name) {
  return name.replace(/\(.*\)/g, '').split(/[\s-]+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
}
