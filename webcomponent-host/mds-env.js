// Sets window.__env from the ?api= query param before the bundle boots (an inline
// script would be blocked by the CSP).
(function () {
  var params = new URLSearchParams(location.search);
  var api = params.get('api');
  window.__env = window.__env || {};
  if (api) {
    window.__env.EDU_SHARING_API_URL = api;
  }
})();
