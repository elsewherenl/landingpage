#!/usr/bin/env node
// Pre-renders the Instagram feed gallery into index.html and spotlight.html so the
// content (image, title, artist, caption) is present in the raw HTML for crawlers
// that don't execute JavaScript, instead of only appearing after a client-side
// fetch() of instagram-feed.json. Run this before every deploy that changes
// instagram-feed.json.
//
// Output markup/classes intentionally match what the existing client-side JS in
// index.html / spotlight.html already renders (grid-item, entry, entry-title, ...),
// so visual output is unchanged — the client JS re-fetches the same JSON to wire up
// the lightbox and resize-driven re-pack, but no longer builds this DOM from scratch.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FEED_PATH = path.join(ROOT, 'instagram-feed.json');

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function optimizedUrl(url, width) {
    if (!url || !url.includes('res.cloudinary.com')) return url;
    return url.replace('/upload/', `/upload/w_${width},q_auto,f_auto/`);
}

// Builds a srcset string offering the same image at several Cloudinary-resized
// widths, so the browser can pick the smallest one that still covers its actual
// rendered size (accounting for pixel density) instead of always downloading the
// single largest variant. Returns '' for non-Cloudinary URLs since there's nothing
// to rewrite (the plain src/image_url fallback already covers that case).
function srcsetUrls(url, widths) {
    if (!url || !url.includes('res.cloudinary.com')) return '';
    return widths.map(w => `${optimizedUrl(url, w)} ${w}w`).join(', ');
}

// Alt text convention: "[Title] — photograph by [Artist]", falling back to
// "Photograph by [Artist]" when the title is missing/empty (null, "", whitespace-only).
// A literal "Untitled" title is treated as a deliberate, real title — not a gap — so it
// is not caught by this fallback. Every post in instagram-feed.json has a non-empty
// artist, so no artist-side fallback is needed here.
function altText(post) {
    const title = (post.title || '').trim();
    const artist = (post.artist || '').trim();
    return title ? `${title}, by ${artist}` : `Photograph by ${artist}`;
}

// Reads width/height from raw image bytes (JPEG SOF marker or PNG IHDR chunk) so we
// don't need an image-processing dependency just to compute an aspect ratio.
function readDimensions(buf) {
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let offset = 2;
        while (offset < buf.length - 8) {
            if (buf[offset] !== 0xff) { offset++; continue; }
            const marker = buf[offset + 1];
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                offset += 2;
                continue;
            }
            const segLength = buf.readUInt16BE(offset + 2);
            const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
            if (isSOF) {
                return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
            }
            offset += 2 + segLength;
        }
    }
    return null;
}

// Fetches a small (w_50) transform of each image — a few hundred bytes to ~1KB — just
// to read its aspect ratio, mirroring what probeAspectRatio() used to do client-side
// with a full <img> load. f_auto is intentionally omitted here (kept only in the real
// <img> src) so the probe always gets JPEG/PNG bytes our tiny parser understands.
// Returns the aspect ratio (width/height) as a float — the probe's own 50px-wide
// pixel dimensions aren't meaningful on their own, only their ratio is; callers that
// need <img width/height> attributes scale this ratio up to the real serving size.
async function fetchAspectRatio(cloudinaryUrl) {
    if (!cloudinaryUrl || !cloudinaryUrl.includes('res.cloudinary.com')) return 1;
    const probeUrl = cloudinaryUrl.replace('/upload/', '/upload/w_50,q_auto/');
    try {
        const res = await fetch(probeUrl);
        if (!res.ok) return 1;
        const buf = Buffer.from(await res.arrayBuffer());
        const dims = readDimensions(buf);
        if (!dims || !dims.width || !dims.height) return 1;
        return dims.width / dims.height;
    } catch (err) {
        return 1;
    }
}

// Derives the <img width/height> attribute pair for a grid image at its real serving
// width, from just the aspect ratio — preserves the true ratio (what matters for CLS)
// without pretending the low-res probe's own pixel dimensions are the real image size.
function dimensionsForRatio(ratio, servingWidth) {
    return { width: servingWidth, height: Math.round(servingWidth / ratio) };
}

// Deterministic string hash (djb2) used to seed the rail's shuffle — stable across
// builds as long as post ids don't change, so re-running generate.js with the same
// instagram-feed.json produces byte-identical output (writeIfChanged stays a no-op).
function seedFromString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash;
}

