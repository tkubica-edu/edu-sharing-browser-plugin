// Background config (loaded into the service worker). The sidebar app has its own
// copy in app-src/src/app/config.ts.

const EDU_SHARING_CONFIG = {
    // Metadata-Agent API (no auth); called only from the background worker.
    api: {
        url: 'https://metadata-agent-api.vercel.app',
        localUrl: 'http://localhost:8000'
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
