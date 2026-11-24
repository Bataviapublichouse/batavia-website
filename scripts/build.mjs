// Builds the public site into dist/.
// Netlify runs this on every publish (see netlify.toml), so edits made in Pages CMS
// end up in the HTML itself. That matters because search engines and AI assistants
// (ChatGPT, Claude, Perplexity) read the HTML and do not run the page's JavaScript.
//
// Output: one page per language (/ for Dutch, /en/, /de/ ... for the others), with the
// text filled in, search titles and descriptions, language links, structured data
// (schema.org), plus robots.txt, sitemap.xml and llms.txt.
// Missing translations fall back to English (Frisian falls back to Dutch).
// No dependencies: plain Node.

import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://bataviapublichouse.nl';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'dist');

// code, name in its own language, html lang / hreflang, Open Graph locale, extra font for its script
const LANGUAGES = [
  ['nl', 'Nederlands', 'nl', 'nl_NL'],
  ['en', 'English', 'en', 'en_GB'],
  ['de', 'Deutsch', 'de', 'de_DE'],
  ['fr', 'Français', 'fr', 'fr_FR'],
  ['es', 'Español', 'es', 'es_ES'],
  ['it', 'Italiano', 'it', 'it_IT'],
  ['pt', 'Português', 'pt', 'pt_PT'],
  ['zh', '中文', 'zh-Hans', 'zh_CN', 'Noto Serif SC'],
  ['ja', '日本語', 'ja', 'ja_JP', 'Noto Serif JP'],
  ['ar', 'العربية', 'ar', 'ar_AR', 'Amiri'],
  ['hi', 'हिन्दी', 'hi', 'hi_IN', 'Noto Serif Devanagari'],
  ['ru', 'Русский', 'ru', 'ru_RU', 'Playfair Display'],
  ['pl', 'Polski', 'pl', 'pl_PL'],
  ['tr', 'Türkçe', 'tr', 'tr_TR'],
  ['el', 'Ελληνικά', 'el', 'el_GR', 'GFS Didot'],
  ['da', 'Dansk', 'da', 'da_DK'],
  ['sv', 'Svenska', 'sv', 'sv_SE'],
  ['fy', 'Frysk', 'fy', 'fy_NL'],
].map(([code, name, tag, locale, font]) => ({ code, name, tag, locale, font }));
const LANGS = LANGUAGES.map((x) => x.code);
const L = Object.fromEntries(LANGUAGES.map((x) => [x.code, x]));
const RTL = new Set(['ar']);
const FONT_WEIGHTS = { 'GFS Didot': '', Amiri: ':wght@400;700' };
const base = (l) => (l === 'nl' || l === 'fy' ? 'nl' : 'en');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJSON = (p, fallback) => { try { return JSON.parse(read(p)); } catch (e) { return fallback; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = (o, k) => k.split('.').reduce((a, b) => (a == null ? a : a[b]), o);
const urlFor = (l) => (l === 'nl' ? SITE + '/' : SITE + '/' + l + '/');
const pathFor = (l) => (l === 'nl' ? '/' : '/' + l + '/');
function merge(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const k of Object.keys(b || {})) {
    const v = b[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v;
  }
  return out;
}

const template = read('index.html');
const UI = readJSON('content/ui.json', {});
const CONTENT = Object.fromEntries(LANGS.map((l) => [l, readJSON(`content/${l}.json`, {})]));
const HOURS = readJSON('content/opening-hours.json', null);
const MENUS = readJSON('content/menus.json', { menus: [] }).menus || [];
const PHOTOS = readJSON('content/history-photos.json', { photos: [] }).photos || [];
const TEAM = readJSON('content/team.json', { visible: false, members: [], press: [] });
const BIZ = readJSON('content/business.json', {});
const TEAM_ON = TEAM.visible === true;
const uiFor = (l) => merge(UI[base(l)] || {}, UI[l] || {});
const contentFor = (l) => merge(CONTENT[base(l)] || {}, CONTENT[l] || {});
// Contact details come from the footer of index.html, so they are kept in one place.
const footer = template.slice(template.indexOf('<footer'));
const CONTACT = {
  email: (/href="mailto:([^"?]+)/.exec(footer) || [])[1] || '',
  phone: (/href="tel:([^"]+)/.exec(footer) || [])[1] || '',
};
// Text that belongs to the team page stays out of the HTML while that page is switched off.
const hiddenKey = (k) => !TEAM_ON && (k === 'nav.team' || k === 'home.peopleLink' || k.startsWith('team.'));

const DAYKEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fillById(html, id, inner) {
  const re = new RegExp(`(<([a-z0-9]+)[^>]*\\sid="${id}"[^>]*>)([\\s\\S]*?)(</\\2>)`, 'i');
  if (!re.test(html)) throw new Error('Element #' + id + ' not found in index.html');
  return html.replace(re, (m, open, tag, _old, close) => open + inner + close);
}
function setAttr(tag, name, value) {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  const attr = ` ${name}="${esc(value)}"`;
  return re.test(tag) ? tag.replace(re, attr) : tag.replace(/\s*\/?>$/, (end) => attr + end);
}

function renderPage(l) {
  const pick = (o) => (o ? o[l] || o[base(l)] || o.en || o.nl || '' : '');
  const fixed = uiFor(l);
  const t = merge(fixed, contentFor(l));
  if (t.team && t.team.title) t.nav.team = t.team.title;
  let html = template;

  html = html.replace(/<html lang="[^"]*"/, `<html lang="${L[l].tag}"${RTL.has(l) ? ' dir="rtl"' : ''}`);
  // The page's own interface strings, so the script needs no extra download
  html = html.replace(/var FIXED = \{\};[^\n]*/, `var FIXED = ${JSON.stringify({ [l]: fixed }).replace(/</g, '\\u003c')};`);

  // Text: every element with data-t="key" gets its text.
  html = html.replace(/<([a-z0-9]+)((?:\s[^>]*?)?\sdata-t="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, key, inner) => {
    if (hiddenKey(key)) return m;
    const v = get(t, key);
    if (v == null || typeof v === 'object') return m;
    if (/<[a-z]/i.test(inner)) throw new Error('data-t element has child elements: ' + key);
    return `<${tag}${attrs}>${esc(v)}</${tag}>`;
  });
  // Attributes: data-ta="attr:key;attr:key"
  html = html.replace(/<[a-z0-9]+(?:\s[^>]*?)?\sdata-ta="([^"]+)"[^>]*>/gi, (tagStr, spec) => {
    let out = tagStr;
    for (const pair of spec.split(';')) {
      const i = pair.indexOf(':');
      const v = get(t, pair.slice(i + 1));
      if (v != null && typeof v !== 'object') out = setAttr(out, pair.slice(0, i), v);
    }
    return out;
  });

  // Language menu: real links, so search engines find every language
  html = html.replace('<!--LANGS-->', LANGUAGES.map((x) =>
    `<li><a href="${pathFor(x.code)}" hreflang="${x.tag}" lang="${x.tag}" data-lang="${x.code}"${x.code === l ? ' aria-current="true"' : ''}>${esc(x.name)}</a></li>`).join(''));
  html = fillById(html, 'langCode', l.toUpperCase());

  // History timeline
  html = fillById(html, 'timeline', (t.building?.timeline || []).map((e) =>
    `<li><span class="yr">${esc(e.year)}</span><div><h3>${esc(e.title)}</h3><p>${esc(e.text)}</p></div></li>`).join(''));

  // Menus
  html = fillById(html, 'menuList', MENUS.map((m) => {
    const right = m.pdf ? `<a href="${esc(m.pdf)}" target="_blank" rel="noopener">${esc(t.menus.open)}</a>` : `<span>${esc(t.menus.pdfNote)}</span>`;
    return `<li><span>${esc(pick(m.name))}</span>${right}</li>`;
  }).join(''));

  // Opening hours
  const dayName = (d) => t.home.days['d' + (d === 0 ? 7 : d)];
  if (HOURS && HOURS.preopening) {
    const note = esc(pick(HOURS.announcement));
    for (const id of ['status1', 'status2', 'status3']) html = fillById(html, id, note);
    html = fillById(html, 'hoursBody', [1, 2, 3, 4, 5, 6, 0].map((d) => `<tr><th scope="row">${esc(dayName(d))}</th><td>${esc(pick(HOURS.tba))}</td></tr>`).join(''));
  } else if (HOURS) {
    html = fillById(html, 'hoursBody', [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const h = HOURS[DAYKEYS[d]];
      return `<tr><th scope="row">${esc(dayName(d))}</th><td>${h && h.open ? esc(h.from) + '–' + esc(h.until) : esc(t.status.closed)}</td></tr>`;
    }).join(''));
  }

  // First history photo, so the gallery is not empty before the script runs
  if (PHOTOS.length) {
    const cap = pick(PHOTOS[0].caption);
    html = html.replace(/<img id="galImg" alt="">/, `<img id="galImg" src="/${esc(String(PHOTOS[0].photo || '').replace(/^\//, ''))}" alt="${esc(cap)}">`);
    html = fillById(html, 'galCap', esc(cap));
    html = fillById(html, 'galCount', `1 / ${PHOTOS.length}`);
  }

  // Team page, only when it is switched on
  if (TEAM_ON) {
    html = html.replace(/<(li|p) data-team hidden/g, '<$1 data-team');
    const paras = (s) => String(s || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
    html = fillById(html, 'teamList', (TEAM.members || []).map((m) => {
      const ms = (m.milestones || []).map((x) => `<li><span class="yr">${esc(x.year)}</span><div><p>${esc(pick(x.text))}</p></div></li>`).join('');
      return `<li class="member"><div class="portrait"></div><h2>${esc(m.name)}</h2><p class="role">${esc(pick(m.role))}</p><div class="bio">${paras(pick(m.bio))}</div>${ms ? `<h3>${esc(t.team.careerTitle)}</h3><ol class="timeline">${ms}</ol>` : ''}</li>`;
    }).join(''));
    html = fillById(html, 'pressList', (TEAM.press || []).map((p) =>
      `<li><span class="yr">${esc(p.date)}</span><div><h3>${p.url ? `<a href="${esc(p.url)}">${esc(p.title)}</a>` : esc(p.title)}</h3><p class="src">${esc(p.source)}</p><p class="note">${esc(pick(p.note))}</p></div></li>`).join(''));
  }

  // Head: title, description, canonical, language versions, social preview, fonts, structured data
  const title = t.seo?.title || 'Batavia Public House';
  const desc = t.seo?.description || '';
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
  const font = L[l].font;
  const head = [
    `<link rel="canonical" href="${urlFor(l)}">`,
    ...LANGUAGES.map((x) => `<link rel="alternate" hreflang="${x.tag}" href="${urlFor(x.code)}">`),
    `<link rel="alternate" hreflang="x-default" href="${urlFor('nl')}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Batavia Public House">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${urlFor(l)}">`,
    `<meta property="og:image" content="${SITE}/media/poster.jpg">`,
    `<meta property="og:image:width" content="1280">`,
    `<meta property="og:image:height" content="720">`,
    `<meta property="og:locale" content="${L[l].locale}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="icon" href="/media/logo.png">`,
    ...(font ? [
      `<link href="https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}${FONT_WEIGHTS[font] ?? ':wght@400;600'}&display=swap" rel="stylesheet">`,
      `<style>:root { --serif: 'Bodoni Moda', '${font}', Georgia, serif; }</style>`,
    ] : []),
    `<script type="application/ld+json">${JSON.stringify(structuredData(l, t, desc)).replace(/</g, '\\u003c')}</script>`,
  ].join('\n');
  html = html.replace('<!--SEO-->', head);
  return html;
}

