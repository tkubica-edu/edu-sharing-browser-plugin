// Background worker: toggles the injected sidebar panel, extracts the active tab's
// content, and proxies the metadata agent's POST /generate (preceded by GET /health) and
// POST /nodes (from the worker to stay CORS-portable). Auth is handled in the sidebar app,
// not here.

/* global EDU_SHARING_CONFIG, EDU_SHARING_DEV_FIXTURES */

/**
 * Fallback metadata agent for a call that arrives without one: which repository's B-API proxy the agent is belongs to
 * the sidebar, so it names the base in every message. This is what is used when it does not.
 */
const API_URL = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.getApiUrl())
  || 'https://repository.staging.openeduhub.net/edu-sharing/rest/bapi/api/v1/proxy/metadata-agent-canvas';
const DEFAULT_TIMEOUT_MS = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.network?.defaultTimeoutMs) || 20000;
const GENERATE_TIMEOUT_MS = (typeof EDU_SHARING_CONFIG !== 'undefined' && EDU_SHARING_CONFIG.network?.generateTimeoutMs) || 60000;

// DEV MODE

/**
 * Where the dev mode's switch is stored, and what it is when nothing is stored: off. The same key the
 * sidebar's DevModeService reads and writes (`APP_CONFIG.storageKeys.devMode`) — the flag is one
 * setting for both, so the switch in the settings covers this worker as well.
 */
const DEV_MODE_STORAGE_KEY = 'eduSharingDevMode';
const DEV_MODE_DEFAULT = false;

/**
 * Which of the faked `/generate` answers a run is answered with (`EDU_SHARING_DEV_FIXTURES.agentGenerate`). The
 * sidebar writes the key, this reads it; an unknown or unset one falls back to the first fixture, so a stored
 * value naming a content that has since been removed still answers.
 */
const DEV_MODE_GENERATE_STORAGE_KEY = 'eduSharingDevModeGenerate';

/**
 * Delay before a faked answer arrives, so a caller sees the same asynchronous behaviour — spinner,
 * in-flight guard — as with the real agent. Small, since saving the wait is the point.
 */
const DEV_LATENCY_MS = 300;

/**
 * Whether the metadata agent's answers are faked instead of asked for. Read per call rather than cached: the worker
 * outlives the sidebar and is not restarted when the switch is flipped.
 */
async function devModeEnabled() {
  try {
    const items = await browser.storage.local.get({ [DEV_MODE_STORAGE_KEY]: DEV_MODE_DEFAULT });
    return items[DEV_MODE_STORAGE_KEY] === true;
  } catch {
    return DEV_MODE_DEFAULT;
  }
}

/**
 * The faked erschlossener Inhalt a run answers with: the one the dev mode names, else the first there is.
 * Named rather than positional, so the sidebar's select and the fixtures agree by key.
 */
async function devModeGenerate() {
  const fixtures = EDU_SHARING_DEV_FIXTURES.agentGenerate;
  let picked = null;
  try {
    const items = await browser.storage.local.get({ [DEV_MODE_GENERATE_STORAGE_KEY]: '' });
    picked = items[DEV_MODE_GENERATE_STORAGE_KEY];
  } catch {
    // No storage to read: the first fixture is as good an answer as any.
  }
  const key = picked && fixtures[picked] ? picked : Object.keys(fixtures)[0];
  return { key, fixture: fixtures[key] };
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
 * Fetch options for a call to the metadata agent, which sits behind the repository's own proxy and authorizes by
 * repository session. `credentials: 'include'` is what puts the session cookie on the request — a worker's fetch
 * defaults to `same-origin`, and the agent's base never is this worker's origin.
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
// The panel is an iframe injected into the page, so every navigation destroys it. Being open is therefore a property
// of the tab: while it holds, this worker puts the panel back after every load. panel-host.js decides and reports
// that state; this only remembers it, in storage, because an MV3 worker is evicted between events.

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

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Wait for the new document: injecting into a still-loading page would be torn down by it.
  if (changeInfo.status === 'complete') void restorePanel(tabId);
  // A URL change, which is NOT always a new document: edu-sharing routes in place (History API), so
  // the page becomes another one while the panel keeps running on the URL it booted with. This is
  // the only party that sees that happen, so it says so. The title is announced along with it, and on
  // its own too: it usually arrives after the URL it belongs to, and a page in-place routing may
  // change nothing else.
  if (changeInfo.url || changeInfo.title) {
    void announceUrl(tabId, changeInfo.url || tab?.url, tab?.title);
  }
});

