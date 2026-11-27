/*
 * Shared script for every artwork page (works/<slug>.html, written by
 * generate.js from works.json). Same behaviour as the artist pages, in one
 * cached file instead of inline copies: cookie banner settings, the custom
 * cursor, GA events, the enquiry form and the Print / On wall switch.
 * The page's <article class="work-view"> carries data-artist and data-title.
 */

// Analytics events. dataLayer only exists once the visitor has accepted
// analytics cookies (see the consent block in <head>), so nothing is sent
// without consent. Pushes an Arguments object, same as gtag() does.
function trackEvent(name, params) {
    if (!window.dataLayer) return;
    (function () { window.dataLayer.push(arguments); })('event', name, Object.assign({ transport_type: 'beacon' }, params));
}

// ---------- Cookie banner settings (same as the artist pages) ----------
document.addEventListener('DOMContentLoaded', function () {
    function loadAnalytics() {
        if (!window.dataLayer) {
            window.dataLayer = window.dataLayer || [];
            function gtag() { dataLayer.push(arguments); }
            gtag('js', new Date());
            gtag('config', 'G-NZVK7P7J3D');
            var script = document.createElement('script');
            script.async = true;
            script.src = 'https://www.googletagmanager.com/gtag/js?id=G-NZVK7P7J3D';
            document.head.appendChild(script);
        }
    }

    if (typeof silktideCookieBannerManager !== 'undefined') {
        silktideCookieBannerManager.updateCookieBannerConfig({
            background: { showBackground: true },
            cookieIcon: { position: 'bottomRight' },
            cookieTypes: [
                {
                    id: 'necessary',
                    name: 'Necessary',
                    description: '<p>These cookies are necessary for the website to function properly and cannot be switched off. They help with things like logging in and setting your privacy preferences.</p>',
                    required: true,
                    onAccept: function () {}
                },
                {
                    id: 'analytics',
                    name: 'Analytics',
                    description: '<p>These cookies help us improve the site by tracking which pages are most popular and how visitors move around the site.</p>',
                    required: false,
                    onAccept: function () {
                        localStorage.setItem('analyticsConsent', 'true');
                        if (typeof gtag !== 'undefined') {
                            gtag('consent', 'update', { analytics_storage: 'granted' });
                            dataLayer.push({ event: 'consent_accepted_analytics' });
                        }
                        loadAnalytics();
                    },
                    onReject: function () {
                        localStorage.setItem('analyticsConsent', 'false');
                        if (typeof gtag !== 'undefined') {
                            gtag('consent', 'update', { analytics_storage: 'denied' });
                        }
                    }
                }
            ],
            text: {
                banner: {
                    description: '<p>We use cookies to analyse site usage and improve your experience. <a href="https://elsewherecollective.nl/cookie-policy" target="_blank">Cookie Policy.</a></p>',
                    acceptAllButtonText: 'OK',
                    acceptAllButtonAccessibleLabel: 'OK, accept all cookies',
                    rejectNonEssentialButtonText: 'Essential Only',
                    rejectNonEssentialButtonAccessibleLabel: 'Essential only: reject optional cookies',
                    preferencesButtonText: 'Settings',
                    preferencesButtonAccessibleLabel: 'Cookie settings'
                },
                preferences: {
                    title: 'Cookie Settings',
                    description: "<p>Choose which cookies you'd like to enable. Essential cookies are required for the site to function and cannot be disabled.</p>",
                    creditLinkText: '',
                    creditLinkAccessibleLabel: ''
                }
            },
            position: { banner: 'bottomRight' }
        });
    } else {
        // Fallback banner if Silktide didn't load
        var cookieConsent = localStorage.getItem('cookieConsent');
        if (!cookieConsent) {
            var banner = document.createElement('div');
            banner.className = 'cookie-banner show';
            banner.innerHTML =
                '<div class="cookie-content">' +
                    '<div class="cookie-text">We use cookies to analyse site usage and improve your experience.' +
                        '<a href="https://elsewherecollective.nl/cookie-policy" target="_blank" class="cookie-link">Cookie Policy</a></div>' +
                    '<div class="cookie-actions">' +
                        '<button class="cookie-button" id="acceptCookies">Accept All</button>' +
                        '<span class="essential-link" id="essentialOnly">Essential Only</span>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(banner);
            document.getElementById('acceptCookies').onclick = function () {
                localStorage.setItem('cookieConsent', 'accepted');
                localStorage.setItem('analyticsConsent', 'true');
                banner.remove();
                loadAnalytics();
            };
            document.getElementById('essentialOnly').onclick = function () {
                localStorage.setItem('cookieConsent', 'essential');
                localStorage.setItem('analyticsConsent', 'false');
                banner.remove();
            };
        } else if (cookieConsent === 'accepted') {
            loadAnalytics();
        }
    }
});

