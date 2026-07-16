// Bridges the sidebar and the edu-sharing bundle in this iframe: creates
// <edu-sharing-preview-sidebar>, feeds it the created node via postMessage.
// The element's `node` input takes the full (hydrated) Node object, not an id.
(function () {
  var TAG = 'edu-sharing-preview-sidebar';
  var parentOrigin = location.origin; // parent iframe is same (extension) origin
  var el = null;

  function send(type, detail) {
    try { parent.postMessage({ source: 'preview-sidebar', type: type, detail: detail }, parentOrigin); }
    catch (e) { /* ignore */ }
  }

  function mount(init) {
    if (el) { // already mounted → just refresh the node
      if (init && init.node !== undefined) el.node = init.node;
      return;
    }
    el = document.createElement(TAG);
    init = init || {};
    // Angular Elements maps @Input()s to element properties.
    if (init.editorMode) el.editorMode = init.editorMode;
    if (init.groupId) el.groupId = init.groupId;
    if (init.ticket) el.ticket = init.ticket;
    if (init.node !== undefined) el.node = init.node;

    document.getElementById('preview-root').appendChild(el);
    send('mounted', null);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== parentOrigin) return;
    var msg = e.data || {};
    if (msg.target !== 'preview-sidebar') return;
    if (msg.type === 'init') {
      customElements.whenDefined(TAG).then(function () { mount(msg.detail); });
    } else if (msg.type === 'setNode' && el) {
      el.node = msg.detail;
    }
  });

  // Announce readiness once the custom element has been registered by the bundle.
  customElements.whenDefined(TAG).then(function () { send('ready', null); });
})();
