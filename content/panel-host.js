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

  // Nudge JS-driven, resize-listening layouts (e.g. the OnlyOffice editor) to re-measure
  // against the changed root width.
  function dispatchResize() {
    try { window.dispatchEvent(new Event('resize')); } catch (_) { /* ignore */ }
  }

  function closePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    // Restore the page exactly as before: drop our reserved width + overflow clip, then
    // put back any inline values the site had.
    root.style.removeProperty('width');
    root.style.removeProperty('overflow-x');
    if (root.dataset.eduSharingPrevWidth) root.style.width = root.dataset.eduSharingPrevWidth;
    if (root.dataset.eduSharingPrevOverflowX) root.style.overflowX = root.dataset.eduSharingPrevOverflowX;
    delete root.dataset.eduSharingPrevWidth;
    delete root.dataset.eduSharingPrevOverflowX;
    // Let the page expand back to full width.
    dispatchResize();
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

    // Reserve space for the panel by CONSTRAINING THE ROOT WIDTH (not a margin): a
    // margin-right leaves width:100%/100vw layouts (e.g. the OnlyOffice editor) at full
    // width, so the panel would only overlay them. Setting `html { width: calc(100% - W) }`
    // actually shrinks the content box, so a width:100% body/iframe follows. `overflow-x:
    // hidden` clips any leftover 100vw children (no phantom scrollbar). `important` beats
    // the site's own html styles. A synthetic resize nudges JS editors to re-layout.
    if (root.dataset.eduSharingPrevWidth === undefined) {
      root.dataset.eduSharingPrevWidth = root.style.width || '';
      root.dataset.eduSharingPrevOverflowX = root.style.overflowX || '';
    }
    root.style.setProperty('width', 'calc(100% - ' + panelWidth + 'px)', 'important');
    root.style.setProperty('overflow-x', 'hidden', 'important');
    dispatchResize();

    function applyWidth(w) {
      panelWidth = clampWidth(w);
      container.style.width = panelWidth + 'px';
      root.style.setProperty('width', 'calc(100% - ' + panelWidth + 'px)', 'important');
    }

    // ---- Resize interaction -------------------------------------------------
    let dragging = false;
    let dragShield = null;
    function onPointerMove(e) {
      if (!dragging) return;
      // Width = distance from the pointer to the right edge of the viewport.
      applyWidth(window.innerWidth - e.clientX);
      e.preventDefault();
    }
    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      // Restore normal interaction and drop the drag shield.
      iframe.style.pointerEvents = '';
      if (dragShield) { dragShield.remove(); dragShield = null; }
      document.body && (document.body.style.userSelect = savedUserSelect);
      grip.style.background = 'rgba(0,59,124,0.25)';
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      // Let JS editors re-layout to the final width, then persist it.
      dispatchResize();
      storageSet({ [STORAGE_KEY]: panelWidth });
    }
    let savedUserSelect = '';
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      grip.style.background = 'rgba(0,59,124,0.8)';
      // During the drag: kill our iframe's pointer capture and text selection, and lay a
      // transparent full-viewport shield over the page so pointermove keeps reaching the
      // top document even when the pointer is over a host iframe (e.g. the OnlyOffice
      // editor iframe, which would otherwise swallow the events). Below the panel's
      // z-index so the panel stays on top.
      iframe.style.pointerEvents = 'none';
      dragShield = document.createElement('div');
      Object.assign(dragShield.style, {
        position: 'fixed',
        top: '0', left: '0', right: '0', bottom: '0',
        zIndex: '2147483646',
        cursor: 'col-resize',
        background: 'transparent'
      });
      root.appendChild(dragShield);
      savedUserSelect = document.body ? document.body.style.userSelect : '';
      if (document.body) document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      e.preventDefault();
    });

    // Keep the panel within bounds if the window is resized narrower.
    window.addEventListener('resize', () => applyWidth(panelWidth));

    // Envelope contract shared with the OnlyOffice page-side plugin. It listens on both
    // window.postMessage and a CustomEvent named EDU_PLUGIN_CHANNEL, and only accepts
    // messages whose `source` marker matches, dispatching by `event` name.
    const EDU_PLUGIN_SOURCE = 'edu-sharing-browser-plugin';
    const EDU_PLUGIN_CHANNEL = 'edu-sharing-browser-plugin';

    // Inbound direction: the OnlyOffice plugin (a nested, cross-origin iframe) posts events
    // to window.top with this source marker. We relay them into our sidebar iframe. The
    // sidebar's own extension origin is the safe target for that relay.
    const EDU_ONLYOFFICE_SOURCE = 'edu-sharing-onlyoffice-plugin';
    const sidebarOrigin = (() => { try { return new URL(iframe.src).origin; } catch (_) { return '*'; } })();
    // Buffer the last inbound plugin message so it can be replayed once the sidebar app is
    // ready (covers the panel-open / app-boot race). Also persisted to storage so a reload
    // of the sidebar still picks it up.
    let lastInbound = null;
    function relayInbound(data) {
      try { iframe.contentWindow.postMessage(data, sidebarOrigin); } catch (_) { /* ignore */ }
    }

    // OnlyOffice loads its plugins in a nested, cross-origin iframe (top → editor iframe →
    // plugin iframe). A postMessage/CustomEvent on the top page does NOT propagate into
    // child frames, so we must post the envelope into every frame of the tree. postMessage
    // with '*' works cross-origin and through arbitrary nesting; reading `.frames`/`.length`
    // and calling `.postMessage` on a cross-origin Window are all on the safe whitelist.
    function broadcastToFrames(win, envelope) {
      let count = 0;
      try { win.postMessage(envelope, '*'); count++; } catch (_) { /* ignore */ }
      const frames = (win && win.frames) || [];
      for (let i = 0; i < frames.length; i++) {
        try { count += broadcastToFrames(frames[i], envelope); } catch (_) { /* cross-origin frame */ }
      }
      return count;
    }

    // Messages from the panel iframe:
    //  - edusharing-panel-close: user closed the panel.
    //  - edusharing-insert-node: selected edu-sharing node(s) to hand to the host page
    //    (e.g. OnlyOffice). Re-emitted into the page's main world via both transports so
    //    the page plugin can catch either a window message or a named CustomEvent.
    const handler = (event) => {
      const data = event.data;
      // Inbound plugin → sidebar. Comes from a cross-origin plugin iframe (NOT our sidebar),
      // so it must be handled BEFORE the `event.source !== iframe.contentWindow` guard below.
      if (data && data.source === EDU_ONLYOFFICE_SOURCE) {
        console.log('[edu-sharing][panel-host] ⬅ received from OnlyOffice plugin:', data.event, data.data);
        lastInbound = data;
        relayInbound(data);
        try { api.storage.local.set({ eduSharingPendingPreview: { data: data, t: Date.now() } }); } catch (_) { /* ignore */ }
        return;
      }
      if (event.source !== iframe.contentWindow) return;
      const type = data && data.type;
      if (type === 'edusharing-sidebar-ready') {
        // Sidebar app has booted → replay any buffered inbound message.
        if (lastInbound) {
          console.log('[edu-sharing][panel-host] ➡ sidebar ready → replaying buffered inbound', lastInbound.event);
          relayInbound(lastInbound);
        }
        return;
      }
      if (type === 'edusharing-panel-close') {
        closePanel();
      } else if (type === 'edusharing-insert-node') {
        const nodes = event.data && event.data.nodes;
        const envelope = { source: EDU_PLUGIN_SOURCE, event: 'INSERT_NODE', data: { nodes: nodes } };
        console.log('[edu-sharing][panel-host] ⬅ received "edusharing-insert-node" from sidebar iframe:',
          (nodes && nodes.length) || 0, 'node(s) → broadcasting envelope to all frames:', envelope);
        // Primary transport: post the envelope into EVERY frame of the tab (top → editor
        // iframe → cross-origin plugin iframe). Self-posts to the top window fail our own
        // `event.source !== iframe.contentWindow` guard below → no loop.
        const delivered = broadcastToFrames(window.top, envelope);
        console.log('[edu-sharing][panel-host] ➡ broadcast INSERT_NODE envelope to ' + delivered + ' frame(s)');
        // Extra fallback for a content-script that might run directly inside a frame with
        // all_frames:true (CustomEvent stays within its own frame; harmless otherwise).
        try { window.dispatchEvent(new CustomEvent(EDU_PLUGIN_CHANNEL, { detail: envelope })); } catch (_) { /* ignore */ }
        try { document.dispatchEvent(new CustomEvent(EDU_PLUGIN_CHANNEL, { detail: envelope })); } catch (_) { /* ignore */ }
      }
    };
    window.__eduSharingPanelMsgHandler = handler;
    window.addEventListener('message', handler);
  });
})();
