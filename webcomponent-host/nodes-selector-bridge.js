// Bridges the sidebar and the edu-sharing bundle in this iframe: creates
// <edu-sharing-nodes-selector>, sets its inputs via postMessage, relays its events back.
(function () {
  var TAG = 'edu-sharing-nodes-selector';
  var parentOrigin = location.origin; // parent iframe is same (extension) origin
  var el = null;

  function send(type, detail) {
    console.log('[edu-sharing][bridge] ➡ send to sidebar:', type, detail);
    try { parent.postMessage({ source: 'nodes-selector', type: type, detail: detail }, parentOrigin); }
    catch (e) { console.warn('[edu-sharing][bridge] send failed', e); }
  }

  function mount(init) {
    if (el) return; // already mounted
    el = document.createElement(TAG);
    init = init || {};
    // Angular Elements maps @Input()s to element properties (complex values, not attributes).
    if (init.tabBlacklist !== undefined) el.tabBlacklist = init.tabBlacklist;
    if (init.parent !== undefined) el.parent = init.parent;       // omitted → never set
    if (init.primaryMode !== undefined) el.primaryMode = init.primaryMode;

    // The selector has no DOM "copy" event — with `parent` unset, the "Gewählten Inhalt
    // kopieren" button routes the selection through option.optionConfig.onNodesChoosen
    // (a callback). Functions can't cross postMessage, so we attach it here (same JS
    // context as the element) and relay the selected nodes to the sidebar.
    var option = init.option || {};
    option.optionConfig = option.optionConfig || {};
    option.optionConfig.onNodesChoosen = function (payload) {
      // payload = { nodes, connectorId, window }; drop the non-cloneable `window` ref.
      var nodes = (payload && payload.nodes) || [];
      console.log('[edu-sharing][bridge] ⚡ onNodesChoosen fired ("Gewählten Inhalt kopieren"):', nodes.length, 'node(s)', payload);
      send('copy', { nodes: nodes, connectorId: payload && payload.connectorId });
    };
    el.option = option;

    console.log('[edu-sharing][bridge] mounting <' + TAG + '> with', init);
    document.getElementById('nodes-root').appendChild(el);
    send('mounted', null);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== parentOrigin) return;
    var msg = e.data || {};
    if (msg.target !== 'nodes-selector') return;
    console.log('[edu-sharing][bridge] ⬅ received from sidebar:', msg.type, msg.detail);
    if (msg.type === 'init') {
      customElements.whenDefined(TAG).then(function () { mount(msg.detail); });
    }
  });

  // Announce readiness once the custom element has been registered by the bundle.
  customElements.whenDefined(TAG).then(function () {
    console.log('[edu-sharing][bridge] <' + TAG + '> defined → announcing ready');
    send('ready', null);
  });
})();
