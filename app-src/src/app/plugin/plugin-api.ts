// The public contract between the extension and externally loaded code. The extension
// exposes `window.eduSharingPlugin` (see AdditionalWebComponentService); the loaded code
// (or the iframe postMessage bridge) calls it to contribute menu options and to reach the
// host's page context and actions.

import { AnalyzeResult } from '../services/ext.service';
import { Conditions, OptionIcon, OptionView } from '../model/options';

/** Auth snapshot handed to contributed code. */
export interface PluginUserInfo {
  isLoggedIn: boolean;
  guest: boolean;
  username: string | null;
}

/** The active node, if one has been erschlossen / loaded. */
export interface PluginNode {
  nodeId: string;
  name: string;
  link: string;
}

/** Everything a contributed view may need about the current host context. */
export interface PluginContext {
  activeUrl: string | null;
  repositoryUrl: string;
  node: PluginNode | null;
  metadata: Record<string, unknown> | null;
  userInfo: PluginUserInfo;
}

/** The shape contributed code passes to registerOption(). `view` absent ⇒ the option
 *  reuses a built-in screen (only meaningful when replacing a built-in id). */
export interface PluginOptionInput {
  id: string;
  label: string;
  description?: string;
  icon?: string | OptionIcon;
  /** Custom show predicate; receives the same Conditions the built-in options see. */
  visible?: (c: Conditions) => boolean;
  bypassLogin?: boolean;
  view?: OptionView;
}

/** The global API surface exposed on `window.eduSharingPlugin`. */
export interface EduSharingPluginApi {
  readonly version: string;
  /** Add a new option or replace a built-in/contributed one by id. */
  registerOption(opt: PluginOptionInput): void;
  /** Make the repository login optional (guest flows handled by the loaded code). */
  disableLoginRequirement(): void;
  /** Read the current host context synchronously. */
  getContext(): PluginContext;
  /** Subscribe to host-context changes; returns an unsubscribe function. */
  onContext(cb: (c: PluginContext) => void): () => void;
  /** Run the extension's page analysis for the active tab (background-delegated). */
  requestPageExtraction(): Promise<AnalyzeResult>;
  /** Forward selected node(s) to the host page (e.g. OnlyOffice insert). */
  insertNodes(nodes: unknown[]): void;
}

declare global {
  interface Window {
    eduSharingPlugin?: EduSharingPluginApi;
    /** Env consumed by some embedded bundles (e.g. metadata-agent-canvas) before boot. */
    __ENV?: Record<string, string>;
  }
}
