import { getUniverse, loadOne, ALIGNMENT, clean, el } from './data.js';

const u = getUniverse();
const id = new URLSearchParams(location.search).get('id');
if (!u || !id) location.replace('index.html');
document.body.classList.add(u.key);

const $ = x => document.getElementById(x);
const WIKI = 'https://en.wikipedia.org/w/api.php';

function specRows(target, rows) {
  for (const [label, value] of rows) {
    const v = clean(value);
    if (!v) continue;
    target.append(el('dt', { text: label }), el('dd', { text: v }));
  }
}

function renderBase(c) {
  document.title = `${c.name} – ${u.label} – Comic Book Guide`;
  $('crumbs').append(' / ', el('a', { href: `universe.html?u=${u.key}`, text: `${u.label} postavy` }), ` / ${c.name}`);
  $('name').textContent = c.name;
  const full = clean(c.biography.fullName);
  $('real').textContent = full && full !== c.name ? full : '';

  const a = ALIGNMENT[c.biography.alignment];
  if (a) $('badges').append(el('span', { class: `badge ${a.cls}`, text: a.label }));

  // Dočasný obrázek, než se načte celá postava z Wikipedie
  $('full').src = c.images.lg;
  $('full').alt = c.name;

  specRows($('specs'), [
    ['Celé jméno', c.biography.fullName],
    ['Alter ega', c.biography.alterEgos],
    ['Přezdívky', c.biography.aliases],
    ['Místo narození', c.biography.placeOfBirth],
    ['První výskyt', c.biography.firstAppearance],
    ['Vydavatel', c.biography.publisher],
    ['Povolání', c.work.occupation],
    ['Základna', c.work.base],
    ['Týmy / skupiny', c.connections.groupAffiliation],
    ['Příbuzní', c.connections.relatives],
  ]);

  specRows($('appearance'), [
    ['Pohlaví', c.appearance.gender],
    ['Rasa / druh', c.appearance.race],
    ['Výška', (c.appearance.height || []).filter(h => !/^-|^0 /.test(h)).join(' / ')],
    ['Váha', (c.appearance.weight || []).filter(w => !/^-|^0 /.test(w)).join(' / ')],
    ['Barva očí', c.appearance.eyeColor],
    ['Barva vlasů', c.appearance.hairColor],
  ]);

  const names = { intelligence: 'Inteligence', strength: 'Síla', speed: 'Rychlost',
                  durability: 'Odolnost', power: 'Moc', combat: 'Boj' };
  for (const [k, label] of Object.entries(names)) {
    const v = Number(c.powerstats[k]) || 0;
    $('stats').append(el('div', { class: 'stat' },
      el('span', { text: label }),
      el('div', { class: 'bar' }, el('span', { style: `width:${Math.min(v, 100)}%` })),
      el('span', { class: 'val', text: String(v) })));
  }

  $('state').hidden = true;
  $('content').hidden = false;
}

/* ---------------- Wikipedie ---------------- */

async function wiki(params) {
  const p = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetch(`${WIKI}?${p}`);
  if (!res.ok) throw new Error(`Wikipedie HTTP ${res.status}`);
  return res.json();
}

// Najde článek o postavě: hledá jméno + vydavatele, upřednostní článek,
// který ve výsledku hledání zmiňuje správného vydavatele.
async function findArticle(c) {
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
      out.push(el(lvl, { text: n.textContent.replace(/\[edit\]/g, '').trim() }));
    } else if (n.matches('p')) {
      const t = n.textContent.replace(/\[\d+\]|\[[a-z]\]|\[citation needed\]/g, '').trim();
      if (t) out.push(el('p', { text: t }));
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
  const add = (t, note) => {
    t = t.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
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
          if (cell) add(cell.textContent, 'Souborné vydání');
        });
        n.querySelectorAll?.('li').forEach(li => {
          const i = li.querySelector('i');
          add(i ? i.textContent : li.textContent.split(/[–(:]/)[0], 'Komiks');
        });
      }
    }
  }
  // Názvy sérií zmíněné kurzívou v historii vydávání a v biografii
  for (const s of sections) {
    if (PUB.test(s.title) || BIO.test(s.title)) {
      for (const n of s.nodes) n.querySelectorAll?.('p i, li i').forEach(i => {
        // kurzíva v poznámkách typu [volume and issue needed] není název komiksu
        if (!i.closest('sup, .noprint, .Template-Fact')) add(i.textContent, 'Komiksová série');
      });
    }
  }
  return [...found.values()].slice(0, 120);
}