// Mulberry32: a small deterministic PRNG. Given the same seed it produces the same
// sequence every time, unlike Math.random() — required so the rail's shuffled order
// doesn't change on every generate.js run and defeat writeIfChanged's diffing.
function mulberry32(seed) {
    let a = seed;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Returns a shuffled copy of items (Fisher-Yates) using a PRNG seeded from the ids of
// all items combined, so the editorial rail reads in a different, deliberately varied
// order from the grid's fixed JSON order — but the same different order every build,
// not a fresh shuffle on every page load or generate.js run.
function seededShuffle(items, seedKey) {
    const rand = mulberry32(seedFromString(seedKey));
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// Mirrors packIntoColumns() in spotlight.html's client JS (used when the theme
// filter re-packs the grid): shortest-column masonry using each post's aspect
// ratio, so a filtered re-pack lays posts out the same way the build does.
function packIntoColumns(items, columnCount) {
    const columns = Array.from({ length: columnCount }, () => []);
    const heights = new Array(columnCount).fill(0);
    items.forEach(item => {
        let shortest = 0;
        for (let i = 1; i < columnCount; i++) {
            if (heights[i] < heights[shortest]) shortest = i;
        }
        columns[shortest].push(item);
        heights[shortest] += 1 / item.aspectRatio;
    });
    return columns;
}

// posts, aspectRatios, and dimensions must all be in the same (possibly shuffled)
// display order — dims/aspectRatio are looked up positionally within that order,
// since that's what's actually being packed and rendered at each grid position.
// originalIndexOf maps a post back to its index in the client's fetched
// instagram-feed.json array; data-index uses that mapping (not the display
// position) since openFullscreen() looks posts up client-side as posts[index].
// Defaults to the identity mapping (posts[i] -> i) when the display order already
// matches the fetch order, e.g. index.html's #gridData is built from this same
// shuffled array, so no remapping is needed there.
//
// The grid is rendered twice, packed for 4 columns and for 2: CSS shows the
// layout that matches the viewport (.grid-layout--2 at <= mobileBreakpoint), so
// the page never re-packs on load or resize and nothing shifts once painted.
// Both copies use identical image URLs, so each image only downloads once.
function renderGridHtml(posts, aspectRatios, dimensions, { imageWidth, mobileBreakpoint }, originalIndexOf) {
    const indexOf = originalIndexOf || ((post, i) => i);
    const items = posts.map((post, i) => ({
        post,
        dataIndex: indexOf(post, i),
        isEarly: i < 4,
        isFirst: i === 0,
        dims: dimensions[i] || null,
        aspectRatio: aspectRatios[i] || 1
    }));
    return [4, 2].map(columnCount => `
                <div class="grid-layout grid-layout--${columnCount}">${packIntoColumns(items, columnCount).map(col => `
                <div class="grid-col">
                    ${col.map(({ post, dataIndex, isEarly, isFirst, dims }) => `
                        <article class="grid-item" data-index="${dataIndex}" data-theme="${escapeHtml(post.theme || '')}">
                            <figure>
                                <img src="${escapeHtml(optimizedUrl(post.cloudinary_cropped_url, imageWidth) || post.image_url)}"${srcsetUrls(post.cloudinary_cropped_url, [250, 375, 500, 750]) ? ` srcset="${escapeHtml(srcsetUrls(post.cloudinary_cropped_url, [250, 375, 500, 750]))}" sizes="(max-width: ${mobileBreakpoint}px) 45vw, 22vw"` : ''} alt="${escapeHtml(altText(post))}" width="${dims ? dims.width : ''}" height="${dims ? dims.height : ''}" loading="${isEarly ? 'eager' : 'lazy'}"${isFirst ? ' fetchpriority="high"' : ''}>
                                <figcaption class="grid-item-label">
                                    <h3 class="t">${escapeHtml(post.title || 'Untitled')}</h3>
                                    <p class="a">${escapeHtml(post.artist || '')}</p>
                                </figcaption>
                            </figure>
                        </article>
                    `).join('')}
                </div>`).join('')}
                </div>`).join('');
}

// posts may be in a different order from the client's fetched instagram-feed.json
// array (see seededShuffle) — originalIndexOf maps each post back to its index in
// that array, since data-index is what openFullscreen() uses to look the post up
// client-side (posts[index]) and must stay correct regardless of display order.
// Anchor id for a Spotlight entry, from the artist's name ("Jésula Toussaint
// Visser" -> "jesula-toussaint-visser"), so artist pages can link to
// /spotlight#<id>. A second post by the same artist gets "-2", and so on.
function slugify(str) {
    return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function entryIds(posts) {
    const seen = {};
    const idByPost = new Map();
    for (const post of posts) {
        const base = slugify(post.artist || post.title || 'spotlight') || 'spotlight';
        seen[base] = (seen[base] || 0) + 1;
        idByPost.set(post, seen[base] === 1 ? base : `${base}-${seen[base]}`);
    }
    return idByPost;
}

// dimsOf(post) gives the 800px image's width/height, so the browser reserves
// each image's space before it loads (keeps a /spotlight#<id> jump on target)
function renderRailHtml(posts, originalIndexOf, idByPost, dimsOf) {
    return posts.map((post, i) => {
        const dims = dimsOf(post);
        return `
                    <article class="entry ${i % 2 === 1 ? 'is-reversed' : ''}" id="${escapeHtml(idByPost.get(post))}" data-theme="${escapeHtml(post.theme || '')}">
                        <figure class="entry-figure" data-index="${originalIndexOf(post)}">
                            <img src="${escapeHtml(optimizedUrl(post.cloudinary_cropped_url, 800) || post.image_url)}" alt="${escapeHtml(altText(post))}" width="${dims.width}" height="${dims.height}" loading="lazy">
                        </figure>
                        <div class="entry-meta">
                            <h2 class="entry-title">${escapeHtml(post.title || 'Untitled')}</h2>
                            <p class="entry-artist">${escapeHtml(post.artist || '')}</p>
                            <p class="entry-caption">${escapeHtml(post.caption || '')}</p>${post.artist_page ? `
                            <a class="entry-link" href="${escapeHtml(post.artist_page)}">Explore available works &rarr;</a>` : ''}
                        </div>
                    </article>`;
    }).join('');
}

// Builds the Spotlight page's full JSON-LD graph (CollectionPage > ItemList of
// Photographs, plus the shared Organization entity) from instagram-feed.json, in the
// same fixed order as the pre-rendered rail/grid HTML, so the structured data never
// drifts from what's actually visible on the page.
function buildSpotlightJsonLd(posts) {
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "@id": "https://elsewherecollective.nl/spotlight#webpage",
                "url": "https://elsewherecollective.nl/spotlight",
                "name": "Spotlights",
                "description": "A running edit of photographic work curated by elsewhere collective.",
                "isPartOf": { "@id": "https://elsewherecollective.nl/#website" },
                "about": { "@id": "https://elsewherecollective.nl/#organization" },
                "mainEntity": {
                    "@type": "ItemList",
                    "numberOfItems": posts.length,
                    "itemListElement": posts.map((post, i) => ({
                        "@type": "ListItem",
                        "position": i + 1,
                        "item": {
                            "@type": "Photograph",
                            "name": post.title || "Untitled",
                            "creator": {
                                "@type": "Person",
                                "name": post.artist || "Unknown"
                            },
                            "image": optimizedUrl(post.cloudinary_cropped_url, 1600) || post.image_url,
                            "description": post.caption || ""
                        }
                    }))
                }
            },
            {
                "@type": "Organization",
                "@id": "https://elsewherecollective.nl/#organization",
                "name": "elsewhere",
                "alternateName": "elsewhere collective",
                "url": "https://elsewherecollective.nl",
                "logo": "https://elsewherecollective.nl/favicon.png",
                "description": "elsewhere collective is a curated gallery championing emerging photographers alongside selected established voices, based in Amsterdam.",
                "address": {
                    "@type": "PostalAddress",
                    "addressLocality": "Amsterdam",
                    "addressCountry": "NL"
                },
                "sameAs": [
                    "https://www.instagram.com/elsewhere___collective"
                ]
            }
        ]
    };
}

