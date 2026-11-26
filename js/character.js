import { getUniverse, loadOne, ALIGNMENT, overrideFor, clean, el, setImage, nameOf, descOf } from './data.js';
import { t, tv, lang, loadDictionary, translateEnglish } from './i18n.js';
import { loadFandomPage, loadAppearances, loadIssueCovers, issueLabel, fandomUrl } from './fandom.js';

const u = getUniverse();
const id = new URLSearchParams(location.search).get('id');
if (!u || !id) location.replace('index.html');
document.body.classList.add(u.key);

const $ = x => document.getElementById(x);
const WIKI = 'https://en.wikipedia.org/w/api.php';
const WIKI_CS = 'https://cs.wikipedia.org/w/api.php';
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
  setImage($('full'), c, () => $('full').closest('figure').hidden = true, 'full');

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

// Najde článek o postavě: hledá jméno + vydavatele, upřednostní článek,
// který ve výsledku hledání zmiňuje správného vydavatele.
async function findArticle(c) {
  if (c.wiki) return c.wiki;
  const pub = u.key === 'marvel' ? 'Marvel Comics' : 'DC Comics';
  const data = await wiki({
    action: 'query', list: 'search', srlimit: '8', srprop: 'snippet',
    srsearch: `${c.name} ${pub} character`,
  });
  const results = data.query?.search || [];
  const bad = /^(List of|Lists of)|\((film|TV series|video game|soundtrack|album|song)\)|film\)$/i;
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(c.name);
  const ok = results.filter(r => !bad.test(r.title));
  return (
    ok.find(r => norm(r.title.replace(/\(.*\)/, '')) === n && new RegExp(pub.split(' ')[0], 'i').test(r.snippet + r.title)) ||
    ok.find(r => norm(r.title.replace(/\(.*\)/, '')) === n) ||
    ok.find(r => norm(r.title).includes(n)) ||
    ok[0]
  )?.title;
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
    }
  }
  return out;
}

const BIO = /^(fictional character biography|fictional (character )?history|character biography|biography|fictional biography|origin)/i;
const PUB = /^publication history/i;
const COMICS = /^(collected editions|bibliography|comics|series|titles|in comics)/i;

function extractComics(sections) {
  const found = new Map();
  const add = (t0, note) => {
    let t = t0.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 90 || /^\d+$/.test(t) || /needed|citation|clarification/i.test(t)) return;
    const key = t.toLowerCase();
    if (!found.has(key)) found.set(key, { title: t, note });
  };
  for (const s of sections) {
    if (COMICS.test(s.title)) {
      for (const n of s.nodes) {
        // tabulky "Collected editions": první sloupec je název
        n.querySelectorAll?.('table tr').forEach(tr => {
          const cell = tr.querySelector('td');
          if (cell) add(cell.textContent, t('c.collected'));
        });
        n.querySelectorAll?.('li').forEach(li => {
          const i = li.querySelector('i');
          add(i ? i.textContent : li.textContent.split(/[–(:]/)[0], t('c.comic'));
        });
      }
    }
  }
  // Názvy sérií zmíněné kurzívou v historii vydávání a v biografii
  for (const s of sections) {
    if (PUB.test(s.title) || BIO.test(s.title)) {
      for (const n of s.nodes) n.querySelectorAll?.('p i, li i').forEach(i => {
        // kurzíva v poznámkách typu [volume and issue needed] není název komiksu
        if (!i.closest('sup, .noprint, .Template-Fact')) add(i.textContent, t('c.series'));
      });
    }
  }
  return [...found.values()].slice(0, 120);
}

