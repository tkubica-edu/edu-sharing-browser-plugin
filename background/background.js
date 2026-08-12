// Background worker: toggles the injected sidebar panel, extracts the active tab's
// content, and proxies the metadata agent's POST /generate (preceded by GET /health) and
// POST /upload (from the worker to stay CORS-portable). Auth is handled in the sidebar app,
// not here.

/* global EDU_SHARING_CONFIG, EDU_SHARING_DEV_FIXTURES */

/**
 * Fallback metadata agent, for a call that arrives without one. The agent is a repository's own
 * B-API proxy, and which repository that is belongs to the sidebar (see MetadataAgentApiService),
 * so it names the base in every message — this is what is used when it does not. The default
 * repository's proxy, which is what the sidebar currently names anyway.
 */
const API_URL = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.getApiUrl())
  || 'https://repository.staging.openeduhub.net/edu-sharing/rest/bapi/api/v1/proxy/metadata-agent-canvas';
const DEFAULT_TIMEOUT_MS = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.network?.defaultTimeoutMs) || 20000;
const GENERATE_TIMEOUT_MS = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.network?.generateTimeoutMs) || 60000;

// DEV MODE

/**
 * Where the dev mode's switch is stored, and what it is when nothing is stored: on. The same key the
 * sidebar's DevModeService reads and writes (`APP_CONFIG.storageKeys.devMode`) — the flag is one
 * setting for both, so the switch in the settings covers this worker as well.
 */
const DEV_MODE_STORAGE_KEY = 'eduSharingDevMode';
const DEV_MODE_DEFAULT = true;

/**
 * Delay before a faked answer arrives, so a caller sees the same asynchronous behaviour — spinner,
 * in-flight guard — as with the real agent. Small, since saving the wait is the point.
 */
const DEV_LATENCY_MS = 300;

/**
 * Whether the metadata agent's answers are faked instead of asked for (see EDU_SHARING_DEV_FIXTURES).
 *
 * Read per call rather than cached: the worker outlives the sidebar and is not restarted when the
 * switch is flipped, so a cached value would keep faking after the mode was turned off.
 */
async function devModeEnabled() {
  try {
    const items = await browser.storage.local.get({ [DEV_MODE_STORAGE_KEY]: DEV_MODE_DEFAULT });
    return items[DEV_MODE_STORAGE_KEY] !== false;
  } catch {
    return DEV_MODE_DEFAULT;
  }
}

/**
 * A fixture as an answer: a deep copy, delivered after {@link DEV_LATENCY_MS}. Copied because the
 * fixtures live for the worker's whole lifetime while a caller may write into what it got —
 * without this, one run's edit would be the next run's starting point.
 */
async function fakeAnswer(label, fixture) {
  await new Promise((resolve) => setTimeout(resolve, DEV_LATENCY_MS));
  console.log(`🧪 dev mode: ${label} faked`);
  return structuredClone(fixture);
}

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

/**
 * Fetch options for a call to the metadata agent, which sits behind the repository's own proxy and
 * authorizes by repository session (see MetadataAgentApiService).
 *
 * `credentials: 'include'` is what puts the session cookie on the request: a worker's fetch defaults
 * to `same-origin`, and the agent's base never is this worker's origin — so without it every call
 * arrives unauthenticated, however valid the panel's session is.
 */
function agentRequest(options = {}) {
  return { credentials: 'include', ...options };
}

async function safeJson(response) {
  try { return await response.json(); }
  catch { return null; }
}

/**
 * The metadata agent a message asks for, or {@link API_URL} when it names none. Only an absolute
 * http(s) base is accepted: the sender is trusted, but a malformed value would otherwise turn into
 * a request against this worker's own origin, which no agent answers.
 */
