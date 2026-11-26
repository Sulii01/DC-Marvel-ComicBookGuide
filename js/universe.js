import { getUniverse, loadAll, UNIVERSES, ALIGNMENT, el, setImage, initials } from './data.js';

const u = getUniverse();
if (!u) location.replace('index.html');

document.body.classList.add(u.key);
document.title = `${u.label} postavy – Comic Book Guide`;
document.getElementById('title').textContent = `${u.label} postavy`;
const other = u.key === 'marvel' ? UNIVERSES.dc : UNIVERSES.marvel;
document.getElementById('switch').append(
  'Přepnout na ', el('a', { href: `universe.html?u=${other.key}`, text: other.label })
);

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
$('q').value = params.get('q') || '';
$('sort').value = params.get('sort') || 'az';
$('align').value = params.get('align') || '';

let characters = [];
const collator = new Intl.Collator('cs', { sensitivity: 'base', numeric: true });

function sorted(list, mode) {
  const byName = (a, b) => collator.compare(a.name, b.name);
  // Postavy bez známého roku jdou vždy na konec
  const byYear = dir => (a, b) => {
    if (a.year == null && b.year == null) return byName(a, b);
    if (a.year == null) return 1;
    if (b.year == null) return -1;
    return dir * (a.year - b.year) || byName(a, b);
  };
  const cmp = { az: byName, za: (a, b) => -byName(a, b), new: byYear(-1), old: byYear(1) }[mode] || byName;
  return [...list].sort(cmp);
}

function render() {
  const q = $('q').value.trim().toLowerCase();
  const align = $('align').value;
  const mode = $('sort').value;

  const p = new URLSearchParams({ u: u.key });
  if (q) p.set('q', q);
  if (mode !== 'az') p.set('sort', mode);
  if (align) p.set('align', align);
  history.replaceState(null, '', `?${p}`);

  const list = sorted(characters.filter(c =>
    (!align || c.align === align) &&
    (!q || c.search.includes(q))
  ), mode);

  $('count').textContent = `${list.length} z ${characters.length}`;
  $('state').textContent = list.length ? '' : 'Žádná postava neodpovídá filtru.';
  $('state').hidden = list.length > 0;

  const frag = document.createDocumentFragment();
  for (const c of list) {
    const a = ALIGNMENT[c.align];
    const avatar = el('div', { class: 'avatar' });
    const img = el('img', { alt: c.name, loading: 'lazy', width: 320, height: 320 });
    avatar.append(img);
    setImage(img, c, () => img.replaceWith(el('span', { class: 'initials', text: initials(c.name) })));
    frag.append(el('a', { class: 'card', href: `character.html?u=${u.key}&id=${c.id}` },
      el('div', { class: 'name', text: c.name }),
      avatar,
      el('div', { class: 'meta' },
        a ? el('span', { class: `badge ${a.cls}`, text: a.label }) : null,
        c.year ? ` · ${c.year}` : '')
    ));
  }
  $('grid').replaceChildren(frag);
}

try {
  characters = await loadAll(u.key);
  for (const c of characters)
    c.search = [c.name, c.realName, ...(c.aliases || [])].filter(Boolean).join(' | ').toLowerCase();
  for (const id of ['q', 'sort', 'align']) $(id).addEventListener('input', render);
  render();
} catch (e) {
  $('state').textContent = e.message;
  $('state').classList.add('error');
}
