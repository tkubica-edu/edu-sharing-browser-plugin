// Bridges the sidebar and the edu-sharing bundle in this iframe: creates
// <edu-sharing-nodes-selector> as a collection picker and relays the collection
// the user confirms back to the sidebar.
//
// The selector's contract is callback-based (option.optionConfig.onNodesChoosen),
// and functions cannot cross the postMessage boundary — so the callbacks are
// defined HERE, inside the iframe, and only the chosen collection (a plain,
// serialisable {id, name}) is posted back. The sidebar then performs the actual
// "add to collection" via ngx-edu-sharing-api.
(function () {
  var TAG = 'edu-sharing-nodes-selector';
  var parentOrigin = location.origin; // parent iframe is same (extension) origin
  var el = null;

  function send(type, detail) {
    try { parent.postMessage({ source: 'nodes-selector', type: type, detail: detail }, parentOrigin); }
    catch (e) { /* ignore */ }
  }

  // Reduce edu-sharing Node objects to the minimal, serialisable shape the sidebar
  // needs to add a reference (the collection id + a display name).
  function toChoice(nodes) {
    return (nodes || [])
      .map(function (n) { return { id: n && n.ref && n.ref.id, name: n && n.name }; })
      .filter(function (c) { return !!c.id; });
  }

  function mount(init) {
    if (el) return;
    init = init || {};
    el = document.createElement(TAG);
    // Signal @Input()s are exposed as element properties by Angular Elements.
    // `state:'collections'` opens the Collections tab; `onNodesChoosen` fires when
    // the user confirms with the selector's apply ("insert") button.
    el.option = {
      optionConfig: {
        state: 'collections',
        applyLabel: init.applyLabel || 'In Sammlung einfügen',
        autoClose: false,
        // Enables the apply button only once a collection is picked.
        applyCallback: function (nodes) { return Array.isArray(nodes) && nodes.length > 0; },
        // The confirm hook: relay the chosen collection(s) to the sidebar.
        onNodesChoosen: function (e) { send('choose', toChoice(e && e.nodes)); }
      }
    };
    el.primaryMode = 'collections';

    document.getElementById('selector-root').appendChild(el);
    send('mounted', null);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== parentOrigin) return;
    var msg = e.data || {};
    if (msg.target !== 'nodes-selector') return;
    if (msg.type === 'init') {
      customElements.whenDefined(TAG).then(function () { mount(msg.detail); });
    }
  });

  // Announce readiness once the custom element has been registered by the bundle.
  customElements.whenDefined(TAG).then(function () { send('ready', null); });
})();
