/**
 * The inbound half of the host plugin's wire contract (OnlyOffice): the source marker every envelope carries and the
 * payloads this app reads out of it; see `content/HOST-EVENTS.md` for the full event documentation. It lives apart from
 * `OnlyOfficeDocumentService` because the debug simulator fabricates the same envelopes.
 */

/** Sender id of the OnlyOffice plugin messages relayed by content/panel-host.js. */
export const PLUGIN_SOURCE = 'edu-sharing-onlyoffice-plugin';

/**
 * Identity of the document the host has open, as the plugin announces it; null where the editor was opened with a
 * stale plugin config, so always treat it as optional. Deliberately just the node id, and it is the edited node —
 * the connector resolves a collection reference to its original before reporting it.
 */
export interface DocumentIdentity {
  nodeId?: string;
}

/**
 * The `DOCUMENT_CONTENT` payload. Only the fields this app consumes are typed — `markdown` is
 * the one it feeds to the metadata agent; `html`, `documentJson`, `elements` etc. are carried
 * along untyped. Answers can also be one of the two error forms.
 */
export interface DocumentContent {
  trigger?: 'toolbar' | 'request' | 'announce';
  requestId?: string;
  editorType?: string;
  title?: string;
  text?: string;
  markdown?: string;
  document?: DocumentIdentity | null;
  /** Set when the editor is not a text document (spreadsheet, presentation). */
  unsupported?: boolean;
  /** Set when the plugin failed to read the document. */
  error?: string;
  [field: string]: unknown;
}

/** An inbound envelope relayed by content/panel-host.js. */
export interface PluginEnvelope {
  event?: string;
  data?: DocumentContent;
  document?: DocumentIdentity | null;
}

/**
 * Which of the two document requests to send: the content of the open document, or its identity
 * only. Not part of the wire format — it picks the `REQUEST_DOCUMENT_*` event to fire.
 */
export type DocumentRequestKind = 'content' | 'info';