// ---------- Custom cursor dot (as on every page) ----------
(function () {
    var dot = document.getElementById('cursorDot');
    if (!dot || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var EASE = 0.6;
    var tx = 0, ty = 0, x = 0, y = 0, last = 0, running = false, seen = false;
    function tick(now) {
        var t = 1 - Math.pow(1 - EASE, Math.min(now - last, 64) / (1000 / 60));
        last = now;
        x += (tx - x) * t;
        y += (ty - y) * t;
        if (Math.abs(tx - x) < 0.1 && Math.abs(ty - y) < 0.1) {
            x = tx; y = ty; running = false;
        } else {
            requestAnimationFrame(tick);
        }
        dot.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
    }
    window.addEventListener('mousemove', function (e) {
        tx = e.clientX; ty = e.clientY;
        if (!seen) { seen = true; x = tx; y = ty; }
        if (dot.style.opacity) dot.style.opacity = '';
        if (running) return;
        running = true;
        last = performance.now();
        requestAnimationFrame(tick);
    }, { passive: true });
    document.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget) dot.style.opacity = '0';
    });
    document.addEventListener('mouseover', function (e) {
        var interactive = e.target.closest('a, button, [role="button"], input, textarea, select, label[for], summary');
        dot.classList.toggle('is-hovering', !!interactive);
    });
})();

// ---------- Print / On wall ----------
(function () {
    var toggle = document.getElementById('viewToggle');
    if (!toggle) return;
    var print = document.getElementById('workImage');
    var wall = document.getElementById('wallImage');
    var article = document.querySelector('.work-view');
    toggle.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-view]');
        if (!btn) return;
        var showWall = btn.getAttribute('data-view') === 'wall';
        // The wall photo only downloads the first time it's asked for
        if (showWall && !wall.getAttribute('src')) wall.setAttribute('src', wall.getAttribute('data-src'));
        print.hidden = showWall;
        wall.hidden = !showWall;
        toggle.querySelectorAll('button').forEach(function (b) {
            b.setAttribute('aria-pressed', String(b === btn));
        });
        if (showWall) {
            trackEvent('view_on_wall', { artwork_title: article.getAttribute('data-title'), source: 'work_page' });
        }
    });
})();