function agentBaseOf(message) {
  const url = typeof message?.apiUrl === 'string' ? message.apiUrl.trim() : '';
  return /^https?:\/\//i.test(url) ? url.replace(/\/+$/, '') : API_URL;
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

// PAGE SCREENSHOT
//
// The picture for a page that names none of its own: what the tab is showing. Taken in the worker
// because `captureVisibleTab` lives nowhere else — neither the content script nor the panel can
// reach it.

/** Encoding of the captured picture. A preview, so a small JPEG rather than a lossless PNG. */
const SCREENSHOT_TYPE = 'image/jpeg';
const SCREENSHOT_QUALITY = 0.7;

/** Widest the picture is kept, in pixels — a HiDPI display captures at a multiple of the CSS width. */
const SCREENSHOT_MAX_WIDTH = 1200;

/** Element id of the injected panel, as content/panel-host.js builds it. */
const PANEL_ELEMENT_ID = 'edusharing-panel-root';

/**
 * How much of the tab's viewport the page itself occupies, as a fraction of its width.
 *
 * The panel is docked INTO the page rather than beside it, so a capture of the viewport shows this
 * extension next to the content unless that share is cut away. A fraction rather than a pixel count:
 * the captured image is in device pixels, and their ratio to the CSS pixels measured here depends on
 * the display and on the page zoom.
 *
 * `null` when the page cannot be measured — then nothing is captured at all, since a picture that
 * might have the panel in it is worse than none.
 */
async function pageWidthFraction(tabId) {
  try {
    const [measured] = await browser.scripting.executeScript({
      target: { tabId },
      func: (panelId) => {
        const viewport = window.innerWidth || 0;
        const panel = document.getElementById(panelId);
        const taken = panel ? panel.getBoundingClientRect().width : 0;
        return viewport > 0 ? Math.max(0, (viewport - taken) / viewport) : 0;
      },
      args: [PANEL_ELEMENT_ID]
    });
    const fraction = measured?.result;
    return typeof fraction === 'number' && fraction > 0 ? fraction : null;
  } catch (error) {
    console.warn('⚠️ Measuring the page for a screenshot failed:', error?.message || error);
    return null;
  }
}

/** A blob as a data URL — the shape a picture travels to the panel in. */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => reject(reader.error ?? new Error('READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}

/**
 * A base64 data URL as a blob, decoded by hand rather than by `fetch`.
 *
 * `fetch` would be the short way and is the wrong one here: this worker runs under the extension's
 * own content security policy, whose `connect-src` names http and https — a request for a `data:`
 * URL is refused by it, which is what `captureVisibleTab` hands back.
 */
function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl ?? '');
  if (!match) throw new Error('NOT_A_DATA_URL');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

/** Cut a captured viewport down to the page's share of it and scale it to preview size. */
async function cropToPage(captured, fraction) {
  const bitmap = await createImageBitmap(dataUrlToBlob(captured));
  try {
    const width = Math.max(1, Math.round(bitmap.width * fraction));
    const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / width);
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(bitmap.height * scale))
    );
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, bitmap.height, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: SCREENSHOT_TYPE, quality: SCREENSHOT_QUALITY });
    return await blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

/**
 * The visible part of a tab as a picture, with the panel's share of the viewport cut away.
 *
 * Only the *visible* part: `captureVisibleTab` photographs the viewport, so this is the page as the
 * user has it in front of them, not the whole document. Deliberately not scrolled to the top first —
 * the page belongs to the user, and a capture must not move it under them.
 *
 * A bonus, never a reason for the analysis to fail: every failure answers `null` and the content
 * simply keeps having no picture.
 */
async function captureVisiblePage(tab) {
  try {
    const fraction = await pageWidthFraction(tab.id);
    if (fraction === null) return null;
    const captured = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80
    });
    const picture = await cropToPage(captured, fraction);
    console.log('📸 page screenshot:', Math.round((picture?.length ?? 0) / 1024), 'kB',
      '(page share of the viewport:', Math.round(fraction * 100) + '%)');
    return picture;
  } catch (error) {
    console.warn('⚠️ Screenshot of the page failed:', error?.message || error);
    return null;
  }
}

/** Whether an agent result already names a picture for the content it describes. */
function hasPreviewImage(result) {
  const named = Array.isArray(result?.preview_image_url)
    ? result.preview_image_url[0]
    : result?.preview_image_url;
  return typeof named === 'string' && named.trim().length > 0;
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
 * The agent sits behind the repository's `…/bapi/api/v1/proxy/metadata-agent-canvas`, which
 * authorizes by repository session. A base that is wrong, or a session the proxy refuses, would
 * otherwise only show up as a failing /generate — after the full generate timeout, and reported as
 * if the extraction had failed. The health call turns that into an immediate, unambiguous answer,
 * and it carries the session like the call it guards.
 */
async function callHealth(apiUrl) {
  if (await devModeEnabled()) return fakeAnswer('GET /health', EDU_SHARING_DEV_FIXTURES.agentHealth);
  const url = `${apiUrl}/health`;
  let response;
  try {
    response = await fetchWithTimeout(url, agentRequest({ headers: { 'Accept': 'application/json' } }));
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

async function callGenerate(body, apiUrl) {
  // First health, then generate: no point sending an extraction to a base that is not answering.
  await callHealth(apiUrl);
  if (await devModeEnabled()) {
    return fakeAnswer('POST /generate', EDU_SHARING_DEV_FIXTURES.agentGenerate);
  }
  const response = await fetchWithTimeout(
    `${apiUrl}/generate`,
    agentRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }),
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
async function callUpload(body, apiUrl) {
  const response = await fetchWithTimeout(
    `${apiUrl}/upload`,
    agentRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }),
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
          const result = await callGenerate(body, agentBaseOf(message));
          // Only for a page that names no picture of its own: what a page states about itself
          // describes it better than a photograph of how it happens to be rendered right now.
          const screenshot = hasPreviewImage(result) ? null : await captureVisiblePage(tab);
          return {
            success: true,
            result,
            source: {
              url: pageData?.url || tab.url,
              title: pageData?.title || tab.title,
              favIconUrl: tab.favIconUrl,
              screenshot: screenshot ?? undefined
            }
          };
        }

        // POST an upload body assembled by the sidebar to /upload — the metadata agent's own way
        // of writing the curated content into the repository.
        case 'metadata.upload': {
          const result = await callUpload(message.body ?? {}, agentBaseOf(message));
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

console.log('✅ edu-sharing background ready. API fallback:', API_URL);
