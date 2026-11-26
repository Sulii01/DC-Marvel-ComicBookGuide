// Načítání dat z Fandom wiki (dc.fandom.com = DC Database, marvel.fandom.com = Marvel Database).
// Texty se načítají živě, vždy s odkazem na zdroj (licence CC BY-SA).

const SUB = { dc: 'dc', marvel: 'marvel' };

export const fandomUrl = (u, title) =>
  `https://${SUB[u]}.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

async function api(u, params) {
  const p = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetch(`https://${SUB[u]}.fandom.com/api.php?${p}`);
  if (!res.ok) throw new Error(`Fandom HTTP ${res.status}`);
  return res.json();
}

// Obrázky na Fandomu mají tvar .../images/a/ab/Soubor.jpg/revision/latest?cb=… – zmenšenina přes scale-to-width-down
function sized(src, w) {
  if (!src) return null;
  src = src.replace(/\/revision\/latest\/scale-to-width-down\/\d+/, '/revision/latest');
  return src.includes('/revision/latest') ? src.replace('/revision/latest', `/revision/latest/scale-to-width-down/${w}`) : src;
}

const FIELDS = ['RealName', 'CurrentAlias', 'Aliases', 'Affiliation', 'Relatives', 'Universe', 'BaseOfOperations',
  'Gender', 'Height', 'Weight', 'Eyes', 'Hair', 'Citizenship', 'MaritalStatus', 'Occupation', 'Education',
  'Origin', 'PlaceOfBirth', 'Creators', 'First'];

/** Stáhne stránku postavy: obrázek z infoboxu, údaje z infoboxu a HTML dokument (pro historii). */
export async function loadFandomPage(u, title) {
  const d = await api(u, { action: 'parse', page: title, prop: 'text', redirects: '1', disableeditsection: '1' });
  const doc = new DOMParser().parseFromString(d.parse.text, 'text/html');
  const box = doc.querySelector('aside.portable-infobox');
  const fields = {};
  for (const f of FIELDS) {
    const n = box?.querySelector(`[data-source="${f}"] .pi-data-value`);
    if (!n) continue;
    n.querySelectorAll('sup, .reference, style, script').forEach(x => x.remove());
    n.querySelectorAll('br').forEach(br => br.replaceWith('; '));
    const v = n.textContent.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').replace(/(;\s*)+/g, '; ').replace(/^[;\s]+|[;\s]+$/g, '').trim();
    if (v) fields[f] = v;
  }
  const imgEl = box?.querySelector('.pi-image img, figure img, img');
  const raw = imgEl && (imgEl.closest('a')?.getAttribute('href') || imgEl.getAttribute('data-src') || imgEl.getAttribute('src'));
  return {
    title: d.parse.title,
    url: fandomUrl(u, d.parse.title),
    doc,
    fields,
    image: raw && /^https?:\/\//.test(raw) ? sized(raw, 700) : null,
  };
}

/**
 * Seznam čísel komiksů, ve kterých se postava objevila (kategorie „<stránka>/Appearances“),
 * seřazený podle data vydání. Datum je v řadicím klíči kategorie („… A[ 2006-10-18“).
 * U velmi známých postav se načte nejvýše `max` položek.
 */
export async function loadAppearances(u, title, max = 2000) {
  const all = [];
  let cont = {};
  do {
    const d = await api(u, { action: 'query', list: 'categorymembers', cmtitle: `Category:${title}/Appearances`,
      cmlimit: '500', cmprop: 'title|sortkeyprefix', cmtype: 'page', ...cont });
    for (const m of d.query?.categorymembers || []) {
      const date = (m.sortkeyprefix || '').match(/(\d{4})-(\d{2})-(\d{2})/);
      all.push({ title: m.title, date: date ? date[0] : null, year: date ? Number(date[1]) : null });
    }
    cont = d.continue?.cmcontinue ? { cmcontinue: d.continue.cmcontinue } : null;
  } while (cont && all.length < max);
  all.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title));
  return { list: all, complete: !cont };
}

/** Obálky pro zadaná čísla komiksů (po 50). */
export async function loadIssueCovers(u, titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    try {
      const d = await api(u, { action: 'query', titles: titles.slice(i, i + 50).join('|'),
        prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '400' });
      for (const p of d.query?.pages || []) if (p.thumbnail) out.set(p.title, sized(p.thumbnail.source, 400));
    } catch { /* bez obálek */ }
  }
  return out;
}

// „Detective Comics Vol 1 27“ -> „Detective Comics #27“ (u Vol 1), jinak „Batman Vol 3 #1“
export function issueLabel(title) {
  const m = title.match(/^(.*) Vol (\d+) (.+)$/);
  if (!m) return title;
  return m[2] === '1' ? `${m[1]} #${m[3]}` : `${m[1]} Vol ${m[2]} #${m[3]}`;
}