// ---------- Enquiry form (same behaviour as the artist pages) ----------
// Enquire opens the form; the link's mailto stays as the fallback.
(function () {
    var box = document.getElementById('enquiry');
    var form = document.getElementById('enquiryForm');
    var article = document.querySelector('.work-view');
    if (!box || !form || !article) return;
    var submit = form.querySelector('.enquiry-submit');
    var error = document.getElementById('enquiryError');
    var artist = article.getAttribute('data-artist');
    var title = article.getAttribute('data-title');
    var lastLink = null;
    var current = {};

    function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
    function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

    function open(link) {
        var row = link.closest('.size-row');
        var size, price, edition;
        if (row) {
            size = text(row.querySelector('.size-dim'));
            price = text(row.querySelector('.size-price'));
            edition = text(row.querySelector('.size-edition'));
        } else {
            var meta = text(article.querySelector('.work-meta'));
            size = (meta.match(/\d+(?:[.,]\d+)?\s*×\s*\d+(?:[.,]\d+)?\s*cm/) || [''])[0];
            price = text(article.querySelector('.work-price'));
            edition = (meta.match(/Edition of.*$/) || [''])[0];
        }
        var img = document.getElementById('workImage');
        document.getElementById('enquiryImg').src = img ? (img.currentSrc || img.src) : '';
        document.getElementById('enquiryTitle').textContent = title;
        document.getElementById('enquirySpec').innerHTML = esc(artist) +
            (size ? ' &middot; <strong>' + esc(size) + '</strong>' : '') +
            (price ? ' &middot; ' + esc(price) : '') +
            (edition ? '<br>' + esc(edition) : '');
        document.getElementById('enquirySubject').value = 'Enquiry - ' + title + (size ? ', ' + size : '');
        document.getElementById('enquiryArtist').value = artist;
        document.getElementById('enquiryArtwork').value = title;
        document.getElementById('enquirySize').value = size;
        document.getElementById('enquiryPrice').value = price;
        form.elements.message.value = "Hi, I'd like to enquire about " + title +
            (size ? ' (' + size + ')' : '') + ' by ' + artist + '.\n\n' +
            'Please could you provide more details about availability, purchase, delivery and timings?';
        current = { size: size };
        error.hidden = true;
        box.classList.remove('is-sent');
        box.classList.add('is-open');
        box.setAttribute('aria-hidden', 'false');
        document.body.classList.add('enquiry-open');
        lastLink = link;
        trackEvent('enquire_click', Object.assign({ artist_name: artist, artwork_title: title, source: 'work_page' },
            row ? { print_size: size } : {}));
        setTimeout(function () { form.elements.name.focus({ preventScroll: true }); }, 50);
    }

    function close() {
        box.classList.remove('is-open');
        box.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('enquiry-open');
        if (lastLink) lastLink.focus({ preventScroll: true });
    }

    document.querySelectorAll('.enquire-btn, .size-enquire').forEach(function (link) {
        link.addEventListener('click', function (e) { e.preventDefault(); open(link); });
    });
    box.querySelector('.enquiry-close').addEventListener('click', close);
    box.querySelector('.enquiry-back').addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && box.classList.contains('is-open')) close();
    });

    function sent() {
        var first = form.elements.name.value.trim().split(' ')[0];
        document.getElementById('enquiryDoneText').textContent =
            'We’ve received your enquiry' + (first ? ', ' + first : '') + ', for ' + title +
            (current.size ? ' (' + current.size + ')' : '') +
            '. We’ll reply to ' + form.elements.email.value.trim() + ' shortly.';
        box.classList.add('is-sent');
        box.querySelector('.enquiry-panel').scrollTop = 0;
        trackEvent('enquiry_sent', { artist_name: artist, artwork_title: title, print_size: current.size, source: 'work_page' });
        form.reset();
    }

    function failed() {
        var body = form.elements.message.value.trim() + '\n\n' + form.elements.name.value.trim();
        var href = 'mailto:hello@elsewherecollective.nl?subject=' +
            encodeURIComponent(document.getElementById('enquirySubject').value) +
            '&body=' + encodeURIComponent(body);
        error.innerHTML = '<strong>Sorry, your enquiry didn’t send.</strong><br>' +
            '<a href="' + href + '">Send it from your email app</a> instead (your message is copied over), ' +
            'or write to us at hello@elsewherecollective.nl.';
        error.hidden = false;
        error.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.reportValidity()) return;
        error.hidden = true;
        submit.disabled = true;
        submit.textContent = 'Sending…';
        fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: new FormData(form)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) { data.success ? sent() : failed(); })
            .catch(failed)
            .then(function () {
                submit.disabled = false;
                submit.textContent = 'Send enquiry';
            });
    });
})();

