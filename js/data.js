// Společná data a pomocné funkce pro celý web.

export const API_BASE = 'https://cdn.jsdelivr.net/gh/akabab/superhero-api@0.3.0/api';

export const UNIVERSES = {
  marvel: { key: 'marvel', label: 'Marvel', publisher: 'Marvel Comics', fandom: 'https://marvel.fandom.com' },
  dc:     { key: 'dc',     label: 'DC',     publisher: 'DC Comics',     fandom: 'https://dc.fandom.com' },
};

export const ALIGNMENT = {
  good:    { label: 'Hrdina',     cls: 'good' },
  bad:     { label: 'Záporák',    cls: 'bad' },
  neutral: { label: 'Antihrdina / neutrální', cls: 'neutral' },
};

export function getUniverse() {
  const key = new URLSearchParams(location.search).get('u');
  return UNIVERSES[key] || null;
}

let cache = null;
export async function loadAll() {
  if (cache) return cache;
  const res = await fetch(`${API_BASE}/all.json`);
  if (!res.ok) throw new Error(`Nepodařilo se načíst data postav (HTTP ${res.status}).`);
  cache = (await res.json()).map(enrich);
  return cache;
}

export async function loadOne(id) {
  const res = await fetch(`${API_BASE}/id/${encodeURIComponent(id)}.json`);
  if (!res.ok) throw new Error(`Postava nebyla nalezena (HTTP ${res.status}).`);
  return enrich(await res.json());
}

// Rok prvního výskytu, např. "Tales of Suspense #39 (March 1963)" -> 1963
function enrich(c) {
  const fa = c.biography?.firstAppearance || '';
  const years = fa.match(/\b(19[3-9]\d|20[0-4]\d)\b/g);
  c.year = years ? Number(years[years.length - 1]) : null;
  return c;
}

export function clean(v) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.filter(x => x && x !== '-' && x !== 'null').join(', ');
  v = String(v).trim();
  return v === '-' || v === 'null' || v === 'No alter egos found.' ? '' : v;
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
