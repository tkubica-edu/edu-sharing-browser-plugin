// Background worker: toggles the injected sidebar panel, extracts the active tab's
// content, and proxies the metadata agent's POST /generate (preceded by GET /health) and
// POST /upload (from the worker to stay CORS-portable). Auth is handled in the sidebar app,
// not here.

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

// PANEL SURVIVAL ACROSS A PAGE CHANGE
//
// The panel is an iframe injected INTO the page, so EVERY navigation destroys it — a link the user
// clicks just as much as a page change the panel asked for itself. Being open is therefore treated
// as a property of the TAB, not of the document: while it holds, this worker puts the panel back
// after every load. Only the worker outlives a load, so this is its job.
//
// panel-host.js reports the state it puts the page into ('panel.state'), so opening and closing stay
// in one place — the content script decides, this only remembers. The state lives in storage, not in
// a variable: an MV3 worker is evicted between events.

const OPEN_PANELS_KEY = 'eduSharingOpenPanels';

/** Session storage where available — being open belongs to this browser run, not to the profile. */
function panelStateArea() {
  return browser.storage.session ?? browser.storage.local;
}

async function readOpenPanels() {
  try {
    const items = await panelStateArea().get({ [OPEN_PANELS_KEY]: [] });
    return Array.isArray(items?.[OPEN_PANELS_KEY]) ? items[OPEN_PANELS_KEY] : [];
  } catch (error) {
    console.warn('⚠️ Reading the open-panel state failed:', error?.message || error);
    return [];
  }
}

async function setPanelOpen(tabId, open) {
  if (typeof tabId !== 'number') return;
  const tabs = await readOpenPanels();
  if (open === tabs.includes(tabId)) return;
  const next = open ? [...tabs, tabId] : tabs.filter((id) => id !== tabId);
  try {
    await panelStateArea().set({ [OPEN_PANELS_KEY]: next });
  } catch (error) {
    console.warn('⚠️ Storing the open-panel state failed:', error?.message || error);
  }
}

/** Put the panel back on a tab whose panel is meant to be open. */
async function restorePanel(tabId) {
  if (!(await readOpenPanels()).includes(tabId)) return;
  try {
    // panel-host.js TOGGLES, so injecting it onto a page that still has a panel would close it.
    // `complete` is not guaranteed to arrive once per document, hence the check rather than trust.
    const [present] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => !!document.getElementById('edusharing-panel-root')
    });
    if (present?.result) return;
    await browser.scripting.executeScript({ target: { tabId }, files: ['content/panel-host.js'] });
  } catch (error) {
    // A privileged page rejects injection — no panel can live there. The tab stays marked open, so
    // navigating back to a normal page brings it back.
    console.warn('⚠️ Panel restore failed:', error?.message || error);
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Wait for the new document: injecting into a still-loading page would be torn down by it.
  if (changeInfo.status === 'complete') void restorePanel(tabId);
  // A URL change, which is NOT always a new document: edu-sharing routes in place (History API), so
  // the page becomes another one while the panel keeps running on the URL it booted with. This is
  // the only party that sees that happen, so it says so.
  if (changeInfo.url) void announceUrl(tabId, changeInfo.url);
});

/**
 * Tell the sidebar the tab's URL changed.
 *
 * A broadcast to the extension's own pages, so it names the tab it is about — every open panel hears
 * it and only the one sitting in that tab acts on it (see BrowserExtensionService.announcedUrl).
 * Having no listener is not an error: a tab whose panel is closed has nobody to tell.
 */
function announceUrl(tabId, url) {
  return browser.runtime.sendMessage({ action: 'tab.url', tabId, url }).catch(() => {});
}

// A closed tab's id tells us nothing anymore, and ids get reused — drop everything keyed by it.
browser.tabs.onRemoved.addListener((tabId) => {
  void setPanelOpen(tabId, false);
  // Same key the sidebar app builds (see SessionResumeService); without this, its per-tab entries
  // would pile up in storage for the rest of the browser run.
  browser.storage.local.remove(`eduSharingResumeState:${tabId}`).catch(() => {});
});

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