function replaceJsonLdScript(html, scriptId, data) {
    const openTagPattern = new RegExp(`(<script type="application/ld\\+json" id="${scriptId}">)([\\s\\S]*?)(</script>)`);
    if (!openTagPattern.test(html)) {
        throw new Error(`Could not find <script id="${scriptId}"> for JSON-LD injection`);
    }
    const json = JSON.stringify(data, null, 4);
    return html.replace(openTagPattern, `$1\n    ${json}\n    $3`);
}

// Injects data into a static <script type="application/json" id="..."> anchor already
// present in the HTML (added by hand once), same pattern as replaceJsonLdScript but for
// plain JSON the client JS reads via JSON.parse(el.textContent) instead of JSON-LD.
function replaceJsonScript(html, scriptId, data) {
    const openTagPattern = new RegExp(`(<script type="application/json" id="${scriptId}">)([\\s\\S]*?)(</script>)`);
    if (!openTagPattern.test(html)) {
        throw new Error(`Could not find <script id="${scriptId}"> for JSON injection`);
    }
    const json = JSON.stringify(data);
    return html.replace(openTagPattern, `$1${json}$3`);
}

function replaceBlock(html, markerName, innerHtml) {
    const startTag = `<!-- GENERATED:${markerName}:START (generated by generate.js from instagram-feed.json — do not edit by hand) -->`;
    const endTag = `<!-- GENERATED:${markerName}:END -->`;
    const start = html.indexOf(startTag);
    const end = html.indexOf(endTag);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`Could not find GENERATED:${markerName} markers`);
    }
    const before = html.slice(0, start + startTag.length);
    const after = html.slice(end);
    return `${before}\n                ${innerHtml}\n                ${after}`;
}

// Only writes when content actually changed, so the file's mtime — which sitemap.xml's
// lastmod is derived from — reflects a genuine content change rather than bumping to
// "now" on every build regardless of whether anything differs.
function writeIfChanged(filePath, content) {
    const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (previous === content) return false;
    fs.writeFileSync(filePath, content);
    return true;
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Artwork pages: one page per work on sale, from works.json, at
// /works/<slug> (GitHub Pages serves works/<slug>.html there with a 200).
// works.json is the single source of truth for these pages; the page template,
// meta tags, JSON-LD and sitemap entry all come from it. Shared CSS/JS live in
// works/work.css and works/work.js. Paths are root-absolute (/images/...) since
// the pages sit one folder down.
// ---------------------------------------------------------------------------
const WORKS_PATH = path.join(ROOT, 'works.json');
const WORKS_DIR = path.join(ROOT, 'works');
const SITE = 'https://elsewherecollective.nl';
const DEFAULT_COLLECTING_NOTE = 'All works are offered in limited editions and accompanied by a certificate of authenticity. Professional framing is available on request.';

function readWorks() {
    if (!fs.existsSync(WORKS_PATH)) return { artists: {}, works: [] };
    const data = JSON.parse(fs.readFileSync(WORKS_PATH, 'utf8'));
    const seen = new Set();
    for (const work of data.works) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(work.slug)) throw new Error(`works.json: bad slug "${work.slug}"`);
        if (seen.has(work.slug)) throw new Error(`works.json: duplicate slug "${work.slug}"`);
        seen.add(work.slug);
        if (!data.artists[work.artist]) throw new Error(`works.json: unknown artist "${work.artist}" for ${work.slug}`);
        if (!work.sizes || !work.sizes.length) throw new Error(`works.json: ${work.slug} has no sizes`);
    }
    return data;
}

