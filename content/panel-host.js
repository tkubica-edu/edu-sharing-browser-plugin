// Injected on toolbar click; toggles a resizable, docked in-page iframe hosting the
// sidebar (cross-browser replacement for the Chromium-only sidePanel API). The width
// is persisted in storage.local.

(() => {
  // Content scripts see `chrome`/`browser` directly; no polyfill needed here.
  const api = globalThis.browser ?? globalThis.chrome;
  const PANEL_ID = 'edusharing-panel-root';
  const STORAGE_KEY = 'eduSharingPanelWidth';
  const DEFAULT_WIDTH = 440;
  const MIN_WIDTH = 340;
  const root = document.documentElement;

  // Largest width we allow, leaving a slice of the page visible.
  function maxWidth() {
    return Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.9));
  }
  function clampWidth(w) {
    return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));
  }

  // storage.local.get is promise-based on Firefox and on Chrome MV3, but
  // callback-only on older Chromium. Support both without double-resolving.
  function storageGet(defaults) {
    try {
      const p = api.storage.local.get(defaults);
      if (p && typeof p.then === 'function') return p;
    } catch (_) { /* fall through to callback form */ }
    return new Promise((resolve) => {
      try { api.storage.local.get(defaults, (items) => resolve(items || defaults)); }
      catch (_) { resolve(defaults); }
    });
  }
  function storageSet(obj) {
    try {
      const p = api.storage.local.set(obj);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* ignore persistence failures */ }
  }

  function closePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    root.style.marginRight = root.dataset.eduSharingPrevMarginRight || '';
    delete root.dataset.eduSharingPrevMarginRight;
    if (window.__eduSharingPanelMsgHandler) {
      window.removeEventListener('message', window.__eduSharingPanelMsgHandler);
      window.__eduSharingPanelMsgHandler = null;
    }
  }

  // Toggle: already open → close and stop.
  if (document.getElementById(PANEL_ID)) {
    closePanel();
    return;
  }

  // Load the persisted width (falls back to default) before building the panel.
  storageGet({ [STORAGE_KEY]: DEFAULT_WIDTH }).then((items) => {
    let panelWidth = clampWidth(Number(items && items[STORAGE_KEY]) || DEFAULT_WIDTH);

    // A second toolbar click may have re-run this file while storage was pending.
    if (document.getElementById(PANEL_ID)) return;

    // Open: build the docked container + iframe.
    const container = document.createElement('div');
    container.id = PANEL_ID;
    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: panelWidth + 'px',
      height: '100vh',
      zIndex: '2147483647',
      margin: '0',
      padding: '0',
      border: 'none',
      background: '#ffffff',
      boxShadow: '-2px 0 12px rgba(0,0,0,0.2)'
    });

    const iframe = document.createElement('iframe');
    iframe.src = api.runtime.getURL('sidebar/index.html');
    iframe.setAttribute('title', 'edu-sharing');
    iframe.setAttribute('allow', 'clipboard-write');
    Object.assign(iframe.style, {
      width: '100%',
      height: '100%',
      border: 'none',
      display: 'block'
    });

    // Drag handle on the left edge for resizing the panel.
    const handle = document.createElement('div');
    handle.setAttribute('title', 'Breite ziehen');
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    Object.assign(handle.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '8px',
      height: '100%',
      cursor: 'col-resize',
      background: 'transparent',
      zIndex: '1',
      touchAction: 'none'
    });
    // Subtle grip indicator, brightened on hover / while dragging.
    const grip = document.createElement('div');
    Object.assign(grip.style, {
      position: 'absolute',
      top: '50%',
      left: '2px',
      width: '4px',
      height: '48px',
      transform: 'translateY(-50%)',
      borderRadius: '4px',
      background: 'rgba(0,59,124,0.25)',
      transition: 'background 0.15s ease'
    });
    handle.appendChild(grip);
    handle.addEventListener('mouseenter', () => { if (!dragging) grip.style.background = 'rgba(0,59,124,0.6)'; });
    handle.addEventListener('mouseleave', () => { if (!dragging) grip.style.background = 'rgba(0,59,124,0.25)'; });

    container.appendChild(iframe);
    container.appendChild(handle);
    root.appendChild(container);

    // Shift page content aside so the panel does not cover it (best-effort — some
    // fixed-layout sites won't shift, in which case the panel simply overlays).
    if (root.dataset.eduSharingPrevMarginRight === undefined) {
      root.dataset.eduSharingPrevMarginRight = root.style.marginRight || '';
    }
    root.style.transition = 'margin-right 0.2s ease';
    root.style.marginRight = panelWidth + 'px';

    function applyWidth(w) {
      panelWidth = clampWidth(w);
      container.style.width = panelWidth + 'px';
      root.style.marginRight = panelWidth + 'px';
    }

    // ---- Resize interaction -------------------------------------------------
    let dragging = false;
    function onPointerMove(e) {
      if (!dragging) return;
      // Width = distance from the pointer to the right edge of the viewport.
      applyWidth(window.innerWidth - e.clientX);
      e.preventDefault();
    }
    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      // Restore normal interaction and the smooth margin transition.
      iframe.style.pointerEvents = '';
      document.body && (document.body.style.userSelect = savedUserSelect);
      root.style.transition = 'margin-right 0.2s ease';
      grip.style.background = 'rgba(0,59,124,0.25)';
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      storageSet({ [STORAGE_KEY]: panelWidth });
    }
    let savedUserSelect = '';
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      grip.style.background = 'rgba(0,59,124,0.8)';
      // During the drag: kill the iframe's pointer capture and text selection,
      // and disable the margin transition for 1:1 tracking.
      iframe.style.pointerEvents = 'none';
      root.style.transition = 'none';
      savedUserSelect = document.body ? document.body.style.userSelect : '';
      if (document.body) document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      e.preventDefault();
    });

    // Keep the panel within bounds if the window is resized narrower.
    window.addEventListener('resize', () => applyWidth(panelWidth));

    // Messages from the panel iframe:
    //  - edusharing-panel-close: user closed the panel.
    const handler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const type = event.data && event.data.type;
      if (type === 'edusharing-panel-close') {
        closePanel();
      }
    };
    window.__eduSharingPanelMsgHandler = handler;
    window.addEventListener('message', handler);
  });
})();