function structuredData(l, t, desc) {
  const bar = {
    '@type': 'BarOrPub',
    '@id': SITE + '/#bar',
    name: 'Batavia Public House',
    alternateName: ['Batavia', 'Batavia Pub', 'Batavia Cocktailbar', 'Batavia Amsterdam'],
    slogan: 'Brown Cocktail Pub',
    description: desc,
    url: SITE + '/',
    logo: SITE + '/media/logo.png',
    image: [SITE + '/media/poster.jpg', SITE + '/media/still-bar.jpg', SITE + '/media/still-room.jpg'],
    address: { '@type': 'PostalAddress', streetAddress: 'Lijnbaanssteeg 5-7', postalCode: '1012 TE', addressLocality: 'Amsterdam', addressRegion: 'Noord-Holland', addressCountry: 'NL' },
    hasMap: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Batavia Public House, Lijnbaanssteeg 5-7, 1012 TE Amsterdam'),
    founder: [{ '@type': 'Person', name: 'Jimmy Hu' }, { '@type': 'Person', name: 'Samuel Stok' }],
    maximumAttendeeCapacity: 70,
    amenityFeature: [
      { '@type': 'LocationFeatureSpecification', name: 'Terrace', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Alcohol-free cocktails', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Private hire and events up to 70 guests', value: true },
      ...(BIZ.wheelchairAccessible ? [{ '@type': 'LocationFeatureSpecification', name: 'Wheelchair accessible', value: true }] : []),
      ...(BIZ.petsAllowed ? [{ '@type': 'LocationFeatureSpecification', name: 'Pets allowed', value: true }] : []),
      ...(BIZ.walkIns ? [{ '@type': 'LocationFeatureSpecification', name: 'Walk-ins welcome', value: true }] : []),
    ],
    availableLanguage: ['Dutch', 'English'],
  };
  if (CONTACT.phone) bar.telephone = CONTACT.phone;
  if (CONTACT.email) bar.email = CONTACT.email;
  if (BIZ.priceRange) bar.priceRange = BIZ.priceRange;
  if (BIZ.paymentAccepted) { bar.paymentAccepted = BIZ.paymentAccepted; bar.currenciesAccepted = 'EUR'; }
  if (typeof BIZ.acceptsReservations === 'boolean') bar.acceptsReservations = BIZ.acceptsReservations;
  if (Array.isArray(BIZ.servesCuisine) && BIZ.servesCuisine.length) bar.servesCuisine = BIZ.servesCuisine.filter(Boolean);
  const links = (BIZ.links || []).filter((u) => /^https?:\/\//.test(String(u || '')));
  if (links.length) bar.sameAs = links;
  if (HOURS && !HOURS.preopening) {
    bar.openingHoursSpecification = DAYKEYS.map((k, d) => [k, d]).filter(([k]) => HOURS[k] && HOURS[k].open)
      .map(([k, d]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/' + SCHEMA_DAYS[d], opens: HOURS[k].from, closes: HOURS[k].until }));
  }
  const page = {
    '@type': 'WebPage',
    '@id': urlFor(l) + '#webpage',
    url: urlFor(l),
    name: t.seo?.title || 'Batavia Public House',
    description: desc,
    inLanguage: L[l].tag,
    isPartOf: { '@id': SITE + '/#website' },
    about: { '@id': SITE + '/#bar' },
  };
  const site = { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: 'Batavia Public House', inLanguage: LANGUAGES.map((x) => x.tag), publisher: { '@id': SITE + '/#bar' } };
  return { '@context': 'https://schema.org', '@graph': [bar, site, page] };
}

function llmsTxt() {
  const t = merge(uiFor('en'), contentFor('en'));
  const pick = (o) => (o ? o.en || o.nl || '' : '');
  const lines = [];
  lines.push('# Batavia Public House', '');
  lines.push(`> ${t.seo?.description || ''}`, '');
  lines.push('Batavia Public House (also: Batavia, Batavia Pub) is a new cocktail bar and pub ("Brown Cocktail Pub") in the historic centre of Amsterdam, the Netherlands. It combines a cocktail bar with a traditional Amsterdam brown café (bruine kroeg).', '');
  lines.push('What makes it different: cocktails made with local Dutch produce; a cocktail bar in a building of almost 300 years old (1734); top-level service in a pub setting.', '');
  lines.push('## Key facts', '');
  lines.push('- Type: cocktail bar and pub, with Dutch food');
  lines.push('- Address: Lijnbaanssteeg 5-7, 1012 TE Amsterdam, the Netherlands (Amsterdam city centre, in the alley between Singel and Spuistraat, about 10 minutes on foot from Amsterdam Centraal station)');
  lines.push('- Building: two houses from 1734; earlier a printing works, Michelin-starred restaurant Gravenmolen (1972-1976) and cocktail bar Tales & Spirits');
  lines.push('- Owners: Jimmy Hu and Samuel Stok, award-winning bartenders');
  if (HOURS) lines.push(`- Opening: ${HOURS.preopening ? pick(HOURS.announcement) : 'open'}`);
  if (HOURS && !HOURS.preopening) {
    for (const [k, d] of DAYKEYS.map((k, d) => [k, d])) lines.push(`- ${SCHEMA_DAYS[d]}: ${HOURS[k] && HOURS[k].open ? HOURS[k].from + '-' + HOURS[k].until : 'closed'}`);
  }
  if (BIZ.priceRange) lines.push(`- Prices: cocktails ${BIZ.priceRange.replace(/ per cocktail$/, '')}`);
  if (BIZ.seats) lines.push(`- Seats: ${BIZ.seats}, plus a terrace for 15 in good weather`);
  lines.push(`- ${BIZ.walkIns ? 'Walk-ins welcome' : 'Walk-ins'}${BIZ.acceptsReservations ? '; reservations by message, phone or WhatsApp' : ''}`);
  if (BIZ.wheelchairAccessible) lines.push('- Wheelchair accessible');
  if (BIZ.petsAllowed) lines.push('- Pets allowed');
  if (BIZ.paymentAccepted) lines.push(`- Payment: ${BIZ.paymentAccepted.toLowerCase()}`);
  lines.push('- Food: Dutch dishes made with local produce; menus change with the seasons');
  lines.push('- Homemade alcohol-free cocktails with local products');
  lines.push('- Private hire and events: up to 70 guests, with catering');
  if (CONTACT.phone) lines.push(`- Phone and WhatsApp: ${CONTACT.phone}`);
  if (CONTACT.email) lines.push(`- Email: ${CONTACT.email}`);
  const links = (BIZ.links || []).filter(Boolean);
  if (links.length) lines.push('- Also on: ' + links.join(', '));
  lines.push('');
  lines.push('## About', '');
  for (const k of ['lead', 'impBody1', 'impBody2', 'peopleText', 'k4Text']) if (t.home?.[k]) lines.push(t.home[k], '');
  if (t.film?.c4text) lines.push(t.film.c4text, '');
  if (t.events?.fact2Text) lines.push(t.events.fact2Text, '');
  if (t.contact?.lead) lines.push(t.contact.lead, '');
  lines.push('## The building', '');
  if (t.building?.lead) lines.push(t.building.lead, '');
  if (t.building?.nameText) lines.push(t.building.nameText, '');
  if (t.building?.streetText) lines.push(t.building.streetText, '');
  for (const e of t.building?.timeline || []) lines.push(`- ${e.year}: ${e.title}. ${e.text}`);
  lines.push('');
  lines.push('## Languages', '');
  lines.push('The website is available in: ' + LANGUAGES.map((x) => `[${x.name}](${urlFor(x.code)})`).join(', '));
  return lines.join('\n') + '\n';
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const alts = LANGUAGES.map((x) => `    <xhtml:link rel="alternate" hreflang="${x.tag}" href="${urlFor(x.code)}"/>`).join('\n') +
    `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor('nl')}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map((l) => `  <url>\n    <loc>${urlFor(l)}</loc>\n    <lastmod>${today}</lastmod>\n${alts}\n  </url>`).join('\n')}
</urlset>
`;
}

const robots = `# Search engines and AI assistants are welcome.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

// Write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'media'), path.join(OUT, 'media'), { recursive: true });
fs.cpSync(path.join(ROOT, 'content'), path.join(OUT, 'content'), { recursive: true });
for (const l of LANGS) {
  // Complete text file per language (missing translations filled in), as the page script loads it
  fs.writeFileSync(path.join(OUT, 'content', l + '.json'), JSON.stringify(contentFor(l)));
  const dir = l === 'nl' ? OUT : path.join(OUT, l);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), renderPage(l));
}
fs.writeFileSync(path.join(OUT, 'robots.txt'), robots);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap());
fs.writeFileSync(path.join(OUT, 'llms.txt'), llmsTxt());
const missing = LANGS.filter((l) => !fs.existsSync(path.join(ROOT, 'content', l + '.json')));
console.log(`Built ${LANGS.length} language pages into dist/ (team page ${TEAM_ON ? 'on' : 'off'}).` + (missing.length ? ' Using English for: ' + missing.join(', ') : ''));
