import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionServiceUnwrapped, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { MdsValues } from '../util/mds-values';
import { errorMessage } from '../util/errors';
import { AuthService } from './auth.service';
import { HistoryEntry, HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import { DocumentIdentity } from './onlyoffice-document.service';
import { NodeSummary, RepositoryNodeService } from './repository-node.service';

/** A collection the content was added to. */
export interface Collection {
  id: string;
  name: string;
}

/** The node the app currently works on, plus its link into the repository UI. */
export interface ActiveNode extends NodeSummary {
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
    if (!this.auth.loggedIn()) return false;
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
    if (!this.auth.loggedIn()) return false;
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
   * Save the metadata: create the node the first time, otherwise update it in place. Returns
   * true on success so the metadata screen can advance to the preview.
   */
  async save(values: MdsValues): Promise<boolean> {
    if (!this.auth.loggedIn()) return false;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const existing = this.activeNode();
      // The current name is passed along so an update never renames the node: generated metadata
      // carries no `cm:name`, and for a real document that name holds its file name + extension.
      const saved = existing
        ? await this.repositoryNodes.update(existing.nodeId, values, existing.name)
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
    if (!node || !this.auth.loggedIn() || !collections.length) return;
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
   * Make the enriched document the active node, so {@link save} updates it in place. A collection
   * reference points at a copy, so `originalId` — the actually edited node — wins over `nodeId`.
   *
   * `nodeMetadata` deliberately stays empty here: the editor must show the freshly generated
   * metadata, not the node's stored properties (see {@link editorMetadata}). Without a node id
   * (an editor opened with a stale plugin config) the flow falls back to creating a node on save,
   * so the enrichment is never lost.
   */
  private async adoptDocumentAsActiveNode(
    document: DocumentIdentity | null | undefined,
  ): Promise<void> {
    const nodeId = document?.originalId || document?.nodeId;
    if (!nodeId) return;
    this.setActiveNode(nodeId, document?.name || document?.title || nodeId);
    // Hydrate the node for the preview and to carry its real name (with file extension) into the
    // save. A failure only costs those two — the save target itself stands.
    try {
      const node = await this.repositoryNodes.get(nodeId);
      this.previewNode.set(node);
      this.setActiveNode(nodeId, node.name ?? nodeId);
    } catch {
      /* keep the identity the plugin reported */
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
  private applyLoadedNode(nodeId: string, node: Node, name: string): void {
    this.resetNodeState();
    this.setActiveNode(nodeId, name);
    this.previewNode.set(node);
    this.nodeMetadata.set(node.properties as MdsValues);
  }

  private setActiveNode(nodeId: string, name: string): void {
    const base = this.auth.repositoryUrl().replace(/\/+$/, '');
    this.activeNode.set({ nodeId, name, link: `${base}/components/render/${nodeId}` });
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