/**
 * Tell the sidebar what page the tab is on. A broadcast to the extension's own pages, so it names the tab it is about
 * and only the panel sitting there acts on it. Having no listener is not an error — a tab whose panel is closed has
 * nobody to tell.
 */
function announceUrl(tabId, url, title) {
  if (!url) return Promise.resolve();
  return browser.runtime.sendMessage({ action: 'tab.url', tabId, url, title }).catch(() => {});
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
 * How much of the tab's viewport the page itself occupies, as a fraction of its width: the panel is docked into the
 * page, so a capture would show this extension next to the content. A fraction rather than a pixel count, since the
 * captured image is in device pixels. Null where the page cannot be measured, and then nothing is captured at all.
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
 * A base64 data URL as a blob, decoded by hand rather than by `fetch`: this worker runs under the extension's own
 * content security policy, whose `connect-src` names http and https, so a request for a `data:` URL is refused.
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
 * The visible part of a tab as a picture, with the panel's share of the viewport cut away. Only the visible part, and
 * deliberately not scrolled to the top first — the page belongs to the user, and a capture must not move it under
 * them. A bonus, never a reason for the analysis to fail: every failure answers null.
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

/** The fields an agent result states the content's picture by, as an address of one. */
const PICTURE_ADDRESS_FIELDS = ['preview_image_url', 'preview:url'];

/** The picture addresses a page states about itself, in the order the extraction reads them. */
function pageImageUrls(pageData) {
  const images = pageData?.images ?? {};
  return [images.ogImage?.url, images.heroImage?.url, images.twitterImage?.url].filter(
    (url) => typeof url === 'string' && url.trim().length > 0
  );
}

/** The file a picture address ends in — the part of it that says WHICH picture it is. */
function pictureFileOf(url) {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)).toLowerCase();
  } catch (error) {
    return '';
  }
}

/**
 * A picture address as the page itself states it: the agent's result carries an address it read out of
 * the page text, and such a transcription can come back altered — an address whose path never existed
 * answers with an error where the page's own loads. The pictures are matched by their file, so which
 * one the agent chose stands; an address matching none of the page's is kept as it is.
 */
function pageStatedPicture(named, pageData) {
  if (named.startsWith('data:')) return named;
  const file = pictureFileOf(named);
  if (!file) return named;
  return pageImageUrls(pageData).find((url) => pictureFileOf(url) === file) ?? named;
}

/**
 * The agent's result with every picture address it names corrected against the page's own — see
 * {@link pageStatedPicture}. The field keeps the shape it arrived in: the agent states an address as a
 * bare string or as a single-valued list, and the panel reads both.
 */
function withPageStatedPictures(result, pageData) {
  let corrected = result;
  for (const field of PICTURE_ADDRESS_FIELDS) {
    const stated = corrected?.[field];
    const named = Array.isArray(stated) ? stated[0] : stated;
    if (typeof named !== 'string' || !named.trim()) continue;
    const fromPage = pageStatedPicture(named.trim(), pageData);
    if (fromPage === named.trim()) continue;
    console.log('🖼️ picture address corrected to the one the page states:', field, fromPage);
    corrected = {
      ...corrected,
      [field]: Array.isArray(stated) ? [fromPage, ...stated.slice(1)] : fromPage
    };
  }
  return corrected;
}

// /generate PROXY

/**
 * The content-type schema every extraction is filled against, named by its file as the agent expects it. Named rather
 * than left to the endpoint's own `auto`, which would let the agent pick a profile per page — the panel curates
 * learning material. `include_core` adds the core fields beside it.
 */
const GENERATE_SCHEMA_FILE = 'learning_material.json';

// Build the /generate request body: prefer text mode, fall back to URL mode.
function buildGenerateBody(pageData, language) {
  const text = pageData?.formattedText || pageData?.mainContent || pageData?.text || '';
  const lang = language || pageData?.meta?.language || 'de';
  if (text && text.trim().length > 50) {
    return {
      text,
      context: 'default',
      version: 'latest',
      schema_file: GENERATE_SCHEMA_FILE,
      language: lang,
      include_core: true,
      enable_geocoding: true
    };
  }
  return buildUrlGenerateBody(pageData?.url || '', lang);
}

