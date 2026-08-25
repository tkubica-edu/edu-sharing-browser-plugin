// Stamps the panel's theme before anything is painted.
//
// The setting itself lives in extension storage, and reading that is asynchronous — so by the time
// ThemeService has it, the panel has already had its first paint. In a dark panel that paint is a
// white flash across the whole strip, which is exactly what a dark theme is chosen to avoid. This
// runs first and stamps what the panel last resolved, from the mirror ThemeService keeps in local
// storage (see its MIRROR_KEY); the real setting then confirms or corrects it a moment later.
//
// A classic script rather than an inline one (the extension CSP is `script-src 'self'`, so nothing
// inline runs) and deliberately not a module: module scripts are deferred, so one would run after
// the document was parsed — and after the first paint.
(function () {
  try {
    var theme = localStorage.getItem('eduSharingResolvedTheme');
    if (theme !== 'dark' && theme !== 'light') {
      // Nothing resolved yet — a first run, or a cleared profile. The default setting is to follow
      // the browser, so that is what the first paint follows too.
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    // No storage, no media query: the stylesheet's own default is the light palette, which is what
    // an unstamped document renders in.
  }
})();
