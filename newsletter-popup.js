/*
 * Newsletter pop-up: a second chance to subscribe, alongside the homepage form.
 *
 * Shows after 6 seconds of active browsing (tab visible and window focused),
 * summed across pages and tabs in this visit, on whatever page the visitor is on.
 * On the homepage it waits until the sign-up form there is scrolled out of view.
 * A visit ends after 30 minutes with no activity on the site (like Google
 * Analytics sessions); localStorage, so it holds across tabs.
 * Never shows:
 *   - more than once per visit, however it was left (closed, Esc, link, back
 *     button); it can come back on the next visit
 *   - ever again after subscribing, here or via the homepage form (localStorage
 *     ec_subscribed, the key the homepage form already sets)
 *   - before the cookie banner has been answered, or while a lightbox, enquiry
 *     form or other overlay is open, or while someone is typing in a field
 *
 * Posts to the same MailerLite form as the homepage, with ec_source = popup,
 * using fetch and reading MailerLite's JSON reply (it allows cross-origin
 * requests), so success, a rejected address and a blocked request (often a
 * privacy or ad-blocking extension) each get their own message. Same logic as
 * the homepage form in index.html; keep the two in step.
 * Sends no analytics events and loads nothing from third parties until
 * Subscribe is pressed. Built entirely in JS after load, so crawlers see no change.
 */