async function loadWiki(c) {
  const origin = $('origin');
  const comics = $('comics');

  // Fandom (DC Database / Marvel Database) a Wikipedie se načítají souběžně
  const fandomP = c.fandom ? loadFandomPage(u.key, c.fandom).catch(() => null) : Promise.resolve(null);
  const wikiP = (async () => {
    const title = await findArticle(c);
    if (!title) return null;
    const data = await wiki({ action: 'parse', page: title, prop: 'text', redirects: '1', disableeditsection: '1' });
    const doc = new DOMParser().parseFromString(data.parse.text, 'text/html');
    return { doc, title: data.parse.title, sections: splitSections(doc),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(data.parse.title.replace(/ /g, '_'))}` };
  })().catch(() => null);

  const [fd, wp] = await Promise.all([fandomP, wikiP]);
  if (wp) mediaFromArticle(wp.sections).then(extra => { mergeMedia(c, extra); renderMedia(c); }).catch(() => {});

  // ---- Obrázek celé postavy: vlastní > Fandom > Wikipedie
  const custom = overrideFor(c, 'full');
  const usingCustom = custom && $('full').src.endsWith(custom);
  let fullSrc = null, fullCredit = null;
  if (!usingCustom) {
    if (fd?.image) { fullSrc = fd.image; fullCredit = ['Fandom', fd.url]; }
    else if (wp) {
      const infoImg = wp.doc.querySelector('.infobox img');
      if (infoImg) {
        let src = infoImg.getAttribute('src');
        if (src.startsWith('//')) src = 'https:' + src;
        fullSrc = src.replace(/\/(\d+)px-/, '/600px-');
        fullCredit = ['Wikipedia', wp.url];
      }
    }
  }
  if (fullSrc) {
    // nový obrázek se nejdřív načte zvlášť a vymění se až po úspěšném načtení
    const pre = new Image();
    pre.referrerPolicy = 'no-referrer';
    pre.onload = () => {
      const img = $('full');
      img.onerror = null;
      img.classList.remove('custom');
      img.src = fullSrc;
      img.closest('figure').hidden = false;
      $('credit').replaceChildren(`${t('c.image')}: `, el('a', { href: fullCredit[1], target: '_blank', rel: 'noopener', text: fullCredit[0] }));
    };
    pre.src = fullSrc;
  }

  // ---- Doplňující údaje z infoboxu Fandomu (jen co v databázi chybí)
  if (fd) addFandomSpecs(c, fd.fields);

  // ---- Příběh: česká Wikipedie > Fandom „History“ > anglická Wikipedie
  let story = null;
  if (lang === 'cs' && c.wikiCs) story = await czechStory(c.wikiCs).catch(() => null);
  if (!story && fd) {
    const secs = splitSections(fd.doc);
    const hist = secs.filter(s => /^(history|biography|origin)/i.test(s.title));
    const parts = [];
    for (const s of hist) parts.push(...toSafe(s.nodes));
    if (parts.filter(p => p.tagName === 'P').length) story = { parts, url: fd.url, title: fd.title, site: `${u.label} Fandom`, en: true };
  }
  if (!story && wp) {
    const intro = wp.sections.find(s => s.title === '__intro');
    const bio = wp.sections.filter(s => BIO.test(s.title));
    const pub = wp.sections.find(s => PUB.test(s.title));
    const parts = [...toSafe(intro?.nodes || [])];
    for (const s of bio) parts.push(el('h3', { text: s.title }), ...toSafe(s.nodes));
    if (!bio.length && pub) parts.push(el('h3', { text: pub.title }), ...toSafe(pub.nodes));
    story = { parts, url: wp.url, title: wp.title, site: 'Wikipedia (EN)', en: true };
  }
  if (story) {
    showStory(origin, story, c);
    if (story.en) translateStory(origin, story);
  } else {
    origin.replaceChildren(el('p', { class: 'state error', text: t('c.originError', { e: '404' }) }));
  }

  // ---- Komiksy: konkrétní čísla s obálkami z Fandomu, jinak seznam sérií z Wikipedie
  if (fd && await renderFandomComics(c, fd).catch(() => false)) return;
  const items = [];
  const first = clean(c.firstApp);
  if (first) items.push({ title: first, note: t('c.firstApp'), first: true });
  if (wp) {
    items.push(...extractComics(wp.sections));
    const tpl = t('c.comicsSource', { a: '\u0000' }).split('\u0000');
    $('comics-source').append(tpl[0],
      el('a', { href: wp.url, target: '_blank', rel: 'noopener', text: `Wikipedia – ${wp.title}` }), tpl[1] || '');
  }
  if (!items.length) { comics.append(el('li', { text: t('c.noComics') })); return; }
  const cards = items.map(comicCard);
  comics.replaceChildren(...cards.map(x => x.li));
  loadCovers(items, cards);
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

// Celý text článku z české Wikipedie kromě odkazů a literatury
const CS_SKIP = /^(reference|poznámky|odkazy|externí odkazy|literatura|související články|v jiných médiích|film|televize|videohry)/i;
async function czechStory(title) {
  const data = await wiki({ action: 'parse', page: title, prop: 'text', redirects: '1', disableeditsection: '1' }, WIKI_CS);
  const doc = new DOMParser().parseFromString(data.parse.text, 'text/html');
  const parts = [];
  for (const s of splitSections(doc)) {
    if (CS_SKIP.test(s.title)) continue;
    if (s.title !== '__intro') parts.push(el('h3', { text: s.title.replace(/\[editovat[^\]]*\]/g, '') }));
    parts.push(...toSafe(s.nodes));
  }
  if (parts.filter(p => p.tagName === 'P').length === 0) return null;
  const url = `https://cs.wikipedia.org/wiki/${encodeURIComponent(data.parse.title.replace(/ /g, '_'))}`;
  return { parts, url, title: data.parse.title, site: 'Wikipedie (CZ)' };
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

const COMIC_DESC = /comic|series|anthology|magazine|graphic novel|storyline|crossover|limited series|one-shot/i;
const NOT_COMIC = /\bcharacter\b|appearing in|fictional|supervillain|\bfilm\b|television|video game|novel by|band|album|soundtrack/i;

// Pro každý komiks najde článek na Wikipedii s obálkou (infobox) a doplní obrázek.
async function loadCovers(items, cards) {
  const bases = items.map(x => baseTitle(x.title));
  const candidatesFor = b => [`${b} (comic book)`, `${b} (comic book series)`, `${b} (comics)`, `${b} (comic)`, b];
  const all = [...new Set(bases.flatMap(candidatesFor))];
  const pages = new Map();   // požadovaný název -> stránka

  for (let i = 0; i < all.length; i += 50) {
    const chunk = all.slice(i, i + 50);
    try {
      const d = await wiki({ action: 'query', titles: chunk.join('|'), redirects: '1',
        prop: 'pageimages|description|info', piprop: 'thumbnail', pithumbsize: '400', pilicense: 'any', inprop: 'url' });
      const q = d.query || {};
      const alias = new Map();
      for (const n of q.normalized || []) alias.set(n.from, n.to);
      const redir = new Map((q.redirects || []).map(r => [r.from, r.to]));
      const byTitle = new Map((q.pages || []).map(p => [p.title, p]));
      for (const t of chunk) {
        let x = alias.get(t) || t;
        x = redir.get(x) || x;
        const p = byTitle.get(x);
        if (p && !p.missing) pages.set(t, p);
      }
    } catch { /* bez obálek se nic nestane */ }
  }

  bases.forEach((b, i) => {
    // Článek s upřesněním „(comic book)“ je vždy komiks; holý název jen když to potvrdí popis
    const page = candidatesFor(b).map(t => pages.get(t)).find(p => p && p.thumbnail && (
      /\((comic book|comic book series|comics|comic)\)$/i.test(p.title) && !NOT_COMIC.test(p.description || '') ||
      COMIC_DESC.test(p.description || '') && !NOT_COMIC.test(p.description || '')));
    if (!page) return;
    const { cover, li } = cards[i];
    const img = el('img', { src: page.thumbnail.source, alt: `${t('c.cover')} – ${items[i].title}`, loading: 'lazy' });
    img.onerror = () => img.remove();
    cover.append(img);
    cover.classList.add('has-img');
    const a = el('a', { href: page.fullurl, target: '_blank', rel: 'noopener', class: 'comic-link' });
    a.append(...li.childNodes);
    li.append(a);
  });
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

// Doplnění filmů a seriálů z článku na Wikipedii (sekce „In other media“ a navazující články)
const MEDIA_SECTION = /^(in other media|other media|in film|in television|adaptations|film|films|television|other versions in media)/i;
const TV_DESC = /television|tv series|web series|miniseries|animated series|anime|streaming series/i;
const FILM_DESC = /\bfilm\b|movie/i;
const SKIP_DESC = /video game|comic|novel|album|song|soundtrack|porn|parody|actor|actress|character|episode|franchise|film series|toy|book|magazine|list of/i;

function mediaLinks(nodes, out) {
  for (const n of nodes) n.querySelectorAll?.('a[href^="/wiki/"]').forEach(a => {
    if (!a.closest('i') && !a.querySelector('i')) return;   // názvy děl jsou kurzívou
    const title = decodeURIComponent(a.getAttribute('href').slice(6)).split('#')[0].replace(/_/g, ' ');
    if (!title.includes(':') || /^[^:]+: /.test(title) && !/^(File|Category|Help|Wikipedia|Template|Special|Portal):/.test(title)) out.add(title);
  });
}

async function mediaFromArticle(sections) {
  const links = new Set();
  const more = new Set();
  for (const s of sections) {
    if (!MEDIA_SECTION.test(s.title)) continue;
    mediaLinks(s.nodes, links);
    for (const n of s.nodes) n.querySelectorAll?.('.hatnote a[href^="/wiki/"]').forEach(a => {
      const tt = decodeURIComponent(a.getAttribute('href').slice(6)).split('#')[0].replace(/_/g, ' ');
      if (/in (other )?media|in film|in television/i.test(tt)) more.add(tt);
    });
  }
  for (const page of [...more].slice(0, 3)) {
    try {
      const d = await wiki({ action: 'parse', page, prop: 'text', redirects: '1', disableeditsection: '1' });
      const doc = new DOMParser().parseFromString(d.parse.text, 'text/html');
      for (const s of splitSections(doc)) if (!/^(references|notes|external links|see also|video games|novels|books|music)/i.test(s.title)) mediaLinks(s.nodes, links);
    } catch { /* ignore */ }
  }
  const titles = [...links].slice(0, 250);
  const out = { tv: [], films: [] };
  for (let i = 0; i < titles.length; i += 50) {
    try {
      const d = await wiki({ action: 'query', titles: titles.slice(i, i + 50).join('|'), redirects: '1',
        prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '400', pilicense: 'any' });
      for (const p of d.query?.pages || []) {
        const desc = p.description || '';
        if (p.missing || !desc || SKIP_DESC.test(desc)) continue;
        const kind = TV_DESC.test(desc) ? 'tv' : FILM_DESC.test(desc) ? 'films' : null;
        if (!kind) continue;
        const y = desc.match(/\b(19\d{2}|20\d{2})\b/) || p.title.match(/\((19\d{2}|20\d{2})\b/);
        out[kind].push({ name: p.title.replace(/\s*\([^)]*\)$/, ''), wiki: p.title,
          year: y ? Number(y[1]) : undefined, thumb: p.thumbnail?.source });
      }
    } catch { /* ignore */ }
  }
  return out;
}

function mergeMedia(c, extra) {
  for (const key of ['tv', 'films']) {
    const list = [...(c[key] || [])];
    const seen = new Set(list.map(m => (m.wiki || m.name).toLowerCase()));
    for (const m of extra[key]) {
      const k = m.wiki.toLowerCase();
      if (BAD_MEDIA.test(m.name)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      list.push(m);
    }
    list.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.name.localeCompare(b.name));
    c[key] = list.slice(0, 120);
  }
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