function workUrl(work) {
    return `${SITE}/works/${work.slug}`;
}

function formatPrice(price) {
    return '€' + Number(price).toLocaleString('en-GB');
}

function mailtoHref(subject, body) {
    return 'mailto:hello@elsewherecollective.nl?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
}

function enquiryBody(title, artistName, size) {
    return `Hi, I'd like to enquire about ${title}${size ? ` (${size})` : ''} by ${artistName}.\n\n` +
        'Please could you provide more details about availability, purchase, delivery and timings?\n\nThanks,';
}

// Facts first, as on the artist pages: who, what, size, edition, price, where
function workMetaDescription(work, artist) {
    const sizes = work.sizes;
    const lead = `${work.title}${work.year ? ` (${work.year})` : ''} by ${artist.name}: ${printPhrase(work)}`;
    let facts;
    if (sizes.length === 1) {
        const s = sizes[0];
        facts = `${lead}, ${s.dimensions}, ${s.edition.toLowerCase()}, ${formatPrice(s.price)}.`;
    } else {
        facts = `${lead} in ${sizes.length} sizes, from ${formatPrice(Math.min(...sizes.map(s => s.price)))}.`;
    }
    // The gallery and city when they fit within Google's ~155 characters
    const full = `${facts} From elsewhere, Amsterdam.`;
    return full.length <= 155 ? full : facts;
}

// "limited-edition Hahnemühle FineArt Baryta print", "limited-edition silver
// gelatin print on fibre-based paper", or just "limited-edition print"
function printPhrase(work) {
    const m = work.art_medium || work.medium;
    if (!m) return 'limited-edition print';
    const lower = /^[A-Z][a-z]/.test(m) && /print/i.test(m) ? m.charAt(0).toLowerCase() + m.slice(1) : m;
    return /print/i.test(m) ? `limited-edition ${lower}` : `limited-edition ${m} print`;
}

function workPageTitle(work, artist) {
    return `${work.title} by ${artist.name} | Limited Edition Photography Print | elsewhere`;
}

function buildWorkJsonLd(work, artist, artistKey, pageTitle, description) {
    const url = workUrl(work);
    const image = SITE + work.image.src;
    const personId = `${SITE}${artist.page}#person`;
    const sizes = work.sizes;
    const offerFor = s => ({
        '@type': 'Offer',
        ...(sizes.length > 1 ? { name: `${s.dimensions}, ${s.edition.charAt(0).toLowerCase()}${s.edition.slice(1)}` } : {}),
        price: String(s.price),
        priceCurrency: 'EUR',
        availability: `https://schema.org/${work.availability || 'InStock'}`,
        itemCondition: 'https://schema.org/NewCondition',
        url,
        seller: { '@id': `${SITE}/#organization` }
    });
    const single = sizes.length === 1 ? sizes[0] : null;
    const artwork = {
        '@type': ['VisualArtwork', 'Product'],
        '@id': `${url}#artwork`,
        name: work.title,
        description: work.description ||
            `${printPhrase(work).replace(/^l/, 'L')} of ${work.title} by ${artist.name}` +
            (single ? `, ${single.edition.charAt(0).toLowerCase()}${single.edition.slice(1)}.` : `, in ${sizes.length} sizes.`),
        image,
        url,
        brand: { '@type': 'Brand', name: artist.name },
        artform: 'Photograph',
        ...(work.art_medium || work.medium ? { artMedium: work.art_medium || work.medium } : {}),
        ...(work.year ? { dateCreated: work.year } : {}),
        ...(single && single.edition_size ? { artEdition: String(single.edition_size) } : {}),
        ...(single && single.width_cm ? { width: { '@type': 'Distance', name: `${single.width_cm} cm` } } : {}),
        ...(single && single.height_cm ? { height: { '@type': 'Distance', name: `${single.height_cm} cm` } } : {}),
        creator: { '@type': 'Person', '@id': personId, name: artist.name, url: SITE + artist.page },
        offers: single ? offerFor(single) : sizes.map(offerFor)
    };
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'ItemPage',
                '@id': `${url}#webpage`,
                url,
                name: pageTitle,
                description,
                isPartOf: { '@id': `${SITE}/#website` },
                primaryImageOfPage: image,
                mainEntity: { '@id': `${url}#artwork` },
                breadcrumb: { '@id': `${url}#breadcrumb` }
            },
            artwork,
            {
                '@type': 'BreadcrumbList',
                '@id': `${url}#breadcrumb`,
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
                    { '@type': 'ListItem', position: 2, name: 'Artists & Works', item: `${SITE}/artists` },
                    { '@type': 'ListItem', position: 3, name: artist.name, item: SITE + artist.page },
                    { '@type': 'ListItem', position: 4, name: work.title, item: url }
                ]
            },
            {
                '@type': 'Organization',
                '@id': `${SITE}/#organization`,
                name: 'elsewhere',
                alternateName: 'elsewhere collective',
                url: SITE,
                sameAs: ['https://www.instagram.com/elsewhere___collective']
            }
        ]
    };
}

