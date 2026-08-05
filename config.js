// Background config (loaded into the service worker). The sidebar app has its own
// copy in app-src/src/app/config.ts.

const EDU_SHARING_CONFIG = {
    // Metadata-Agent API, as the background worker falls back to it. Which agent actually applies
    // follows from the configured repository and is decided in the sidebar, which names it in every
    // /generate and /upload message (see MetadataAgentApiService) — this is only what a message
    // without one gets. The agent's own deployment, therefore: it needs no session, and the worker
    // has none to offer (the repository's proxy authorizes by session cookie, 401/403 without it).
    api: {
        localUrl: 'http://localhost:8000',
        url: 'https://metadata-agent-api.vercel.app',
    },

    // Default repository base (user-editable; /rest is appended by the auth layer).
    repository: {
        defaultUrl: 'https://repository.staging.openeduhub.net/edu-sharing'
    },

    network: {
        defaultTimeoutMs: 20000,
        generateTimeoutMs: 60000
    },

    getApiUrl() { return this.api.url; }
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
