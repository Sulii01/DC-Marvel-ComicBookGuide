import { getUniverse, loadOne, ALIGNMENT, overrideFor, clean, el, setImage, nameOf, descOf } from './data.js';
import { t, tv, lang, loadDictionary, translateEnglish } from './i18n.js';
import { loadFandomPage, loadAppearances, loadIssueCovers, issueLabel, fandomUrl } from './fandom.js';

const u = getUniverse();
const id = new URLSearchParams(location.search).get('id');
if (!u || !id) location.replace('index.html');
document.body.classList.add(u.key);

const $ = x => document.getElementById(x);
// Wikipedie se používá už jen pro plakáty filmů a seriálů
const WIKI = 'https://en.wikipedia.org/w/api.php';
const uniLink = () => `universe.html?u=${u.key}`;

function specRows(target, rows) {
  for (const [label, value] of rows) {
    const v = clean(value);
    if (!v) continue;
    target.append(el('dt', { text: label }), el('dd', { text: v }));
  }
}

function chipRow(target, label, list) {
  if (!list?.length) return;
  target.append(el('dt', { text: label }),
    el('dd', {}, el('div', { class: 'chips' }, list.map(x => el('span', { text: x })))));
}

function renderBase(c) {
  const name = nameOf(c);
  document.title = `${name} – ${u.label} – Comic Book Guide`;
  $('crumbs').append(' / ', el('a', { href: uniLink(), text: t('u.characters', { u: u.label }) }), ` / ${name}`);
  $('name').textContent = name;
  $('real').textContent = c.realName && c.realName !== name ? c.realName : '';
  const desc = descOf(c);
  if (desc) $('real').after(el('p', { class: 'desc', text: desc }));
  else if (lang === 'cs' && c.desc) {
    // český popis chybí – přeložit anglický, jinak nezobrazovat
    const p = el('p', { class: 'desc', text: c.desc, hidden: '' });
    $('real').after(p);
    translateEnglish([p]).then(r => { if (r === 'done') p.hidden = false; });
  }

  const a = ALIGNMENT[c.align];
  if (a) $('badges').append(el('span', { class: `badge ${a.cls}`, text: a.label }));

  // Obrázek z databáze / vlastní obrázek; Wikipedie ho případně nahradí větším
  $('full').alt = name;
  if (overrideFor(c, 'full') || !c.fandom) {
    setImage($('full'), c, () => $('full').closest('figure').hidden = true, 'full');
  } else {
    // obrázek z Fandomu se načítá zvlášť – do té doby jen animovaný rámeček (žádné problikávání)
    $('full').closest('.frame').classList.add('loading');
  }

  specRows($('specs'), [
    [t('s.realName'), c.realName],
    [t('s.birthplace'), tv(c.birthplace)],
    [t('s.firstApp'), c.firstApp ? `${c.firstApp}${c.year && !String(c.firstApp).includes(c.year) ? ` (${c.year})` : ''}` : (c.year ? String(c.year) : '')],
    [t('s.publisher'), u.publisher],
    [t('s.creators'), c.creators],
    [t('s.occupation'), tv(c.occupation)],
    [t('s.base'), c.base],
  ]);
  chipRow($('specs'), t('s.aliases'), c.aliases);
  chipRow($('specs'), t('s.teams'), tv(c.teams));
  chipRow($('specs'), t('s.abilities'), tv(c.abilities));
  chipRow($('specs'), t('s.relatives'), tv(c.relatives));
  chipRow($('specs'), t('s.enemies'), tv(c.enemies));

  specRows($('appearance'), [
    [t('s.gender'), tv(c.gender)],
    [t('s.species'), tv(c.species)],
    [t('s.height'), c.height],
    [t('s.weight'), c.weight],
    [t('s.eyes'), tv(c.eyes)],
    [t('s.hair'), tv(c.hair)],
  ]);
  if (!$('appearance').children.length) $('appearance').closest('.panel').hidden = true;

  if (c.powerstats) {
    for (const k of ['intelligence', 'strength', 'speed', 'durability', 'power', 'combat']) {
      const label = t(`st.${k}`);
      const v = Number(c.powerstats[k]) || 0;
      $('stats').append(el('div', { class: 'stat' },
        el('span', { text: label }),
        el('div', { class: 'bar' }, el('span', { style: `width:${Math.min(v, 100)}%` })),
        el('span', { class: 'val', text: String(v) })));
    }
  } else $('stats').closest('.panel').hidden = true;

  $('state').hidden = true;
  $('content').hidden = false;
}