/**
 * `GET /health` — asked BEFORE every /generate.
 *
 * The agent is reachable under two very different bases (see config.js): its own deployment, or the
 * repository's `…/bapi/api/v1/proxy/metadata-agent-canvas`, where the endpoint authorizes by
 * repository session. A misconfigured or unauthorized base then only shows up as a failing
 * /generate — after the full generate timeout, and reported as if the extraction had failed. The
 * health call turns that into an immediate, unambiguous answer.
 */
async function callHealth() {
  const url = `${API_URL}/health`;
  let response;
  try {
    response = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } });
  } catch (error) {
    throw new Error(`Metadata-Agent nicht erreichbar (${url}): ${error?.message || error}`);
  }
  if (!response.ok) {
    const errorText = (await response.text().catch(() => '')).substring(0, 300);
    throw new Error(`Metadata-Agent nicht bereit: ${response.status} - ${errorText}`);
  }
  const result = await safeJson(response);
  console.log('✅ metadata-agent health:', result?.version || result?.status || 'ok');
  return result;
}

async function callGenerate(body) {
  // First health, then generate: no point sending an extraction to a base that is not answering.
  await callHealth();
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

// /upload PROXY

// POST an assembled upload body to the metadata agent, which writes the content into the
// repository itself (duplicate check + workflow). Proxied through the worker for the same reason
// as /generate: the endpoint is cross-origin for the sidebar document.
async function callUpload(body) {
  const response = await fetchWithTimeout(
    `${API_URL}/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    },
    GENERATE_TIMEOUT_MS
  );
  // A rejected upload answers with a JSON body too (`success: false`), so the payload is read
  // either way and only a bodyless failure becomes an error.
  const result = await safeJson(response);
  if (!result || typeof result !== 'object') {
    throw new Error(`upload failed: ${response.status}`);
  }
  return result;
}

// MESSAGE ROUTER (from the Angular sidebar app)

const ALLOWED_ACTIONS = new Set([
  'panel.state',
  'tabs.self',
  'tabs.getActive',
  'tabs.extractPageData',
  'tabs.navigate',
  'analyze.run',
  'metadata.upload'
]);

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || !ALLOWED_ACTIONS.has(message.action)) return; // not ours

  // Return a promise so the polyfill replies asynchronously.
  return (async () => {
    try {
      switch (message.action) {
        // panel-host.js reporting what it just did. The tab comes from the SENDER, never from the
        // message: which tab a content script speaks for is not its own to claim.
        case 'panel.state': {
          await setPanelOpen(sender?.tab?.id, message.open === true);
          return { success: true };
        }

        // Which tab the CALLER sits in. The sidebar needs it to keep its state per tab; it cannot
        // work that out itself, and "the active tab" is not the same thing — a panel restored on a
        // background tab would read the wrong one.
        case 'tabs.self': {
          return { success: true, tabId: typeof sender?.tab?.id === 'number' ? sender.tab.id : null };
        }

        case 'tabs.getActive': {
          const tab = await getActiveNormalTab();
          return { success: true, tab: { id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } };
        }

        // Take the active tab to another URL and bring the panel back on the new page. Queued
        // BEFORE the navigation: the load starts immediately and takes the caller down with it.
        case 'tabs.navigate': {
          const url = typeof message.url === 'string' ? message.url : '';
          if (!/^https?:\/\//i.test(url)) return { success: false, error: 'INVALID_URL' };
          const tab = await getActiveNormalTab();
          // The panel is what asked, so it is open — recorded explicitly in case that state was lost.
          await setPanelOpen(tab.id, true);
          await browser.tabs.update(tab.id, { url });
          return { success: true };
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

        // POST an upload body assembled by the sidebar to /upload — the metadata agent's own way
        // of writing the curated content into the repository.
        case 'metadata.upload': {
          const result = await callUpload(message.body ?? {});
          return { success: true, result };
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
