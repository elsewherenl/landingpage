// Mobile menu (styles in site-nav.css): the header's "Menu" button opens the
// links under the header and reads "Close" while open. Closes on Escape, on
// choosing a link, when the window widens past the menu breakpoint, and when
// the page comes back from the back/forward cache. The page behind doesn't
// scroll while it's open (the newsletter pop-up also waits while it is).
(function () {
    var header = document.querySelector('.header');
    var button = header && header.querySelector('.nav-toggle');
    var nav = header && header.querySelector('nav');
    if (!button || !nav) return;

    var mq = window.matchMedia('(max-width: 960px)');
    var previousOverflow = '';

    function isOpen() {
        return header.classList.contains('nav-open');
    }

    function setOpen(open) {
        if (open === isOpen()) return;
        header.classList.toggle('nav-open', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        button.textContent = open ? 'Close' : 'Menu';
        if (open) {
            previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = previousOverflow;
        }
    }

    button.addEventListener('click', function () {
        setOpen(!isOpen());
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) {
            setOpen(false);
            button.focus();
        }
    });

    nav.addEventListener('click', function (e) {
        if (e.target.closest('a')) setOpen(false);
    });

    function onBreakpoint(e) {
        if (!e.matches) setOpen(false);
    }
    if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
    else if (mq.addListener) mq.addListener(onBreakpoint);

    window.addEventListener('pageshow', function () {
        setOpen(false);
    });
})();