/* ---------------- Wikipedie ---------------- */

async function wiki(params, api = WIKI) {
  const p = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetch(`${api}?${p}`);
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  return res.json();
}

// Rozdělí HTML článku na sekce podle nadpisů h2
function splitSections(doc) {
  const root = doc.querySelector('.mw-parser-output') || doc.body;
  const sections = [];
  let cur = { title: '__intro', nodes: [] };
  for (const node of [...root.children]) {
    const h2 = node.matches('h2') ? node : node.querySelector(':scope > h2');
    if (h2 && (node.matches('h2') || node.classList.contains('mw-heading2'))) {
      sections.push(cur);
      cur = { title: h2.textContent.trim(), nodes: [] };
    } else cur.nodes.push(node);
  }
  sections.push(cur);
  return sections;
}

// Převod HTML z Wikipedie na bezpečný čistý text (bez odkazů, tabulek, poznámek)
function toSafe(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.matches('.mw-heading3, .mw-heading4, h3, h4')) {
      const lvl = n.matches('.mw-heading4, h4') ? 'h4' : 'h3';
      out.push(el(lvl, { text: n.textContent.replace(/\[(edit|editovat)[^\]]*\]/g, '').trim() }));
    } else if (n.matches('p')) {
      const txt = n.textContent.replace(/\[\d+\]|\[[a-z]\]|\[citation needed\]|\[zdroj\?\]|\[pozn\. \d+\]/g, '').trim();
      if (txt) out.push(el('p', { text: txt }));
    } else if (n.matches('ul, ol')) {
      const list = el(n.tagName.toLowerCase());
      for (const li of n.querySelectorAll(':scope > li'))
        list.append(el('li', { text: li.textContent.replace(/\[\d+\]/g, '').trim() }));
      out.push(list);
    } else if (n.matches('div, section') && !n.matches(SKIP_BLOCK)) {
      // Marvel Database obaluje text sekce do <div class="marvel_database_section">
      out.push(...toSafe([...n.children]));
    }
  }
  return out;
}
// bloky, které nejsou souvislý text (infobox, obsah, navigace, galerie, citáty…)
const SKIP_BLOCK = '.toc, .portable-infobox, aside, .navbox, .gallery, .wikia-gallery, .quote, .references, .reflist, .thumb, figure, .noprint, .hatnote, .dablink';