(function () {
    'use strict';

    var ACTIVE_MS_NEEDED = 6000;
    var VISIT_GAP_MS = 30 * 60 * 1000;    // inactivity that ends a visit
    var TICK_MS = 1000;

    // All localStorage, so a visit spans tabs
    var K_LAST = 'ec_nlp_last_active';    // last time the visitor was active on the site
    var K_TIME = 'ec_nlp_visit_active_ms'; // active time so far this visit
    var K_SHOWN = 'ec_nlp_visit_shown';   // '1' once shown (or Join pressed) this visit
    var K_SUBSCRIBED = 'ec_subscribed';   // shared with homepage form

    var MAILERLITE_ACTION = 'https://assets.mailerlite.com/jsonp/2556020/forms/194893785895798150/subscribe';

    function get(store, key) {
        try { return window[store].getItem(key); } catch (e) { return null; }
    }
    function set(store, key, value) {
        try { window[store].setItem(key, value); return true; } catch (e) { return false; }
    }

    // Already subscribed, or already shown this visit
    function suppressed() {
        if (get('localStorage', K_SUBSCRIBED) === '1') return true;
        if (get('localStorage', K_SHOWN) === '1') return true;
        return false;
    }

    // Starts a new visit if the visitor has been away for 30 minutes or more,
    // then records them as active now
    function touchVisit() {
        var now = Date.now();
        var last = parseInt(get('localStorage', K_LAST), 10);
        if (!last || now - last >= VISIT_GAP_MS) {
            try {
                localStorage.removeItem(K_SHOWN);
                localStorage.removeItem(K_TIME);
            } catch (e) {}
        }
        set('localStorage', K_LAST, String(now));
    }

    // #nlp-preview shows a random work; #nlp-preview-3 shows the third, and so on
    var previewMatch = location.hash.match(/^#nlp-preview(?:-(\d+))?$/);
    var PREVIEW = !!previewMatch;

    var activeMs = 0;
    var timer = null;

    // Normal start-up: bail out if suppressed, then start counting
    function init() {
        // Pressing Join on the homepage form stands the pop-up down for the rest
        // of the visit straight away; a successful sign-up then sets
        // ec_subscribed, which stops it for good
        document.addEventListener('submit', function (e) {
            if (e.target.closest && e.target.closest('.js-nl-form')) {
                set('localStorage', K_SHOWN, '1');
            }
        }, true);

        // Without storage we can't track the visit or cap it to once per visit
        if (!set('localStorage', K_LAST, get('localStorage', K_LAST) || String(Date.now()))) return;

        // Tidy up the keys from the earlier 7-day / per-tab version
        try {
            localStorage.removeItem('ec_nlp_dismissed_at');
            sessionStorage.removeItem('ec_nlp_shown');
            sessionStorage.removeItem('ec_nlp_active_ms');
        } catch (e) {}

        touchVisit();
        // Runs even once suppressed, so a visitor reading one page for a long
        // time still counts as the same visit
        timer = setInterval(tick, TICK_MS);
    }

    function isActive() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    // Anything that means now is a bad moment to appear
    function blocked() {
        // Cookie banner not yet answered (both Silktide and the fallback banner set this)
        if (get('localStorage', 'analyticsConsent') === null) return true;
        // ...or the banner or cookie settings are on screen (Silktide removes
        // #silktide-banner once answered; the fallback banner uses .show)
        if (document.querySelector('#silktide-banner, .cookie-banner.show')) return true;
        var modal = document.getElementById('silktide-modal');
        if (modal && getComputedStyle(modal).display !== 'none') return true;
        // Lightbox, fullscreen viewer, enquiry form, or anything else locking scroll
        if (document.querySelector('.fullscreen-modal.active, .lightbox.active, .enquiry.is-open')) return true;
        if (document.body.style.overflow === 'hidden') return true;
        // Someone typing (e.g. the homepage form or the theme filter)
        var el = document.activeElement;
        if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
        // Homepage form already on screen: no need for a second one
        var inline = document.getElementById('newsletter');
        if (inline) {
            var r = inline.getBoundingClientRect();
            if (r.bottom > 0 && r.top < window.innerHeight) return true;
        }
        return false;
    }

    function tick() {
        if (!isActive()) return;
        touchVisit();
        if (popup || suppressed()) return;
        // Read back each time: other tabs in the same visit add to it too
        activeMs = (parseInt(get('localStorage', K_TIME), 10) || 0) + TICK_MS;
        set('localStorage', K_TIME, String(activeMs));
        if (activeMs >= ACTIVE_MS_NEEDED && !blocked()) show();
    }

    // One work, picked at random each time, from the public artists' available
    // works. Keep in step with the "Available works" cards on each artist page.
    var WORKS = [
        { title: 'Matera', artist: 'Andrea Rosselli', page: '/andrea', src: '/images/responsive/andrea-rosselli-matera-800.webp' },
        { title: 'Di passaggio', artist: 'Andrea Rosselli', page: '/andrea', src: '/images/responsive/andrea-rosselli-di-passaggio-800.webp' },
        { title: 'Basilica di Galliano, Cant\u00f9', artist: 'Andrea Rosselli', page: '/andrea', src: '/images/responsive/andrea-rosselli-basilica-di-galliano-800.webp' },
        { title: 'Ballerina', artist: 'Andrea Rosselli', page: '/andrea', src: '/images/responsive/andrea-rosselli-ballerina-800.webp' },
        { title: 'Unoccupied', artist: 'Mitsutaka Tsuryu', page: '/mitsutaka', src: '/images/responsive/mitsutaka-tsuryu-unoccupied-800.webp' },
        { title: 'Behind the Veil', artist: 'Mitsutaka Tsuryu', page: '/mitsutaka', src: '/images/responsive/mitsutaka-tsuryu-behind-the-veil-800.webp' },
        { title: 'In Transit', artist: 'Mitsutaka Tsuryu', page: '/mitsutaka', src: '/images/responsive/mitsutaka-tsuryu-in-transit-800.webp' },
        { title: 'The Unveiling of Sardar Badshah', artist: 'Nad-E-Ali', page: '/nad', src: '/images/nad-e-ali/NadEAli_HorseMen_21.jpg' },
        { title: 'Moving through Remembrance', artist: 'Nad-E-Ali', page: '/nad', src: '/images/nad-e-ali/NadEAli_HorseMen_30.jpg' },
        { title: 'Apples of Hope: Mannat for Ali Asghar (AS)', artist: 'Nad-E-Ali', page: '/nad', src: '/images/responsive/nad-e-ali-apples-800.webp' }
    ];

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var C = 'var(--deep-charcoal,#2C2C2C)';
    var STYLES = '' +
        '.nlp{position:fixed;inset:0;z-index:1600;display:flex;align-items:center;justify-content:center;padding:16px;' +
        'background:rgba(44,44,44,.55);opacity:0;transition:opacity .4s ease;font-family:"SuisseIntl",sans-serif}' +
        '.nlp.is-visible{opacity:1}' +
        '.nlp *{box-sizing:border-box}' +
        // The site draws its own cursor dot; keep the system cursor hidden here too
        '@media (hover:hover) and (pointer:fine){.nlp,.nlp *{cursor:none!important}}' +
        '.nlp-panel{position:relative;display:grid;grid-template-columns:1fr 1.25fr;gap:48px;align-items:start;' +
        'width:770px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;padding:56px;border-radius:0;' +
        'background:var(--cream-bg,#F3EFE9);color:' + C + ';transform:translateY(10px);' +
        'transition:transform .5s cubic-bezier(.16,1,.3,1);outline:none}' +
        '.nlp.is-visible .nlp-panel{transform:none}' +
        '.nlp-close{position:absolute;top:12px;right:12px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;' +
        'padding:0;border:0;background:none;color:inherit;cursor:pointer;transition:opacity .2s ease}' +
        '.nlp-close svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.2}' +
        '.nlp-close:hover{opacity:.6}' +
        '.nlp-close:focus{outline:none}' +
        '.nlp-close:focus-visible{outline:1px solid ' + C + ';outline-offset:-6px}' +
        '.nlp-title{margin:0 0 20px;font-size:2.75rem;font-weight:400;line-height:1.05;letter-spacing:-.02em}' +
        '.nlp-text{margin:0;font-size:1.05rem;font-weight:300;line-height:1.6;color:rgba(44,44,44,.8)}' +
        '.nlp-giveaway{margin-top:14px;font-size:.9rem}' +
        '.nlp-giveaway strong{font-weight:500;color:' + C + '}' +
        '.nlp-form{display:flex;flex-direction:column;gap:16px;margin:32px 0 0}' +
        '.nlp-form[hidden]{display:none}' +
        '.nlp-input{width:100%;padding:.85rem 1rem;border:1px solid rgba(44,44,44,.25);border-radius:0;' +
        'background:var(--warm-off-white,#FDFCF8);color:' + C + ';font-family:inherit;font-size:.95rem;font-weight:300;' +
        'letter-spacing:.02em;outline:none;-webkit-appearance:none;appearance:none;transition:border-color .3s ease}' +
        '.nlp-input:focus{border-color:' + C + '}' +
        '.nlp-input::placeholder{color:rgba(44,44,44,.5)}' +
        '.nlp-button{width:100%;padding:.85rem 1.4rem;border:1px solid ' + C + ';border-radius:0;background:' + C + ';' +
        'color:var(--warm-off-white,#FDFCF8);font-family:inherit;font-size:.9rem;font-weight:400;letter-spacing:.03em;' +
        'cursor:pointer;transition:background .3s ease,color .3s ease}' +
        '.nlp-button:hover:not(:disabled){background:transparent;color:' + C + '}' +
        '.nlp-button:disabled{opacity:.5;cursor:default}' +
        '.nlp-button:focus{outline:none}' +
        '.nlp-button:focus-visible{outline:1px solid ' + C + ';outline-offset:3px}' +
        '.nlp-msg{display:none;margin:24px 0 0;font-size:.95rem;font-weight:300;line-height:1.6}' +
        '.nlp-msg.is-visible{display:block}' +
        '.nlp-msg a{color:inherit}' +
        // Fixed frame so the panel is the same size for every work. The work is
        // scaled to fit inside it (never cropped or stretched) and centred; the
        // figure shrinks to the image so the caption sits under its left edge.
        // The photograph column stretches to the full height of the row and the
        // work (with its caption) sits vertically centred in it. The text column
        // stays top-aligned. min-height keeps every work's frame the same size.
        '.nlp-media{--nlp-frame:min(450px,calc(100vh - 220px));min-height:var(--nlp-frame);align-self:stretch;display:flex;align-items:center;justify-content:center;min-width:0}' +
        '.nlp-image{margin:0;width:100%}' +
        // fitImage() sets exact pixel sizes once the image loads; these are the fallback
        '.nlp-image img{display:block;max-width:100%;max-height:calc(var(--nlp-frame) - 34px);width:auto;height:auto}' +
        '.nlp-caption{margin-top:10px;font-size:.8rem;font-weight:300;line-height:1.4;color:rgba(44,44,44,.7)}' +
        '.nlp-caption a{color:inherit;text-decoration:none;border-bottom:1px solid rgba(44,44,44,.3);transition:color .2s ease,border-color .2s ease}' +
        '.nlp-caption a:hover{color:' + C + ';border-color:' + C + '}' +
        '.nlp-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
        '@media (max-width:760px){' +
            '.nlp-panel{grid-template-columns:1fr;gap:0;width:420px;padding:48px 28px 32px}' +
            '.nlp-media{display:none}' +
            '.nlp-title{font-size:2rem;margin-bottom:14px}' +
            '.nlp-text{font-size:.95rem}' +
            '.nlp-giveaway{display:none}' +
            '.nlp-form{margin-top:24px;gap:12px}' +
            '.nlp-close{top:4px;right:4px}' +
        '}' +
        '@media (prefers-reduced-motion:reduce){.nlp,.nlp-panel{transition:opacity .2s ease;transform:none}}';

    var popup, onKeydown, onResize, previousFocus, previousOverflow;

    function show() {
        if (!PREVIEW) {
            // Being shown at all counts for this visit, however it's left
            // (close, Esc, the artist link, back button, closing the tab).
            // Subscribing then makes it permanent via ec_subscribed.
            set('localStorage', K_SHOWN, '1');
        }

        var style = document.createElement('style');
        style.textContent = STYLES +
            (PREVIEW ? '#silktide-wrapper,.cookie-banner{display:none!important}' : '');
        document.head.appendChild(style);

        var pick = PREVIEW && previewMatch[1] ? parseInt(previewMatch[1], 10) - 1 : -1;
        var work = WORKS[pick] || WORKS[Math.floor(Math.random() * WORKS.length)];

        popup = document.createElement('div');
        popup.className = 'nlp';
        popup.innerHTML =
            '<div class="nlp-panel" role="dialog" aria-modal="true" aria-labelledby="nlpTitle" aria-describedby="nlpText" tabindex="-1">' +
                '<button type="button" class="nlp-close" aria-label="Close">' +
                    '<svg aria-hidden="true" viewBox="0 0 18 18"><path d="M2 2l14 14M16 2L2 16"/></svg>' +
                '</button>' +
                '<div class="nlp-copy">' +
                    '<h2 class="nlp-title" id="nlpTitle">Stay in touch</h2>' +
                    '<p class="nlp-text" id="nlpText">Occasional notes from elsewhere: selected artists, new works, and upcoming exhibitions.</p>' +
                    '<p class="nlp-text nlp-giveaway"><strong>A chance to win a photograph for your walls.</strong> One subscriber will be selected to receive a limited-edition print from the elsewhere collection.</p>' +
                    '<form class="nlp-form" action="' + MAILERLITE_ACTION + '" method="post">' +
                        '<label for="nlpEmail" class="nlp-hidden">Email address</label>' +
                        '<input type="email" id="nlpEmail" name="fields[email]" class="nlp-input" placeholder="Your email" required autocomplete="email" inputmode="email">' +
                        '<input type="hidden" name="fields[ec_source]" value="popup">' +
                        '<input type="hidden" name="ml-submit" value="1">' +
                        '<input type="hidden" name="anticsrf" value="true">' +
                        '<button type="submit" class="nlp-button">Subscribe</button>' +
                    '</form>' +
                    '<p class="nlp-msg nlp-success" role="status" aria-live="polite"></p>' +
                    '<p class="nlp-msg nlp-error" role="status" aria-live="polite"></p>' +
                '</div>' +
                '<div class="nlp-media"><figure class="nlp-image">' +
                    '<img src="' + work.src + '" alt="' + escapeHtml(work.title + ', by ' + work.artist) + '" decoding="async">' +
                    '<figcaption class="nlp-caption">' + escapeHtml(work.title) + ', ' +
                        '<a href="' + work.page + '">' + escapeHtml(work.artist) + '</a></figcaption>' +
                '</figure></div>' +
            '</div>';
        document.body.appendChild(popup);

        var panel = popup.querySelector('.nlp-panel');
        var media = popup.querySelector('.nlp-media');
        var figure = popup.querySelector('.nlp-image');
        var img = figure.querySelector('img');

        // Scale the work to fit the frame at its own aspect ratio (never cropped,
        // never enlarged past its file size), leaving room for the caption, and
        // make the figure exactly as wide as the image so the caption lines up.
        function fitImage() {
            if (!img.naturalWidth || !media.clientWidth) return;
            var maxW = media.clientWidth;
            // Cap to the frame, not the column, so a tall text column can't enlarge it
            var maxH = parseFloat(getComputedStyle(media).minHeight) - 34;
            var scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
            var w = Math.floor(img.naturalWidth * scale);
            var h = Math.floor(img.naturalHeight * scale);
            img.style.width = w + 'px';
            img.style.height = h + 'px';
            figure.style.width = w + 'px';
        }
        // Measure now if it's already loaded, and again whenever it finishes
        img.addEventListener('load', fitImage);
        fitImage();
        onResize = fitImage;
        window.addEventListener('resize', onResize);
        var form = popup.querySelector('.nlp-form');
        var input = popup.querySelector('.nlp-input');
        var button = popup.querySelector('.nlp-button');
        var success = popup.querySelector('.nlp-success');
        var error = popup.querySelector('.nlp-error');

        function showSuccess() {
            form.hidden = true;
            success.textContent = 'Thank you for joining. You are on the list!';
            success.classList.add('is-visible');
        }

        popup.querySelector('.nlp-close').addEventListener('click', dismiss);
        // A click on the dimmed area outside the panel closes it
        popup.addEventListener('click', function (e) {
            if (e.target === popup) dismiss();
        });

        onKeydown = function (e) {
            if (e.key === 'Escape' || e.key === 'Esc') {
                dismiss();
                return;
            }
            // Keep Tab inside the dialog while it's open
            if (e.key === 'Tab') {
                var items = Array.prototype.filter.call(
                    panel.querySelectorAll('button, input:not([type="hidden"]), a[href]'),
                    function (el) { return !el.disabled && el.offsetParent !== null; }
                );
                if (!items.length) return;
                var first = items[0], last = items[items.length - 1];
                if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKeydown);

        var EMAIL = '<a href="mailto:hello@elsewherecollective.nl">hello@elsewherecollective.nl</a>';
        var MESSAGES = {
            invalid: 'That email address doesn\u2019t look right. Please check it and try again.',
            failed: 'Something went wrong. Please try again or email us at ' + EMAIL,
            blocked: 'We couldn\u2019t reach our newsletter service. This is often caused by a privacy or ad-blocking extension. Please email us at ' + EMAIL + ' and we\u2019ll add you.'
        };
        function showError(kind) {
            error.innerHTML = MESSAGES[kind];
            error.classList.add('is-visible');
            button.disabled = false;
            button.textContent = 'Subscribe';
        }

        form.addEventListener('submit', function (e) {
            if (!input.value.trim()) return;
            // Preview: show the thank-you state without sending anything to MailerLite
            if (PREVIEW) {
                e.preventDefault();
                showSuccess();
                return;
            }
            e.preventDefault();
            button.disabled = true;
            button.textContent = 'Subscribing';
            error.classList.remove('is-visible');

            var controller = window.AbortController ? new AbortController() : null;
            var timer = setTimeout(function () { if (controller) controller.abort(); }, 15000);
            fetch(MAILERLITE_ACTION, { method: 'POST', body: new FormData(form), signal: controller ? controller.signal : undefined })
                // An unreadable reply means MailerLite answered but oddly: 'failed', not 'blocked'
                .then(function (res) { return res.json().catch(function () { return {}; }); })
                .then(function (data) {
                    clearTimeout(timer);
                    if (data && data.success) {
                        showSuccess();
                        set('localStorage', K_SUBSCRIBED, '1');
                        setTimeout(close, 4000);
                    } else if (data && data.errors && data.errors.fields && data.errors.fields.email) {
                        showError('invalid');
                    } else {
                        showError('failed');
                    }
                })
                .catch(function () {
                    clearTimeout(timer);
                    showError('blocked');
                });
        });

        // Modal: stop the page scrolling behind it, and move focus to the dialog
        // (not the email field, so phones don't pop the keyboard up unasked)
        previousFocus = document.activeElement;
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        panel.focus({ preventScroll: true });

        requestAnimationFrame(function () {
            requestAnimationFrame(function () { popup.classList.add('is-visible'); });
        });
    }

    function dismiss() {
        close();
    }

    function close() {
        if (!popup) return;
        document.removeEventListener('keydown', onKeydown);
        window.removeEventListener('resize', onResize);
        var el = popup;
        popup = null;
        document.documentElement.style.overflow = previousOverflow;
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
            previousFocus.focus({ preventScroll: true });
        } else if (el.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        el.classList.remove('is-visible');
        setTimeout(function () { el.remove(); }, 400);
    }

    // Runs last, so everything above is set up first.
    // #nlp-preview (design preview, used by mockup-newsletter-popup.html) shows
    // it straight away and saves nothing.
    var go = PREVIEW ? show : init;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', go);
    } else {
        go();
    }
})();
