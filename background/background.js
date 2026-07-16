// Background worker: toggles the injected sidebar panel, extracts the active tab's
// content, and proxies POST /generate (from the worker to stay CORS-portable).
// Auth is handled in the sidebar app, not here.

/* global EDU_SHARING_CONFIG */

const API_URL = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.getApiUrl())
  || 'https://metadata-agent-api.vercel.app';
const DEFAULT_TIMEOUT_MS = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.network?.defaultTimeoutMs) || 20000;
const GENERATE_TIMEOUT_MS = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.network?.generateTimeoutMs) || 60000;

// FETCH HELPERS

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response) {
  try { return await response.json(); }
  catch { return null; }
}

// PANEL TOGGLE (toolbar button)

async function togglePanel(tab) {
  if (!tab || typeof tab.id !== 'number') return;
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/panel-host.js']
    });
  } catch (error) {
    // Privileged pages reject injection → open the sidebar as a full tab instead.
    console.warn('⚠️ Panel injection failed, opening in tab:', error?.message || error);
    try {
      await browser.tabs.create({ url: browser.runtime.getURL('sidebar/index.html') });
    } catch (e) { console.error('❌ Fallback tab open failed:', e); }
  }
}

browser.action.onClicked.addListener((tab) => { togglePanel(tab); });

// ACTIVE TAB + ON-DEMAND CONTENT EXTRACTION

async function getActiveNormalTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab) throw new Error('NO_ACTIVE_TAB');
  return tab;
}

async function extractPageDataFromTab(tabId) {
  if (typeof tabId !== 'number') throw new Error('NO_TAB_ID');
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    const result = results?.[0]?.result;
    if (!result || typeof result !== 'object') throw new Error('EMPTY_EXTRACTION');
    return result;
  } catch (e) {
    throw new Error(e?.message || 'EXTRACTION_FAILED');
  }
}

// /generate PROXY

// Build the /generate request body: prefer text mode, fall back to URL mode.
function buildGenerateBody(pageData, language) {
  const text = pageData?.formattedText || pageData?.mainContent || pageData?.text || '';
  const lang = language || pageData?.meta?.language || 'de';
  if (text && text.trim().length > 50) {
    return {
      text,
      context: 'default',
      version: 'latest',
      language: lang,
      include_core: true,
      enable_geocoding: true
    };
  }
  return {
    input_source: 'url',
    text: '',
    source_url: pageData?.url || '',
    extraction_method: 'browser',
    context: 'default',
    version: 'latest',
    language: lang,
    include_core: true,
    enable_geocoding: true,
    normalize: true
  };
}

async function callGenerate(body) {
  const response = await fetchWithTimeout(
    `${API_URL}/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    },
    GENERATE_TIMEOUT_MS
  );
  if (!response.ok) {
    const errorText = (await response.text().catch(() => '')).substring(0, 300);
    throw new Error(`generate failed: ${response.status} - ${errorText}`);
  }
  const result = await safeJson(response);
  if (!result || typeof result !== 'object') throw new Error('generate: invalid API response');
  return result;
}

// MESSAGE ROUTER (from the Angular sidebar app)

const ALLOWED_ACTIONS = new Set([
  'tabs.getActive',
  'tabs.extractPageData',
  'analyze.run'
]);

browser.runtime.onMessage.addListener((message) => {
  if (!message || !ALLOWED_ACTIONS.has(message.action)) return; // not ours

  // Return a promise so the polyfill replies asynchronously.
  return (async () => {
    try {
      switch (message.action) {
        case 'tabs.getActive': {
          const tab = await getActiveNormalTab();
          return { success: true, tab: { id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } };
        }

        case 'tabs.extractPageData': {
          const tabId = typeof message.tabId === 'number' ? message.tabId : (await getActiveNormalTab()).id;
          const data = await extractPageDataFromTab(tabId);
          return { success: true, data };
        }

        // Extract the active tab and POST it to /generate.
        case 'analyze.run': {
          const tab = await getActiveNormalTab();
          if (!tab.url || /^(chrome|edge|about|chrome-extension|moz-extension|safari-web-extension):/.test(tab.url)) {
            return { success: false, error: 'UNSUPPORTED_PAGE' };
          }
          const pageData = await extractPageDataFromTab(tab.id);
          const body = buildGenerateBody(pageData, message.language);
          const result = await callGenerate(body);
          return {
            success: true,
            result,
            source: { url: pageData?.url || tab.url, title: pageData?.title || tab.title, favIconUrl: tab.favIconUrl }
          };
        }

        default:
          return { success: false, error: 'UNKNOWN_ACTION' };
      }
    } catch (error) {
      console.error('❌ background action failed:', message.action, error?.message || error);
      return { success: false, error: String(error?.message || error) };
    }
  })();
});

console.log('✅ edu-sharing background ready. API:', API_URL);