async function loadWiki(c) {
  const origin = $('origin');
  const comics = $('comics');

  // Jediný zdroj informací o postavě: Fandom (DC Database / Marvel Database)
  const fd = c.fandom ? await loadFandomPage(u.key, c.fandom).catch(() => null) : null;
  const searchUrl = `${u.fandom}/wiki/Special:Search?query=${encodeURIComponent(c.baseName || c.name)}`;

  // ---- Obrázek celé postavy: vlastní > Fandom
  const custom = overrideFor(c, 'full');
  const usingCustom = custom && $('full').src.endsWith(custom);
  if (!usingCustom && c.fandom) {
    const frame = $('full').closest('.frame');
    let done = false;
    const fallback = () => {          // Fandom obrázek není / nenačetl se → náhradní obrázek z databáze
      if (done) return;
      done = true;
      frame.classList.remove('loading');
      setImage($('full'), c, () => $('full').closest('figure').hidden = true, 'full');
    };
    if (fd?.image) {
      const pre = new Image();
      pre.referrerPolicy = 'no-referrer';
      pre.onload = () => {
        if (done) return;
        done = true;
        const img = $('full');
        img.onerror = null;
        img.classList.remove('custom');
        img.src = fd.image;
        frame.classList.remove('loading');
        img.closest('figure').hidden = false;
        $('credit').replaceChildren(`${t('c.image')}: `, el('a', { href: fd.url, target: '_blank', rel: 'noopener', text: `${u.label} Fandom` }));
      };
      pre.onerror = fallback;
      pre.src = fd.image;
      setTimeout(fallback, 10000);   // pojistka při velmi pomalém načítání
    } else {
      fallback();
    }
  }

  // ---- Doplňující údaje z infoboxu Fandomu (jen co v databázi chybí)
  if (fd) addFandomSpecs(c, fd.fields);

  // ---- Příběh postavy (sekce „History“ na Fandomu), česky strojový překlad
  let story = null;
  if (fd) {
    const secs = splitSections(fd.doc);
    const hist = secs.filter(s => /^(history|biography|origin)/i.test(s.title));
    const parts = [];
    for (const s of hist) parts.push(...toSafe(s.nodes));
    if (!parts.some(p => p.tagName === 'P')) {   // bez sekce History: úvod stránky
      parts.push(...toSafe(secs.find(s => s.title === '__intro')?.nodes || []));
    }
    if (parts.some(p => p.tagName === 'P')) story = { parts, url: fd.url, title: fd.title, site: `${u.label} Fandom`, en: true };
  }
  if (story) {
    showStory(origin, story, c);
    translateStory(origin, story);
  } else {
    origin.replaceChildren(el('p', { class: 'state', text: t('c.noStory') }),
      el('a', { class: 'btn', href: searchUrl, target: '_blank', rel: 'noopener', text: t('c.searchFandom') }));
  }

  // ---- Komiksy: konkrétní čísla s obálkami z Fandomu
  if (fd && await renderFandomComics(c, fd).catch(() => false)) return;
  const first = clean(c.firstApp);
  if (first) {
    const card = comicCard({ title: first, note: t('c.firstApp'), first: true });
    comics.replaceChildren(card.li);
  } else {
    comics.replaceChildren(el('li', { text: t('c.noComics') }));
  }
  $('comics-source').append(el('a', { href: searchUrl, target: '_blank', rel: 'noopener', text: t('c.searchFandom') }));
}

// Údaje z infoboxu Fandomu, které v databázi chybí
function addFandomSpecs(c, f) {
  const specs = $('specs'), look = $('appearance');
  const add = (target, label, value) => {
    if (!value) return;
    const words = x => lang === 'cs' ? x.replace(/\bFormerly\b/gi, 'dříve').replace(/\bUnknown\b/gi, 'neznámé').replace(/\bNone\b/g, 'žádné') : x;
    target.append(el('dt', { text: label }), el('dd', { text: value.split('; ').map(x => words(tv(x) || '')).filter(Boolean).join(', ') }));
    target.closest('.panel').hidden = false;
  };
  if (!c.realName && f.RealName) add(specs, t('s.realName'), f.RealName);
  if (!c.base && f.BaseOfOperations) add(specs, t('s.base'), f.BaseOfOperations);
  if (f.Universe) add(specs, t('s.universe'), f.Universe);
  if (f.Citizenship) add(specs, t('s.citizenship'), f.Citizenship);
  if (!c.birthplace && f.PlaceOfBirth) add(specs, t('s.birthplace'), f.PlaceOfBirth);
  if (f.Origin) add(specs, t('s.origin'), f.Origin);
  if (!c.height && f.Height) add(look, t('s.height'), f.Height);
  if (!c.weight && f.Weight) add(look, t('s.weight'), f.Weight);
  if (!c.eyes && f.Eyes) add(look, t('s.eyes'), f.Eyes);
  if (!c.hair && f.Hair) add(look, t('s.hair'), f.Hair);
}