function renderWorkPage(work, artist, artistKey) {
    const e = escapeHtml;
    const url = workUrl(work);
    const pageTitle = workPageTitle(work, artist);
    const description = workMetaDescription(work, artist);
    const jsonLd = JSON.stringify(buildWorkJsonLd(work, artist, artistKey, pageTitle, description), null, 4)
        .replace(/</g, '\\u003c');
    const img = work.image;
    const srcset = img.webp ? img.webp_widths.map(w => `${img.webp}-${w}.webp ${w}w`).join(', ') : '';
    const sizes = work.sizes;
    const single = sizes.length === 1 ? sizes[0] : null;

    // Same format as the artist page cards: medium, then printed year and size, then edition
    const printedLine = [work.printed ? `Printed ${e(work.printed)}` : '', single ? e(single.dimensions) : '']
        .filter(Boolean).join(' &middot; ');
    const metaLines = [work.medium ? e(work.medium) : '', printedLine, single ? e(single.edition) : ''].filter(Boolean).join('<br>');

    const sizeListHtml = single ? '' : `
                <ul class="size-list" aria-label="Sizes and prices">
${sizes.map(s => `                    <li class="size-row">
                        <span class="size-dim">${e(s.dimensions)}</span>
                        <span class="size-edition">${e(s.edition)}</span>
                        <span class="size-price">${e(formatPrice(s.price))}</span>
                        <a href="${e(mailtoHref(`Enquiry - ${work.title}, ${s.dimensions}`, enquiryBody(work.title, artist.name, s.dimensions)))}" class="size-enquire">Enquire</a>
                    </li>`).join('\n')}
                </ul>`;

    const priceAndEnquire = single ? `
                <p class="work-price">${e(formatPrice(single.price))}</p>
                <a href="${e(mailtoHref(`Enquiry - ${work.title}`, enquiryBody(work.title, artist.name)))}" class="enquire-btn">Enquire</a>` : '';

    const wallHtml = work.wall ? `
                    <img id="wallImage" data-src="${e(work.wall.src)}" alt="${e(work.title)}, by ${e(artist.name)}, shown framed on a wall" width="${work.wall.width}" height="${work.wall.height}" decoding="async" hidden>` : '';
    const toggleHtml = work.wall ? `
                <div class="view-toggle" id="viewToggle" role="group" aria-label="View">
                    <button type="button" data-view="print" aria-pressed="true">Print</button>
                    <button type="button" data-view="wall" aria-pressed="false">On wall</button>
                </div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Generated by generate.js from works.json; do not edit by hand -->
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>${e(pageTitle)}</title>
<meta name="description" content="${e(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${e(url)}">

<meta property="og:type" content="website">
<meta property="og:url" content="${e(url)}">
<meta property="og:title" content="${e(pageTitle)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:image" content="${e(SITE + img.src)}">
<meta property="og:image:width" content="${img.width}">
<meta property="og:image:height" content="${img.height}">
<meta property="og:image:alt" content="${e(work.alt)}">
<meta property="og:site_name" content="elsewhere collective">

<meta property="twitter:card" content="summary_large_image">
<meta property="twitter:url" content="${e(url)}">
<meta property="twitter:title" content="${e(pageTitle)}">
<meta property="twitter:description" content="${e(description)}">
<meta property="twitter:image" content="${e(SITE + img.src)}">
<meta property="twitter:image:alt" content="${e(work.alt)}">

<script type="application/ld+json">
${jsonLd}
</script>

<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<link rel="preload" href="/fonts/SuisseIntl-Light.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/SuisseIntl-Regular.woff2" as="font" type="font/woff2" crossorigin>

<!-- Google Analytics, only with consent (same as every page) -->
<script>
    if (localStorage.getItem('analyticsConsent') === 'true') {
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-NZVK7P7J3D');
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=G-NZVK7P7J3D';
        document.head.appendChild(script);
    }
</script>

<link rel="stylesheet" href="/works/work.css">
<link rel="stylesheet" href="/site-nav.css">
<script src="/site-nav.js" defer></script>
<link rel="stylesheet" id="silktide-consent-manager-css" href="/cookie-banner/silktide-consent-manager.css" media="print" onload="this.media='all'">
<script src="/cookie-banner/silktide-consent-manager.js" defer></script>
<!-- No newsletter pop-up on artwork pages: the page is about the work -->
<script src="/works/work.js" defer></script>
</head>
<body>

<div class="enquiry" id="enquiry" role="dialog" aria-modal="true" aria-labelledby="enquiryTitle" aria-hidden="true">
    <div class="enquiry-panel">
        <button type="button" class="enquiry-close" aria-label="Close">&times;</button>
        <p class="enquiry-kicker">Enquire</p>
        <div class="enquiry-work">
            <img id="enquiryImg" src="" alt="">
            <div>
                <h2 class="enquiry-title" id="enquiryTitle"></h2>
                <p class="enquiry-spec" id="enquirySpec"></p>
            </div>
        </div>

        <form id="enquiryForm" novalidate>
            <!-- Web3Forms emails each enquiry to hello@elsewherecollective.nl; the key
                 only allows sending to that inbox, so it's safe to publish -->
            <input type="hidden" name="access_key" value="3397200b-dd79-4a9e-808e-6523df8bfe49">
            <input type="hidden" name="from_name" value="elsewhere collective website">
            <input type="hidden" name="subject" id="enquirySubject">
            <input type="hidden" name="artist" id="enquiryArtist">
            <input type="hidden" name="artwork" id="enquiryArtwork">
            <input type="hidden" name="size" id="enquirySize">
            <input type="hidden" name="price" id="enquiryPrice">
            <input type="checkbox" name="botcheck" class="enquiry-bot" tabindex="-1" autocomplete="off">

            <label class="enquiry-field"><span>Name</span>
                <input type="text" name="name" autocomplete="name" required></label>
            <label class="enquiry-field"><span>Email</span>
                <input type="email" name="email" autocomplete="email" inputmode="email" required></label>
            <label class="enquiry-field"><span>Message</span>
                <span class="enquiry-hint">Interested in more than one work? Let us know below.</span>
                <textarea name="message" rows="6"></textarea></label>

            <p class="enquiry-error" id="enquiryError" role="alert" hidden></p>
            <button type="submit" class="enquiry-submit">Send enquiry</button>
            <p class="enquiry-small">We&rsquo;ll reply by email, usually within two working days. Your details are only used to answer this enquiry. Prefer email? <a href="mailto:hello@elsewherecollective.nl">hello@elsewherecollective.nl</a></p>
        </form>

        <div class="enquiry-done" aria-live="polite">
            <h2>Thank you.</h2>
            <p id="enquiryDoneText"></p>
            <button type="button" class="enquiry-back">Back to the work</button>
        </div>
    </div>
</div>

<div class="cursor-dot" id="cursorDot"></div>
<header class="header">
    <div class="header-container">
        <a href="/" class="logo">elsewhere</a>
        <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="siteNav">Menu</button>
        <nav id="siteNav" aria-label="Main">
            <ul class="nav-menu">
                <li><a href="/about">About</a></li>
                <li><a href="/artists">Artists &amp; Works</a></li>
                <li><a href="/spotlight">Spotlights</a></li>
                <li><a href="/art-sourcing">Art Sourcing</a></li>
            </ul>
        </nav>
    </div>
</header>

<main class="page">
    <a href="${e(artist.page)}#works" class="back-link">&larr; ${e(artist.name)}</a>

    <article class="work-view" data-artist="${e(artist.name)}" data-title="${e(work.title)}">
        <div class="work-image-col">
            <div class="work-image-inner">
            <figure class="work-figure lightbox-trigger" data-full="${e(img.src)}"${work.wall ? ` data-wall="${e(work.wall.src)}"` : ''} data-title="${e(work.title)}" tabindex="0" role="button" aria-label="View ${e(work.title)} fullscreen">
                ${srcset ? `<picture><source type="image/webp" srcset="${e(srcset)}" sizes="(max-width: 700px) calc(100vw - 48px), (max-width: 900px) calc(100vw - 96px), 66vw">` : ''}<img id="workImage" src="${e(img.src)}" alt="${e(work.alt)}" width="${img.width}" height="${img.height}" fetchpriority="high" decoding="async">${srcset ? '</picture>' : ''}${wallHtml}
            </figure>${toggleHtml}
            </div>
        </div>

        <div class="work-details">
            <p class="work-artist"><a href="${e(artist.page)}">${e(artist.name)}</a></p>
            <h1 class="work-title">${e(work.title)}${work.year ? ` <span class="work-year">(${e(work.year)})</span>` : ''}</h1>
${work.description ? `            <p class="work-description">${e(work.description)}</p>\n` : ''}${metaLines ? `            <p class="work-meta">${metaLines}</p>` : ''}${sizeListHtml}${priceAndEnquire}
            <p class="work-note">${e(artist.collecting_note || DEFAULT_COLLECTING_NOTE)}</p>
        </div>
    </article>
</main>

<div class="lightbox" id="lightbox">
    <button class="lightbox-close" id="lightboxClose" aria-label="Close">&times;</button>
    <button class="lightbox-nav lightbox-prev" id="lightboxPrev" aria-label="Previous work">&#8249;</button>
    <button class="lightbox-nav lightbox-next" id="lightboxNext" aria-label="Next work">&#8250;</button>
    <div class="lightbox-stage">
        <img id="lightboxImage" src="" alt="">
        <div class="lightbox-meta">
            <p class="lightbox-caption" id="lightboxCaption"></p>
            <div class="lightbox-view-toggle" id="lightboxViewToggle" role="group" aria-label="View" hidden>
                <button type="button" data-view="print" aria-pressed="true">Print</button>
                <button type="button" data-view="wall" aria-pressed="false">On wall</button>
            </div>
        </div>
    </div>
</div>

</body>
</html>
`;
}

