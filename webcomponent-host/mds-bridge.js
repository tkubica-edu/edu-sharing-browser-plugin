// Bridges the sidebar and the edu-sharing bundle in this iframe: creates
// <edu-sharing-mds-editor>, feeds it metadata via postMessage, relays its events back.
(function () {
  var TAG = 'edu-sharing-mds-editor';
  var parentOrigin = location.origin; // parent iframe is same (extension) origin
  var el = null;

  function send(type, detail) {
    try { parent.postMessage({ source: 'mds-editor', type: type, detail: detail }, parentOrigin); }
    catch (e) { /* ignore */ }
  }

  function mount(init) {
    if (el) { // already mounted → just refresh metadata
      if (init && init.metadata !== undefined) el.metadata = init.metadata;
      return;
    }
    el = document.createElement(TAG);
    init = init || {};
    // Angular Elements maps @Input()s to element properties.
    if (init.groupId) el.groupId = init.groupId;
    if (init.repository) el.repository = init.repository;
    if (init.editorMode) el.editorMode = init.editorMode;
    if (init.setId) el.setId = init.setId;
    if (init.ticket) el.ticket = init.ticket;
    if (init.showCancel !== undefined) el.showCancel = init.showCancel;
    if (init.metadata !== undefined) el.metadata = init.metadata;

    el.addEventListener('save', function (e) { send('save', e.detail); });
    el.addEventListener('valuesChange', function (e) { send('valuesChange', e.detail); });
    el.addEventListener('cancel', function () { send('cancel', null); });

    document.getElementById('mds-root').appendChild(el);
    send('mounted', null);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== parentOrigin) return;
    var msg = e.data || {};
    if (msg.target !== 'mds-editor') return;
    if (msg.type === 'init') {
      customElements.whenDefined(TAG).then(function () { mount(msg.detail); });
    } else if (msg.type === 'setMetadata' && el) {
      el.metadata = msg.detail;
    }
  });

  // Announce readiness once the custom element has been registered by the bundle.
  customElements.whenDefined(TAG).then(function () { send('ready', null); });
})();
