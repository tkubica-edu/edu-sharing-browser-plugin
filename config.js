// Background config (loaded into the service worker). The sidebar app has its own
// copy in app-src/src/app/config.ts.

const EDU_SHARING_CONFIG = {
    // Default repository base (user-editable; /rest is appended by the auth layer).
    repository: {
        defaultUrl: 'https://repository.staging.openeduhub.net/edu-sharing'
    },

    // Where a repository proxies the metadata agent, relative to its base — the B-API endpoint that
    // /health, /generate and /upload are appended to.
    agentProxyPath: '/rest/bapi/api/v1/proxy/metadata-agent-canvas',

    network: {
        defaultTimeoutMs: 20000,
        generateTimeoutMs: 60000
    },

    // The agent of the DEFAULT repository, for a worker message that names no base. The sidebar
    // names the base in every /generate and /upload message and currently pins it to this same
    // repository (see MetadataAgentApiService) — so this is the fallback, not a second answer.
    getApiUrl() {
        return this.repository.defaultUrl.replace(/\/+$/, '') + this.agentProxyPath;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EDU_SHARING_CONFIG;
}

// Expose on the global scope for the service worker / background script.
if (typeof self !== 'undefined') { self.EDU_SHARING_CONFIG = EDU_SHARING_CONFIG; }

console.log('🔧 edu-sharing config loaded:', {
    api: EDU_SHARING_CONFIG.getApiUrl(),
    repository: EDU_SHARING_CONFIG.repository.defaultUrl
});
