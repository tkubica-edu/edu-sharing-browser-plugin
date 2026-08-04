import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionServiceUnwrapped, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { DocumentIdentity } from '../model/onlyoffice-events';
import { MdsValues } from '../util/mds-values';
import { errorMessage } from '../util/errors';
import { renderLink } from '../util/repository-links';
import { AuthService } from './auth.service';
import { HistoryEntry, HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';
import { NodeSummary, RepositoryNodeService } from './repository-node.service';

/** A collection the content was added to. */
export interface Collection {
  id: string;
  name: string;
}

/**
 * The node the app currently works on, plus its link into the repository UI.
 *
 * `name` is **`null` while the node's real name is unknown** (its load failed). It must never be
 * substituted with the node id: the name carries the document's file name incl. extension and is
 * written back as `cm:name` on save, so a placeholder would rename the document — see
 * {@link save} and `RepositoryNodeService.update`.
 */
export interface ActiveNode {
  nodeId: string;
  name: string | null;
  link: string;
}

// Node state and actions for the content options (analyze / metadata / preview / collections).
// Navigation between options lives in NavigationService and ActionBarService — this service
// only owns the node and its side-effecting operations.
@Injectable({ providedIn: 'root' })
export class CurationService {
  private readonly auth = inject(AuthService);
  private readonly metadataAgent = inject(MetadataAgentService);
  private readonly repositoryNodes = inject(RepositoryNodeService);
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);
  private readonly history = inject(HistoryService);
  // The generated CollectionV1Service (exported as CollectionServiceUnwrapped) — the read-only
  // CollectionService wrapper does not cover adding a node.
  private readonly collections = inject(CollectionServiceUnwrapped);

  readonly activeNode = signal<ActiveNode | null>(null);
  /** The active node's stored properties, fed to the metadata editor. */
  readonly nodeMetadata = signal<MdsValues | null>(null);
  /** The full hydrated node, fed to the preview element. */
  readonly previewNode = signal<Node | null>(null);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly assigning = signal(false);
  readonly assignError = signal<string | null>(null);
  readonly assignedCollections = signal<readonly Collection[]>([]);

  readonly running = this.metadataAgent.running;

  /** Set while a generated result still waits to be saved; see {@link hasUnsavedWork}. */
  private readonly resultPending = signal(false);

  /** A metadata-agent result or an active node exists. */
  readonly hasEditableMetadata = computed(
    () => this.metadataAgent.lastRun()?.ok === true || this.activeNode() !== null,
  );

  /**
   * A generated result that has not been written to a node yet — loading another entry would
   * discard it, so the caller confirms first. Tracked explicitly rather than derived from "no
   * active node", because an enrichment of the open OnlyOffice document already *has* its target
   * node while still being unsaved.
   */
  readonly hasUnsavedWork = this.resultPending.asReadonly();

  /**
   * Metadata fed to the editor: the active node's properties if present, else the agent
   * payload. Falls back to the payload while the node metadata loads, so the editor never
   * briefly unmounts.
   */
  readonly editorMetadata = computed<Record<string, unknown> | null>(() => {
    const payload = this.metadataAgent.lastRun()?.parsed?.raw ?? null;
    return this.activeNode() ? this.nodeMetadata() ?? payload : payload;
  });

  /** Clear the whole flow for a fresh analysis. */
  startNew(): void {
    this.metadataAgent.reset();
    this.resetNodeState();
  }

  /**
   * Run the metadata agent for the active tab, dropping any previous node. Returns true on
   * success so the footer can advance to the metadata screen. Nothing is written to the
   * history here — an entry is recorded only once a node is actually saved (see {@link save}).
   */
  async analyze(): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    this.resetNodeState();
    const outcome = await this.metadataAgent.run();
    const ok = outcome.ok && !!outcome.parsed && !!outcome.source;
    this.resultPending.set(ok);
    return ok;
  }

  /**
   * Like {@link analyze}, but the content comes from the document the host page has open (the
   * OnlyOffice editor) instead of the page — and that document *is* a repository node, so it
   * becomes the active node: saving writes the enriched metadata onto it instead of creating a
   * new node in the inbox.
   */
  async enrichOpenDocument(): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    this.resetNodeState();
    const outcome = await this.metadataAgent.runForOpenDocument();
    if (!outcome.ok || !outcome.parsed) return false;
    this.resultPending.set(true);
    await this.adoptDocumentAsActiveNode(outcome.document);
    return true;
  }

  /**
   * Open a saved node from the history: load the live node and seed the active-node state
   * (preview + editable metadata). Navigation is driven by the caller. Throws if the node
   * cannot be fetched, leaving the state untouched.
   */
  async openFromHistory(entry: HistoryEntry): Promise<void> {
    const node = await this.repositoryNodes.get(entry.nodeId);
    this.applyLoadedNode(entry.nodeId, node, node.name ?? entry.title);
    // Keep the stored parsed result so the raw/field views and the source line show.
    this.metadataAgent.restore({
      ok: true,
      parsed: entry.parsed,
      source: { url: entry.url, title: entry.title, favIconUrl: entry.favIconUrl }
    });
  }

  /**
   * Open a live node by id — same as {@link openFromHistory}, but for an externally received
   * node (an OnlyOffice preview or a freshly created document) where no agent result exists.
   * The node is recorded in the history so it can be reopened later.
   */
  async openNode(nodeId: string): Promise<void> {
    const node = await this.repositoryNodes.get(nodeId);
    const name = node.name ?? nodeId;
    this.applyLoadedNode(nodeId, node, name);
    // No agent result for an externally received node; the raw/field views hide. Its parsed
    // view is derived from the node's own properties instead.
    this.metadataAgent.reset();
    const parsed = this.metadataAgent.parse(node.properties as Record<string, unknown>);
    await this.history.add({
      nodeId,
      url: this.activeNode()?.link ?? '',
      title: name,
      fieldsExtracted: parsed.fieldsExtracted,
      fieldsTotal: parsed.fieldsTotal,
      parsed
    });
  }

  /**
   * Adopt the document the host page has open as the active node, so the app works on it from the
   * start (preview, metadata, collections all target the edited document). Takes the node the
   * {@link OnlyOfficeDocumentService} already loaded, so it costs no second fetch.
   *
   * Unlike {@link openNode} nothing is written to the history — the user did not pick this node,
   * it is simply what happens to be open. Ignored once anything else is loaded or unsaved, so a
   * late arrival (the identity is often known only after login) never clobbers the user's work.
   */
  adoptOpenDocument(node: Node): void {
    if (this.activeNode() || this.hasUnsavedWork()) return;
    // Name only when really known, never the node id as a stand-in — see {@link ActiveNode}.
    this.applyLoadedNode(node.ref.id, node, node.name ?? null);
    // No agent result for a node we merely found open; its parsed view comes from the node's own
    // properties instead.
    this.metadataAgent.reset();
  }

  /**
   * Save the metadata: create the node the first time, otherwise update it in place. Returns
   * true on success so the metadata screen can advance to the preview.
   */
  async save(values: MdsValues): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const existing = this.activeNode();
      // Pass the current name so an update never renames the node (generated metadata carries no
      // `cm:name`). An unknown name is passed on as such — update() then sends none at all.
      const saved = existing
        ? await this.repositoryNodes.update(existing.nodeId, values, existing.name ?? undefined)
        : await this.repositoryNodes.createInInbox(values);
      this.setActiveNode(saved.nodeId, saved.name);
      this.resultPending.set(false);
      // Load the full hydrated node once: its properties re-seed the editor (so re-editing
      // uses the stored values) and the node itself feeds the preview.
      try {
        const node = await this.repositoryNodes.get(saved.nodeId);
        this.previewNode.set(node);
        this.nodeMetadata.set(node.properties as MdsValues);
      } catch {
        /* keep editor/preview as-is if the reload fails */
      }
      await this.recordSaved(saved);
      return true;
    } catch (cause: unknown) {
      this.saveError.set(errorMessage(cause));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Add the active node to the given collection(s). */
  async assignToCollections(collections: readonly Collection[]): Promise<void> {
    const node = this.activeNode();
    if (!node || !this.auth.authorized() || !collections.length) return;
    this.assigning.set(true);
    this.assignError.set(null);
    try {
      for (const collection of collections) {
        await firstValueFrom(
          this.collections.addToCollection({
            repository: HOME_REPOSITORY,
            collection: collection.id,
            node: node.nodeId
          })
        );
        // Track it once, avoiding duplicates on repeated inserts.
        this.assignedCollections.update((list) =>
          list.some((assigned) => assigned.id === collection.id) ? list : [...list, collection]
        );
      }
    } catch (cause: unknown) {
      this.assignError.set(errorMessage(cause));
    } finally {
      this.assigning.set(false);
    }
  }

  /**
   * Make the enriched document the active node, so {@link save} updates it in place.
   *
   * `nodeMetadata` deliberately stays empty: the editor must show the freshly generated metadata,
   * not the node's stored properties (see {@link editorMetadata}). Without a node id (a stale
   * plugin config) the flow falls back to creating a node on save, so the enrichment is not lost.
   */
  private async adoptDocumentAsActiveNode(
    document: DocumentIdentity | null | undefined,
  ): Promise<void> {
    const nodeId = document?.nodeId;
    if (!nodeId) return;
    // Reuse the node OnlyOfficeDocumentService already loaded for this id; only fetch it ourselves
    // when that hydration did not run or failed.
    const hydrated = this.onlyOfficeDocument.documentNode();
    const node = hydrated?.ref.id === nodeId ? hydrated : await this.loadNode(nodeId);
    if (node) this.previewNode.set(node);
    // Name only when really known (see {@link ActiveNode}); the save target stands either way.
    this.setActiveNode(nodeId, node?.name ?? null);
  }

  /** Load a node for display purposes; `null` when it cannot be fetched. */
  private async loadNode(nodeId: string): Promise<Node | null> {
    try {
      return await this.repositoryNodes.get(nodeId);
    } catch {
      return null;
    }
  }

  /** Record a saved node in the history (only saved nodes are kept there). */
  private async recordSaved(saved: NodeSummary): Promise<void> {
    const lastRun = this.metadataAgent.lastRun();
    const parsed = lastRun?.parsed;
    if (!parsed) return;
    await this.history.add({
      nodeId: saved.nodeId,
      url: lastRun?.source?.url ?? '',
      title: lastRun?.source?.title ?? saved.name,
      favIconUrl: lastRun?.source?.favIconUrl,
      fieldsExtracted: parsed.fieldsExtracted,
      fieldsTotal: parsed.fieldsTotal,
      parsed
    });
  }

  /** Reset the state and seed node, preview and editor metadata from a hydrated node. */
  private applyLoadedNode(nodeId: string, node: Node, name: string | null): void {
    this.resetNodeState();
    this.setActiveNode(nodeId, name);
    this.previewNode.set(node);
    this.nodeMetadata.set(node.properties as MdsValues);
  }

  private setActiveNode(nodeId: string, name: string | null): void {
    this.activeNode.set({ nodeId, name, link: renderLink(this.auth.repositoryUrl(), nodeId) });
  }

  private resetNodeState(): void {
    this.resultPending.set(false);
    this.activeNode.set(null);
    this.nodeMetadata.set(null);
    this.previewNode.set(null);
    this.saveError.set(null);
    this.assignError.set(null);
    this.assignedCollections.set([]);
  }
}