// ---------- Fullscreen view (the artist pages' lightbox, one work, no paging) ----------
// Click or Enter on the image opens it, in whichever view (Print / On wall) the
// page is showing. Desktop: click the image to zoom, the pointer pans, click
// again to zoom out; trackpad pinch zooms, two-finger scroll pans. Touch: pinch
// or double-tap to zoom, drag to pan. Esc zooms out, then closes.
(function () {
    var lightbox = document.getElementById('lightbox');
    var trigger = document.querySelector('.lightbox-trigger');
    if (!lightbox || !trigger) return;
    var lightboxStage = lightbox.querySelector('.lightbox-stage');
    var lightboxImage = document.getElementById('lightboxImage');
    var lightboxCaption = document.getElementById('lightboxCaption');
    var closeBtn = document.getElementById('lightboxClose');
    var viewToggle = document.getElementById('lightboxViewToggle');
    var viewButtons = Array.prototype.slice.call(viewToggle.querySelectorAll('button'));
    var pageToggle = document.getElementById('viewToggle');
    var isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    var wallMode = false;
    var zoom = 1, zoomX = 0, zoomY = 0, zoomBox = null, wheelPanned = false, wheelIdle = null;

    function resetZoom() {
        zoom = 1; zoomX = 0; zoomY = 0; zoomBox = null; wheelPanned = false;
        lightboxImage.style.removeProperty('--zoom');
        lightboxImage.style.removeProperty('--zoom-x');
        lightboxImage.style.removeProperty('--zoom-y');
        lightbox.classList.remove('is-zoomed');
    }

    // The caption lines up with the image's left edge
    function syncCaptionWidth() {
        lightboxStage.style.setProperty('--lightbox-image-width', lightboxImage.clientWidth + 'px');
    }

    function render() {
        resetZoom();
        var title = trigger.getAttribute('data-title') || '';
        var wallSrc = trigger.getAttribute('data-wall');
        var showWall = wallMode && !!wallSrc;
        lightboxImage.classList.remove('is-visible');
        lightboxImage.onload = syncCaptionWidth;
        lightboxImage.src = showWall ? wallSrc : trigger.getAttribute('data-full');
        lightboxImage.alt = showWall ? title + ', framed on a wall' : title;
        lightboxCaption.textContent = title;
        viewToggle.hidden = !wallSrc;
        viewButtons.forEach(function (btn) {
            btn.setAttribute('aria-pressed', String((btn.getAttribute('data-view') === 'wall') === showWall));
        });
        if (lightboxImage.complete) syncCaptionWidth();
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { lightboxImage.classList.add('is-visible'); });
        });
    }

    // Keep the page's Print / On wall switch in step with the fullscreen one
    function setPageView(toWall) {
        if (!pageToggle) return;
        var btn = pageToggle.querySelector('button[data-view="' + (toWall ? 'wall' : 'print') + '"]');
        if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
    }

    function open() {
        var pressed = pageToggle && pageToggle.querySelector('button[aria-pressed="true"]');
        wallMode = !!pressed && pressed.getAttribute('data-view') === 'wall';
        render();
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
        closeBtn.focus({ preventScroll: true });
    }

    function close() {
        lightbox.classList.remove('active');
        resetZoom();
        lightboxImage.classList.remove('is-visible');
        document.body.style.overflow = '';
        setPageView(wallMode);
        trigger.focus({ preventScroll: true });
    }

    trigger.addEventListener('click', open);
    trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    viewButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var toWall = btn.getAttribute('data-view') === 'wall';
            if (toWall === wallMode) return;
            wallMode = toWall;
            render();
            if (toWall) trackEvent('view_on_wall', { artwork_title: trigger.getAttribute('data-title') || '', source: 'lightbox' });
        });
    });

    closeBtn.addEventListener('click', close);
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });

    function maxZoom() {
        var ratio = lightboxImage.naturalWidth / (lightboxImage.clientWidth || 1);
        return Math.min(4, Math.max(2.5, ratio));
    }

    // The image's unzoomed centre and size, kept for the length of a zoom
    function baseBox() {
        if (zoom > 1 && zoomBox) return zoomBox;
        var rect = lightboxImage.getBoundingClientRect();
        return zoomBox = {
            cx: rect.left + rect.width / 2 - zoomX,
            cy: rect.top + rect.height / 2 - zoomY,
            w: rect.width / zoom,
            h: rect.height / zoom
        };
    }

    function clampAxis(t, center, size, viewport) {
        var half = size * zoom / 2;
        if (half * 2 <= viewport) return viewport / 2 - center;
        return Math.min(half - center, Math.max(viewport - center - half, t));
    }

    function applyZoom(box) {
        box = box || baseBox();
        zoomX = zoom > 1 ? clampAxis(zoomX, box.cx, box.w, window.innerWidth) : 0;
        zoomY = zoom > 1 ? clampAxis(zoomY, box.cy, box.h, window.innerHeight) : 0;
        lightboxImage.style.setProperty('--zoom', zoom);
        lightboxImage.style.setProperty('--zoom-x', zoomX + 'px');
        lightboxImage.style.setProperty('--zoom-y', zoomY + 'px');
        lightbox.classList.toggle('is-zoomed', zoom > 1);
    }

    function lerpAxis(p, center, size, viewport) {
        var half = size * zoom / 2;
        if (half * 2 <= viewport) return viewport / 2 - center;
        var max = half - center;
        var min = viewport - center - half;
        return max + (min - max) * (p / viewport);
    }

    function panToPointer(x, y, box) {
        zoomX = lerpAxis(x, box.cx, box.w, window.innerWidth);
        zoomY = lerpAxis(y, box.cy, box.h, window.innerHeight);
        applyZoom(box);
    }

    function zoomAt(x, y, scale, box) {
        zoomX = (x - box.cx) * (1 - scale);
        zoomY = (y - box.cy) * (1 - scale);
        zoom = scale;
        applyZoom(box);
    }

    lightboxImage.addEventListener('click', function (e) {
        if (isTouchDevice) return;
        if (zoom > 1) { resetZoom(); return; }
        var box = baseBox();
        zoom = maxZoom();
        panToPointer(e.clientX, e.clientY, box);
    });

    lightboxImage.addEventListener('mousemove', function (e) {
        if (isTouchDevice || zoom === 1 || wheelPanned) return;
        panToPointer(e.clientX, e.clientY, baseBox());
    });

    lightbox.addEventListener('wheel', function (e) {
        if (!e.ctrlKey && zoom === 1) return;
        e.preventDefault();
        var unit = e.deltaMode === 1 ? 16 : 1;
        var box = baseBox();
        if (e.ctrlKey) {
            var scale = Math.min(maxZoom(), Math.max(1, zoom * Math.exp(-e.deltaY * unit * 0.01)));
            if (scale <= 1.01) { resetZoom(); return; }
            var qx = (e.clientX - box.cx - zoomX) / zoom;
            var qy = (e.clientY - box.cy - zoomY) / zoom;
            zoomX = e.clientX - box.cx - scale * qx;
            zoomY = e.clientY - box.cy - scale * qy;
            zoom = scale;
        } else {
            zoomX -= e.deltaX * unit;
            zoomY -= e.deltaY * unit;
        }
        wheelPanned = true;
        lightboxImage.classList.add('is-gesturing');
        clearTimeout(wheelIdle);
        wheelIdle = setTimeout(function () { lightboxImage.classList.remove('is-gesturing'); }, 150);
        applyZoom(box);
    }, { passive: false });

    var gesture = null;
    var lastTap = { time: 0, x: 0, y: 0 };

    function touchMid(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2,
            dist: Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
        };
    }

    function startGesture(touches) {
        var box = baseBox();
        gesture = { box: box, zoom: zoom, x: zoomX, y: zoomY, moved: gesture ? gesture.moved : false };
        if (touches.length > 1) {
            gesture.pinch = touchMid(touches);
        } else {
            gesture.px = touches[0].clientX;
            gesture.py = touches[0].clientY;
        }
    }

    lightboxImage.addEventListener('touchstart', function (e) {
        if (e.touches.length > 2) return;
        if (e.touches.length === 1) gesture = null;
        startGesture(e.touches);
        lightboxImage.classList.add('is-gesturing');
    }, { passive: true });

    lightboxImage.addEventListener('touchmove', function (e) {
        if (!gesture) return;
        if (gesture.pinch && e.touches.length > 1) {
            e.preventDefault();
            var mid = touchMid(e.touches);
            var scale = Math.min(maxZoom(), Math.max(1, gesture.zoom * mid.dist / gesture.pinch.dist));
            var qx = (gesture.pinch.x - gesture.box.cx - gesture.x) / gesture.zoom;
            var qy = (gesture.pinch.y - gesture.box.cy - gesture.y) / gesture.zoom;
            zoom = scale;
            zoomX = mid.x - gesture.box.cx - scale * qx;
            zoomY = mid.y - gesture.box.cy - scale * qy;
            gesture.moved = true;
            applyZoom(gesture.box);
        } else if (!gesture.pinch && zoom > 1) {
            e.preventDefault();
            zoomX = gesture.x + e.touches[0].clientX - gesture.px;
            zoomY = gesture.y + e.touches[0].clientY - gesture.py;
            gesture.moved = true;
            applyZoom(gesture.box);
        }
    }, { passive: false });

    lightboxImage.addEventListener('touchend', function (e) {
        if (!gesture) return;
        if (e.touches.length) { startGesture(e.touches); return; }
        lightboxImage.classList.remove('is-gesturing');
        if (zoom < 1.05) resetZoom();
        var wasPinch = !!gesture.pinch || gesture.moved;
        gesture = null;
        if (wasPinch) return;
        var touch = e.changedTouches[0];
        var now = Date.now();
        if (now - lastTap.time < 300 && Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 30) {
            lastTap.time = 0;
            if (zoom > 1) resetZoom(); else zoomAt(touch.clientX, touch.clientY, maxZoom(), baseBox());
        } else {
            lastTap = { time: now, x: touch.clientX, y: touch.clientY };
        }
    });

    window.addEventListener('resize', function () { if (zoom > 1) resetZoom(); });

    document.addEventListener('keydown', function (e) {
        if (!lightbox.classList.contains('active') || e.key !== 'Escape') return;
        if (zoom > 1) resetZoom(); else close();
    });
})();
