import { getUniverse, loadAll, UNIVERSES, ALIGNMENT, el, setImage, initials, nameOf } from './data.js';
import { t, lang } from './i18n.js';

const u = getUniverse();
if (!u) location.replace('index.html');

document.body.classList.add(u.key);
document.title = `${t('u.characters', { u: u.label })} – Comic Book Guide`;
document.getElementById('title').textContent = t('u.characters', { u: u.label });
const other = u.key === 'marvel' ? UNIVERSES.dc : UNIVERSES.marvel;
document.getElementById('switch').append(
  `${t('u.switch')} `, el('a', { href: `universe.html?u=${other.key}`, text: other.label })
);

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
$('q').value = params.get('q') || '';
$('sort').value = params.get('sort') || 'az';
$('align').value = params.get('align') || '';

let characters = [];

// Výška horní lišty – filtr se ukotví těsně pod ni
const topbarH = () => document.querySelector('.topbar')?.offsetHeight || 0;
const setTopbarVar = () => document.documentElement.style.setProperty('--topbar-h', `${topbarH()}px`);
setTopbarVar();
addEventListener('resize', setTopbarVar);
const collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });

function sorted(list, mode) {
  const byName = (a, b) => collator.compare(a.display, b.display);
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
  if (params.get('lang')) p.set('lang', params.get('lang'));
  if (q) p.set('q', q);
  if (mode !== 'az') p.set('sort', mode);
  if (align) p.set('align', align);
  history.replaceState(null, '', `?${p}`);

  const list = sorted(characters.filter(c =>
    (!align || c.align === align) &&
    (!q || c.search.includes(q))
  ), mode);

  $('count').textContent = t('u.count', { n: list.length, total: characters.length });
  $('state').textContent = list.length ? '' : t('u.none');
  $('state').hidden = list.length > 0;

  const frag = document.createDocumentFragment();
  for (const c of list) {
    const a = ALIGNMENT[c.align];
    const avatar = el('div', { class: 'avatar backdrop' });
    const img = el('img', { alt: c.display, loading: 'lazy', width: 320, height: 320 });
    avatar.append(img);
    setImage(img, c, () => img.replaceWith(el('span', { class: 'initials', text: initials(c.display) })));
    frag.append(el('a', { class: 'card', href: `character.html?u=${u.key}&id=${c.id}` },
      el('div', { class: 'name', text: c.display }),
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
  for (const c of characters) {
    c.display = nameOf(c);
    c.search = [c.name, c.nameCs, c.realName, ...(c.aliases || [])].filter(Boolean).join(' | ').toLowerCase();
  }
  // Při změně filtru odscrollovat na začátek výsledků (filtr zůstává ukotvený nahoře)
  const toResults = () => {
    const top = $('grid').getBoundingClientRect().top + scrollY - $('toolbar').offsetHeight - topbarH() - 16;
    if (scrollY > top) scrollTo({ top, behavior: 'smooth' });
  };
  for (const id of ['q', 'sort', 'align']) $(id).addEventListener('input', () => { render(); toResults(); });
  render();
} catch (e) {
  $('state').textContent = e.message;
  $('state').classList.add('error');
}