// Strojový překlad anglického příběhu do češtiny (vestavěný překladač prohlížeče)
async function translateStory(origin, story) {
  if (lang !== 'cs') return;
  const els = [...origin.querySelectorAll('p, h3, h4, li')].filter(e => !e.classList.contains('source'));
  const note = el('p', { class: 'source', text: t('c.translating') });
  origin.prepend(note);
  const res = await translateEnglish(els);
  if (res === 'done') { note.textContent = t('c.machine'); return; }
  const google = el('a', { class: 'btn', target: '_blank', rel: 'noopener',
    href: `https://translate.google.com/translate?sl=en&tl=cs&u=${encodeURIComponent(story.url)}`, text: t('c.translateGoogle') });
  if (typeof res === 'function') {
    const btn = el('button', { class: 'btn', type: 'button', text: t('c.translate') });
    btn.onclick = async () => { btn.disabled = true; btn.textContent = t('c.translating'); await res().catch(() => {}); note.textContent = t('c.machine'); btn.remove(); google.remove(); };
    note.replaceChildren(btn, ' ', google);
  } else {
    note.replaceChildren(t('c.untranslated'), ' ', google);
  }
}

// Seznam čísel komiksů z Fandomu – chronologicky, s obálkami, po 48 kusech
async function renderFandomComics(c, fd) {
  const comics = $('comics');
  const { list, complete } = await loadAppearances(u.key, fd.title);
  if (!list.length) return false;
  const PAGE = 48;
  let shown = 0;
  const more = el('button', { class: 'btn', type: 'button', text: t('c.loadMore') });
  const showNext = async () => {
    const slice = list.slice(shown, shown + PAGE);
    shown += slice.length;
    const cards = slice.map((x, i) => {
      const card = comicCard({ title: issueLabel(x.title), note: x.year ? String(x.year) : t('c.comic'),
        first: shown === slice.length && i === 0 });
      const a = el('a', { href: fandomUrl(u.key, x.title), target: '_blank', rel: 'noopener', class: 'comic-link' });
      a.append(...card.li.childNodes);
      card.li.append(a);
      return card;
    });
    if (shown === slice.length) cards[0].li.querySelector('small').textContent = `${t('c.firstApp')} · ${slice[0].year || ''}`;
    comics.append(...cards.map(x => x.li));
    const covers = await loadIssueCovers(u.key, slice.map(x => x.title));
    slice.forEach((x, i) => {
      const src = covers.get(x.title);
      if (!src) return;
      const img = el('img', { src, alt: `${t('c.cover')} – ${issueLabel(x.title)}`, loading: 'lazy' });
      img.onerror = () => img.remove();
      cards[i].cover.append(img);
      cards[i].cover.classList.add('has-img');
    });
    if (shown >= list.length) more.remove();
  };
  comics.replaceChildren();
  await showNext();
  if (shown < list.length) {
    comics.after(more);
    more.onclick = async () => { more.disabled = true; await showNext(); more.disabled = false; };
  }
  const total = c.apps && c.apps > list.length ? c.apps : list.length;
  const src = $('comics-source');
  src.append(t('c.appsCount', { n: total }), ' ', complete ? '' : t('c.appsPartial', { n: list.length }), ' ',
    `${t('c.source')}: `, el('a', { href: `${fandomUrl(u.key, 'Category:' + fd.title + '/Appearances')}`, target: '_blank', rel: 'noopener', text: `${u.label} Fandom` }));
  return true;
}


function showStory(origin, story, c) {
  origin.replaceChildren(...story.parts);
  if (story.parts.length > 6) {
    origin.classList.add('collapsed');
    const btn = el('button', { class: 'btn', type: 'button', text: t('c.showAll') });
    btn.onclick = () => { origin.classList.remove('collapsed'); btn.remove(); };
    origin.after(btn);
  }
  origin.parentElement.append(el('p', { class: 'source' },
    `${t('c.source')}: `, el('a', { href: story.url, target: '_blank', rel: 'noopener', text: `${story.site} – ${story.title}` }),
    ` (CC BY-SA 4.0) · ${t('c.more')} `,
    el('a', { href: `${u.fandom}/wiki/Special:Search?query=${encodeURIComponent(c.name)}`, target: '_blank', rel: 'noopener', text: `${u.label} Fandom wiki` })));
}