// Writes works/<slug>.html for every work; returns the URL → file map for the sitemap
function writeWorkPages() {
    const data = readWorks();
    const pageFileByUrl = {};
    if (!data.works.length) return pageFileByUrl;
    if (!fs.existsSync(WORKS_DIR)) fs.mkdirSync(WORKS_DIR);
    for (const work of data.works) {
        const artist = data.artists[work.artist];
        const file = path.join('works', `${work.slug}.html`);
        const changed = writeIfChanged(path.join(ROOT, file), renderWorkPage(work, artist, work.artist));
        pageFileByUrl[workUrl(work)] = file;
        console.log(`  ${changed ? 'wrote' : 'unchanged'} ${file}`);
    }
    return pageFileByUrl;
}

// Adds a sitemap <url> block for any page not yet listed (artwork pages)
function ensureSitemapEntries(sitemapXml, urls) {
    for (const url of urls) {
        if (sitemapXml.includes(`<loc>${url}</loc>`)) continue;
        const block = `  <url>\n    <loc>${url}</loc>\n    <lastmod></lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
        sitemapXml = sitemapXml.replace('</urlset>', block + '</urlset>');
    }
    return sitemapXml;
}

// Rewrites sitemap.xml's <lastmod> for the site's canonical pages using each page's
// actual on-disk file mtime — index.html/spotlight.html reflect the last generate.js
// run that changed their content; about.html/cookie-policy.html/mitsutaka.html reflect the last
// manual edit. Preserves the sitemap's existing <changefreq>/<priority> and URL set as-is,
// adding an entry for each artwork page (workPageFileByUrl) that isn't listed yet.
function updateSitemap(workPageFileByUrl = {}) {
    const sitemapPath = path.join(ROOT, 'sitemap.xml');
    let sitemapXml = ensureSitemapEntries(fs.readFileSync(sitemapPath, 'utf8'), Object.keys(workPageFileByUrl));

    const pageFileByUrl = {
        ...workPageFileByUrl,
        'https://elsewherecollective.nl/': 'index.html',
        'https://elsewherecollective.nl/about': 'about.html',
        'https://elsewherecollective.nl/art-sourcing': 'art-sourcing.html',
        'https://elsewherecollective.nl/spotlight': 'spotlight.html',
        'https://elsewherecollective.nl/cookie-policy': 'cookie-policy.html',
        'https://elsewherecollective.nl/mitsutaka': 'mitsutaka.html',
        'https://elsewherecollective.nl/artists': 'artists.html',
        'https://elsewherecollective.nl/andrea': 'andrea.html',
        'https://elsewherecollective.nl/nad': 'nad.html',
        'https://elsewherecollective.nl/aleksey': 'aleksey.html',
        'https://elsewherecollective.nl/jesula': 'jesula.html'
    };

    for (const [url, fileName] of Object.entries(pageFileByUrl)) {
        const filePath = path.join(ROOT, fileName);
        const mtime = isoDate(fs.statSync(filePath).mtime);
        const urlBlockPattern = new RegExp(
            `(<loc>${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>\\s*<lastmod>)[^<]*(</lastmod>)`
        );
        if (!urlBlockPattern.test(sitemapXml)) {
            throw new Error(`Could not find sitemap <url> entry for ${url}`);
        }
        sitemapXml = sitemapXml.replace(urlBlockPattern, `$1${mtime}$2`);
    }

    writeIfChanged(sitemapPath, sitemapXml);
}

async function main() {
    // `node generate.js --works`: only the artwork pages and the sitemap (no
    // Cloudinary requests, no homepage reshuffle)
    if (process.argv.includes('--works')) {
        console.log('generate.js --works: artwork pages from works.json');
        updateSitemap(writeWorkPages());
        console.log('  updated sitemap.xml');
        console.log('done');
        return;
    }

    const feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8'));
    const allPosts = feed.posts || [];

    console.log(`generate.js: read instagram-feed.json (${allPosts.length} posts)`);
    console.log('  fetching image dimensions for grid packing...');
    const aspectRatioByPostId = {};
    await Promise.all(allPosts.map(async post => {
        aspectRatioByPostId[post.id] = await fetchAspectRatio(post.cloudinary_cropped_url);
    }));
    const ratioOf = post => aspectRatioByPostId[post.id] || 1;

    // index.html: homepage preview grid — 12 posts with a non-empty caption: the
    // HOME_NEWEST_COUNT newest (feed is oldest-first, so the last ones), plus a
    // rotating pick of older ones, then shuffled into display order. Both the pick
    // and the order are seeded by today's date (see homeSeedKey), so re-running on
    // the same day is a no-op via writeIfChanged, and a new day rotates both.
    // #gridData is derived from this same shuffled array, so the client's
    // lightbox/resize-repack stays in sync with what's actually rendered.
    const HOME_POST_COUNT = 12;
    const HOME_NEWEST_COUNT = 4;
    const indexPath = path.join(ROOT, 'index.html');
    let indexHtml = fs.readFileSync(indexPath, 'utf8');
    const captionedPosts = allPosts.filter(p => p.caption && p.caption.trim() !== '');
    const newestPosts = captionedPosts.slice(-HOME_NEWEST_COUNT);
    const olderPosts = captionedPosts.slice(0, -HOME_NEWEST_COUNT);
    const rotatingPosts = seededShuffle(olderPosts, 'home-pick:' + isoDate(new Date()))
        .slice(0, HOME_POST_COUNT - newestPosts.length);
    const homePostsSelected = newestPosts.concat(rotatingPosts);
    // Seed includes today's date (not just post ids) so re-running generate.js on a
    // different day gives a visibly different homepage order even when the post set
    // hasn't changed — still deterministic for any given day (re-running today is a
    // no-op via writeIfChanged), just not frozen indefinitely.
    const homeSeedKey = 'home-grid:' + isoDate(new Date()) + ':' + homePostsSelected.map(p => p.id).join(',');
    const homePosts = seededShuffle(homePostsSelected, homeSeedKey);
    const homeAspectRatios = homePosts.map(ratioOf);
    const homeDimensions = homeAspectRatios.map(ratio => dimensionsForRatio(ratio, 500));

    const homeGridHtml = renderGridHtml(homePosts, homeAspectRatios, homeDimensions, { imageWidth: 500, mobileBreakpoint: 768 });
    indexHtml = replaceBlock(indexHtml, 'GRID', homeGridHtml);

    const gridData = homePosts.map((post, i) => {
        const dims = homeDimensions[i];
        return {
            title: post.title || '',
            artist: post.artist || '',
            caption: post.caption || '',
            cloudinary_cropped_url: post.cloudinary_cropped_url,
            image_url: post.image_url,
            width: dims.width,
            height: dims.height,
            // Represented artists: the lightbox links to their page, as on Spotlights
            ...(post.artist_page ? { artist_page: post.artist_page } : {})
        };
    });
    indexHtml = replaceJsonScript(indexHtml, 'gridData', gridData);

    const indexChanged = writeIfChanged(indexPath, indexHtml);

    // spotlight.html: both the grid and the editorial rail are shown in their own
    // seeded shuffle — stable across builds, and deliberately different from each
    // other so the two views don't feel like the same list twice. The JSON-LD
    // ItemList intentionally stays in instagram-feed.json's own order regardless
    // (a shuffled display order isn't meaningful for structured data to "match").
    // Each view's data-index is remapped back to allPosts' order, since that's the
    // order the client gets from fetching instagram-feed.json fresh.
    const spotlightPath = path.join(ROOT, 'spotlight.html');
    let spotlightHtml = fs.readFileSync(spotlightPath, 'utf8');
    const originalIndexOf = post => allPosts.indexOf(post);

    const railSeedKey = 'rail:' + allPosts.map(p => p.id).join(',');
    const railPosts = seededShuffle(allPosts, railSeedKey);
    // Ids follow feed order (not the shuffle), so an artist's first post keeps its id
    const railHtml = renderRailHtml(railPosts, originalIndexOf, entryIds(allPosts), post => dimensionsForRatio(ratioOf(post), 800));

    const gridSeedKey = 'grid:' + allPosts.map(p => p.id).join(',');
    const gridPosts = seededShuffle(allPosts, gridSeedKey);
    const gridAspectRatios = gridPosts.map(ratioOf);
    const gridDimensions = gridAspectRatios.map(ratio => dimensionsForRatio(ratio, 500));
    const gridHtml = renderGridHtml(gridPosts, gridAspectRatios, gridDimensions, { imageWidth: 500, mobileBreakpoint: 768 }, originalIndexOf);

    spotlightHtml = replaceBlock(spotlightHtml, 'RAIL', railHtml);
    spotlightHtml = replaceBlock(spotlightHtml, 'GRID', gridHtml);
    const spotlightJsonLd = buildSpotlightJsonLd(allPosts);
    spotlightHtml = replaceJsonLdScript(spotlightHtml, 'spotlight-jsonld', spotlightJsonLd);
    const spotlightChanged = writeIfChanged(spotlightPath, spotlightHtml);

    const workPageFileByUrl = writeWorkPages();
    updateSitemap(workPageFileByUrl);

    console.log(`  updated index.html (${homePosts.length} posts)${indexChanged ? '' : ' — unchanged'}`);
    console.log(`  updated spotlight.html (${allPosts.length} posts, including JSON-LD ItemList)${spotlightChanged ? '' : ' — unchanged'}`);
    console.log('  updated sitemap.xml lastmod dates');
    console.log('done');
}

main().catch(err => {
    console.error('generate.js failed:', err);
    process.exit(1);
});
