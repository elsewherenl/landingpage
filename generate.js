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

// Alt text convention: "[Title] — photograph by [Artist]", falling back to
// "Photograph by [Artist]" when the title is missing/empty (null, "", whitespace-only).
// A literal "Untitled" title is treated as a deliberate, real title — not a gap — so it
// is not caught by this fallback. Every post in instagram-feed.json has a non-empty
// artist, so no artist-side fallback is needed here.
function altText(post) {
    const title = (post.title || '').trim();
    const artist = (post.artist || '').trim();
    return title ? `${title} — photograph by ${artist}` : `Photograph by ${artist}`;
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
// to read its aspect ratio, mirroring what probeAspectRatio() does client-side with a
// full <img> load. f_auto is intentionally omitted here (kept only in the real <img>
// src) so the probe always gets JPEG/PNG bytes our tiny parser understands.
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

// Mirrors packIntoColumns() in the client JS: shortest-column masonry using each
// post's aspect ratio, so the build-time pack matches what the client renders on
// first paint (before any resize-triggered re-pack runs).
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

function renderGridHtml(posts, aspectRatios, { imageWidth, columnCount }) {
    const items = posts.map((post, i) => ({
        post,
        i,
        aspectRatio: aspectRatios[i] || 1
    }));
    const columns = packIntoColumns(items, columnCount);

    return columns.map(col => `
                <div class="grid-col">
                    ${col.map(({ post, i }) => `
                        <article class="grid-item" data-index="${i}">
                            <figure>
                                <img src="${escapeHtml(optimizedUrl(post.cloudinary_cropped_url, imageWidth) || post.image_url)}" alt="${escapeHtml(altText(post))}" loading="${i < 4 ? 'eager' : 'lazy'}">
                                <figcaption class="grid-item-label">
                                    <h2 class="t">${escapeHtml(post.title || 'Untitled')}</h2>
                                    <p class="a">${escapeHtml(post.artist || '')}</p>
                                </figcaption>
                            </figure>
                        </article>
                    `).join('')}
                </div>`).join('');
}

function renderRailHtml(posts) {
    return posts.map((post, i) => `
                    <article class="entry ${i % 2 === 1 ? 'is-reversed' : ''}">
                        <figure class="entry-figure" data-index="${i}">
                            <img src="${escapeHtml(optimizedUrl(post.cloudinary_cropped_url, 800) || post.image_url)}" alt="${escapeHtml(altText(post))}" loading="lazy">
                        </figure>
                        <div class="entry-meta">
                            <h2 class="entry-title">${escapeHtml(post.title || 'Untitled')}</h2>
                            <p class="entry-artist">${escapeHtml(post.artist || '')}</p>
                            <p class="entry-caption">${escapeHtml(post.caption || '')}</p>
                        </div>
                    </article>`).join('');
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
                "name": "Spotlight",
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
                "name": "elsewhere collective",
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

// Rewrites sitemap.xml's <lastmod> for the site's canonical pages using each page's
// actual on-disk file mtime — index.html/spotlight.html reflect the last generate.js
// run that changed their content; about.html/cookie-policy.html reflect the last manual
// edit. Preserves the sitemap's existing <changefreq>/<priority> and URL set as-is.
function updateSitemap() {
    const sitemapPath = path.join(ROOT, 'sitemap.xml');
    let sitemapXml = fs.readFileSync(sitemapPath, 'utf8');

    const pageFileByUrl = {
        'https://elsewherecollective.nl/': 'index.html',
        'https://elsewherecollective.nl/about': 'about.html',
        'https://elsewherecollective.nl/spotlight': 'spotlight.html',
        'https://elsewherecollective.nl/cookie-policy': 'cookie-policy.html'
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
    const feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8'));
    const allPosts = feed.posts || [];

    console.log(`generate.js: read instagram-feed.json (${allPosts.length} posts)`);
    console.log('  fetching image dimensions for grid packing...');
    const aspectRatioByPostId = {};
    await Promise.all(allPosts.map(async post => {
        aspectRatioByPostId[post.id] = await fetchAspectRatio(post.cloudinary_cropped_url);
    }));

    // index.html: homepage preview grid — first 12 posts with a non-empty caption,
    // matching the client JS's filter (postsWithCaptions). Fixed order (no shuffle)
    // so the build is deterministic; the client JS still shuffles its own re-fetch
    // for the lightbox navigation order, same as before.
    const indexPath = path.join(ROOT, 'index.html');
    let indexHtml = fs.readFileSync(indexPath, 'utf8');
    const homePosts = allPosts.filter(p => p.caption && p.caption.trim() !== '').slice(0, 12);
    const homeAspectRatios = homePosts.map(p => aspectRatioByPostId[p.id]);
    const homeGridHtml = renderGridHtml(homePosts, homeAspectRatios, { imageWidth: 500, columnCount: 4 });
    indexHtml = replaceBlock(indexHtml, 'GRID', homeGridHtml);
    const indexChanged = writeIfChanged(indexPath, indexHtml);

    // spotlight.html: full rail (editorial) + grid views, all posts, JSON order.
    const spotlightPath = path.join(ROOT, 'spotlight.html');
    let spotlightHtml = fs.readFileSync(spotlightPath, 'utf8');
    const allAspectRatios = allPosts.map(p => aspectRatioByPostId[p.id]);
    const railHtml = renderRailHtml(allPosts);
    const gridHtml = renderGridHtml(allPosts, allAspectRatios, { imageWidth: 500, columnCount: 4 });
    spotlightHtml = replaceBlock(spotlightHtml, 'RAIL', railHtml);
    spotlightHtml = replaceBlock(spotlightHtml, 'GRID', gridHtml);
    const spotlightJsonLd = buildSpotlightJsonLd(allPosts);
    spotlightHtml = replaceJsonLdScript(spotlightHtml, 'spotlight-jsonld', spotlightJsonLd);
    const spotlightChanged = writeIfChanged(spotlightPath, spotlightHtml);

    updateSitemap();

    console.log(`  updated index.html (${homePosts.length} posts)${indexChanged ? '' : ' — unchanged'}`);
    console.log(`  updated spotlight.html (${allPosts.length} posts, including JSON-LD ItemList)${spotlightChanged ? '' : ' — unchanged'}`);
    console.log('  updated sitemap.xml lastmod dates');
    console.log('done');
}

main().catch(err => {
    console.error('generate.js failed:', err);
    process.exit(1);
});