async function loadWiki(c) {
  const origin = $('origin');
  const comics = $('comics');

  // Vždy zobrazit první výskyt jako první komiks
  const first = clean(c.biography.firstAppearance);
  const items = [];
  if (first) items.push({ title: first, note: 'První výskyt', first: true });

  let title;
  try {
    title = await findArticle(c);
    if (!title) throw new Error('Článek nenalezen');
    const data = await wiki({ action: 'parse', page: title, prop: 'text', redirects: '1', disableeditsection: '1' });
    const doc = new DOMParser().parseFromString(data.parse.text, 'text/html');
    const sections = splitSections(doc);
    const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(data.parse.title.replace(/ /g, '_'))}`;

    // Obrázek celé postavy z infoboxu
    const infoImg = doc.querySelector('.infobox img');
    if (infoImg) {
      let src = infoImg.getAttribute('src');
      if (src.startsWith('//')) src = 'https:' + src;
      // větší rozlišení náhledu
      src = src.replace(/\/(\d+)px-/, '/600px-');
      const img = $('full');
      const fallback = img.src;
      img.onerror = () => { img.onerror = null; img.src = fallback; };
      img.src = src;
      $('credit').append('Obrázek: ', el('a', { href: pageUrl, target: '_blank', rel: 'noopener', text: 'Wikipedie' }));
    }

    // Origin story: intro + biografie postavy
    const intro = sections.find(s => s.title === '__intro');
    const bio = sections.filter(s => BIO.test(s.title));
    const pub = sections.find(s => PUB.test(s.title));
    const parts = [...toSafe(intro?.nodes || [])];
    for (const s of bio) parts.push(el('h3', { text: s.title }), ...toSafe(s.nodes));
    if (!bio.length && pub) parts.push(el('h3', { text: pub.title }), ...toSafe(pub.nodes));
    origin.replaceChildren(...parts);
    if (parts.length > 6) {
      origin.classList.add('collapsed');
      const btn = el('button', { class: 'btn', type: 'button', text: 'Zobrazit celý příběh' });
      btn.onclick = () => { origin.classList.remove('collapsed'); btn.remove(); };
      origin.after(btn);
    }
    origin.parentElement.append(el('p', { class: 'source' },
      'Zdroj: ', el('a', { href: pageUrl, target: '_blank', rel: 'noopener', text: `Wikipedie – ${data.parse.title}` }),
      ' (CC BY-SA 4.0) · Více na ',
      el('a', { href: `${u.fandom}/wiki/Special:Search?query=${encodeURIComponent(c.name)}`, target: '_blank', rel: 'noopener', text: `${u.label} Fandom wiki` })));

    items.push(...extractComics(sections));
    $('comics-source').append('Seznam sestaven z článku ',
      el('a', { href: pageUrl, target: '_blank', rel: 'noopener', text: data.parse.title }), ' na Wikipedii.');
  } catch (e) {
    origin.replaceChildren(el('p', { class: 'state error', text: `Příběh se nepodařilo načíst (${e.message}).` }));
  }
  if (!items.length) { comics.append(el('li', { text: 'Žádné komiksy nenalezeny.' })); return; }
  const cards = items.map(comicCard);
  comics.replaceChildren(...cards.map(c => c.li));
  loadCovers(items, cards);
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
const NOT_COMIC = /character|superhero|supervillain|villain|film|television|video game|novel by|band|album/i;

// Pro každý komiks najde článek na Wikipedii s obálkou (infobox) a doplní obrázek.
async function loadCovers(items, cards) {
  const bases = items.map(x => baseTitle(x.title));
  const candidatesFor = b => [`${b} (comic book)`, `${b} (comics)`, `${b} (comic)`, b];
  const all = [...new Set(bases.flatMap(candidatesFor))];
  const pages = new Map();   // požadovaný název -> stránka

  for (let i = 0; i < all.length; i += 50) {
    const chunk = all.slice(i, i + 50);
    try {
      const d = await wiki({ action: 'query', titles: chunk.join('|'), redirects: '1',
        prop: 'pageimages|description|info', piprop: 'thumbnail', pithumbsize: '400', inprop: 'url' });
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
    const page = candidatesFor(b).map(t => pages.get(t)).find(p =>
      p && p.thumbnail && COMIC_DESC.test(p.description || '') && !NOT_COMIC.test(p.description || ''));
    if (!page) return;
    const { cover, li } = cards[i];
    const img = el('img', { src: page.thumbnail.source, alt: `Obálka – ${items[i].title}`, loading: 'lazy' });
    img.onerror = () => img.remove();
    cover.append(img);
    cover.classList.add('has-img');
    const a = el('a', { href: page.fullurl, target: '_blank', rel: 'noopener', class: 'comic-link' });
    a.append(...li.childNodes);
    li.append(a);
  });
}

try {
  const c = await loadOne(id);
  renderBase(c);
  loadWiki(c);
} catch (e) {
  $('state').textContent = e.message;
  $('state').classList.add('error');
}