/* ---------------- Obálky komiksů ---------------- */

function comicCard(x) {
  const cover = el('div', { class: 'cover' }, el('span', { class: 'cover-ph', text: baseTitle(x.title) }));
  const li = el('li', { class: x.first ? 'first' : null }, cover,
    el('div', { class: 'comic-info' }, el('small', { text: x.note }), el('span', { class: 'comic-title', text: x.title })));
  return { li, cover };
}

// "Showcase #22 (October, 1959)" -> "Showcase"; "Iron Man vol. 2" -> "Iron Man"
function baseTitle(t) {
  return t.replace(/\s*#.*$/, '').replace(/\s*\([^)]*\)\s*$/, '')
          .replace(/,?\s+vol(ume|\.)?\s*\d+.*$/i, '').replace(/[,:;\s]+$/, '').trim() || t;
}

/* ---------------- Filmy a seriály ---------------- */

function mediaCard(m, label) {
  const title = (lang === 'cs' && m.nameCs) || m.name;
  const cover = el('div', { class: 'cover' }, el('span', { class: 'cover-ph', text: title }));
  const info = el('div', { class: 'comic-info' },
    el('small', { text: m.year ? `${label} · ${m.year}` : label }), el('span', { class: 'comic-title', text: title }));
  const li = el('li', {});
  if (m.wiki) {
    li.append(el('a', { class: 'comic-link', target: '_blank', rel: 'noopener',
      href: `https://en.wikipedia.org/wiki/${encodeURIComponent(m.wiki.replace(/ /g, '_'))}` }, cover, info));
  } else li.append(cover, info);
  return { li, cover, title };
}

// Plakáty: obrázek z infoboxu článku o filmu/seriálu (oficiální plakát nebo titulní karta)
async function loadPosters(list, cards) {
  const titles = [...new Set(list.filter(m => !m.thumb).map(m => m.wiki).filter(Boolean))];
  const thumbs = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    try {
      const d = await wiki({ action: 'query', titles: titles.slice(i, i + 50).join('|'), redirects: '1',
        prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '400', pilicense: 'any' });
      const q = d.query || {};
      const back = new Map();
      for (const n of [...(q.normalized || []), ...(q.redirects || [])]) back.set(n.to, back.get(n.from) || n.from);
      for (const p of q.pages || []) if (p.thumbnail) thumbs.set(back.get(p.title) || p.title, p.thumbnail.source);
    } catch { /* bez plakátů */ }
  }
  list.forEach((m, i) => {
    const src = m.thumb || (m.wiki && thumbs.get(m.wiki));
    if (!src) return;
    const img = el('img', { src, alt: `${t('c.poster')} – ${cards[i].title}`, loading: 'lazy' });
    img.onerror = () => img.remove();
    cards[i].cover.append(img);
    cards[i].cover.classList.add('has-img');
  });
}


const BAD_MEDIA = /\bXXX\b|porn|parody/i;

function renderMedia(c) {
  let any = false;
  for (const [key, label] of [['tv', t('c.tvShow')], ['films', t('c.film')]]) {
    const list = (c[key] || []).filter(m => !BAD_MEDIA.test(m.name));
    if (!list.length) continue;
    any = true;
    const cards = list.map(m => mediaCard(m, label));
    $(key).replaceChildren(...cards.map(x => x.li));
    $(`${key}-panel`).hidden = false;
    loadPosters(list, cards);
  }
  $('media-source').hidden = !any;
}

// Rozmazaný obrázek postavy v pozadí horní části stránky
$('full').addEventListener('load', () => {
  const src = $('full').currentSrc || $('full').src;
  if (src) $('hero-bg').style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
});
document.documentElement.style.setProperty('--topbar-h', `${document.querySelector('.topbar')?.offsetHeight || 62}px`);

try {
  await loadDictionary();
  const c = await loadOne(u.key, id);
  renderBase(c);
  renderMedia(c);
  loadWiki(c);
} catch (e) {
  $('state').textContent = e.message;
  $('state').classList.add('error');
}