/**
 * The /generate body for a page named by its address alone — the agent fetches and reads it itself. For a content
 * whose page is not the one the browser shows: it is erschlossen where it lives, not where the user happens to be.
 */
function buildUrlGenerateBody(url, language) {
  return {
    input_source: 'url',
    text: '',
    source_url: url,
    extraction_method: 'browser',
    context: 'default',
    version: 'latest',
    schema_file: GENERATE_SCHEMA_FILE,
    language: language || 'de',
    include_core: true,
    enable_geocoding: true,
    normalize: true
  };
}

/**
 * `GET /health` — asked before every /generate. The agent sits behind the repository's proxy, which authorizes by
 * repository session, so a wrong base or a refused session would otherwise only show up after the full generate
 * timeout and read as a failed extraction. This turns that into an immediate answer, and carries the session too.
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
    const { key, fixture } = await devModeGenerate();
    return fakeAnswer(`POST /generate (${key})`, fixture);
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

// /nodes PROXY

// POST a node body to the metadata agent, which writes the content into the repository itself: it
// creates the node when the body names none and updates the one it names otherwise, and runs the
// collections and workflow steps the body asks for. Proxied through the worker for the same reason
// as /generate: the endpoint is cross-origin for the sidebar document.
async function callSaveNode(body, apiUrl) {
  const response = await fetchWithTimeout(
    `${apiUrl}/nodes`,
    agentRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }),
    GENERATE_TIMEOUT_MS
  );
  // A refused write answers with a JSON body too — `success: false`, or FastAPI's `detail` for a
  // node this endpoint will not touch (403 outside its edit window, 404 for an unknown one). So the
  // payload is read either way and only a bodyless failure becomes an error.
  const result = await safeJson(response);
  if (!result || typeof result !== 'object') {
    throw new Error(`nodes failed: ${response.status}`);
  }
  // FastAPI states a refusal as `{ detail }` and says nothing about success — read as the failure
  // it is, so the caller does not have to know this endpoint's two answer shapes.
  if (!response.ok && result.success === undefined) {
    return { success: false, error: String(result.detail ?? `HTTP ${response.status}`) };
  }
  return result;
}

// MESSAGE ROUTER (from the Angular sidebar app)

const ALLOWED_ACTIONS = new Set([
  'runtime.ping',
  'panel.state',
  'tabs.self',
  'tabs.getActive',
  'tabs.extractPageData',
  'tabs.navigate',
  'analyze.run',
  'analyze.url',
  'metadata.saveNode'
]);

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || !ALLOWED_ACTIONS.has(message.action)) return; // not ours

  // Return a promise so the polyfill replies asynchronously.
  return (async () => {
    try {
      switch (message.action) {
        // Nothing but an answer, for a caller that wants to know there is a worker listening. The
        // browser stops this worker between messages and starts it again for the next one; a message
        // that must not be sent twice is preceded by this one, whose answer may be dropped for free
        // (see BrowserExtensionService.wake).
        case 'runtime.ping': {
          return { success: true };
        }

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
          // The page states the addresses of its own pictures; the result only transcribes them, so
          // what it names is read back against the page (see {@link withPageStatedPictures}).
          const result = withPageStatedPictures(
            await callGenerate(body, agentBaseOf(message)),
            pageData
          );
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

        // POST a named page to /generate, for a content whose page the browser is not on: the agent
        // fetches and reads it itself, so nothing here depends on the active tab (see analyze.run).
        case 'analyze.url': {
          const url = typeof message.url === 'string' ? message.url : '';
          if (!/^https?:\/\//i.test(url)) return { success: false, error: 'UNSUPPORTED_PAGE' };
          const result = await callGenerate(buildUrlGenerateBody(url, message.language), agentBaseOf(message));
          // No screenshot: the page is not on screen, and its own picture is all there is to go by.
          return { success: true, result, source: { url, title: message.title || url } };
        }

        // POST a node body assembled by the sidebar to /nodes — the metadata agent's own way of
        // writing the curated content into the repository, for creating it and for every update.
        case 'metadata.saveNode': {
          const result = await callSaveNode(message.body ?? {}, agentBaseOf(message));
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
