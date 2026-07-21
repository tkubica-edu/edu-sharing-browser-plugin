import { Injectable, computed, inject, signal } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';

import { AssignService } from './assign.service';
import { AuthService } from './auth.service';
import { GenerateService } from './generate.service';
import { HistoryEntry, HistoryService } from './history.service';
import { UploadService, UploadedNode } from './upload.service';

export interface AssignedCollection {
  id: string;
  name: string;
}

export interface CreatedNode extends UploadedNode {
  link: string;
}

// Node state + actions for the curation options (Erschließen / Metadaten / Vorschau /
// Einsortieren). Navigation between options lives in NavigationService/FlowService — this
// service only owns the node and its side-effecting operations.
@Injectable({ providedIn: 'root' })
export class CurationService {
  private readonly auth = inject(AuthService);
  private readonly gen = inject(GenerateService);
  private readonly upload = inject(UploadService);
  private readonly history = inject(HistoryService);
  private readonly assign = inject(AssignService);

  readonly createdNode = signal<CreatedNode | null>(null);
  readonly nodeMetadata = signal<Record<string, string[]> | null>(null);
  // The full hydrated node, fed to the preview web component.
  readonly previewNode = signal<Node | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  // Step 4 "Zuordnen": add the created node to a collection.
  readonly assigning = signal(false);
  readonly assignError = signal<string | null>(null);
  readonly assignedCollections = signal<AssignedCollection[]>([]);

  readonly running = this.gen.running;

  // A /generate result or a created node exists.
  readonly hasResult = computed(() => this.gen.last()?.ok === true || this.createdNode() !== null);
  // A node has been created/loaded.
  readonly hasNode = computed(() => this.createdNode() !== null);

  // A long-running action is in flight.
  readonly busy = computed(() => this.running() || this.saving() || this.assigning());

  // There is a generated result that has not yet been saved to a node — loading
  // another entry would discard it, so the caller confirms first.
  readonly hasUnsavedWork = computed(() => this.gen.last()?.ok === true && this.createdNode() === null);

  // Metadata fed to the editor: the created node's metadata if present, else the
  // /generate payload. Falls back to the payload while the node metadata loads, so
  // the editor never briefly unmounts.
  readonly editorMetadata = computed<Record<string, unknown> | null>(() => {
    const payload = (this.gen.last()?.parsed?.raw ?? null) as Record<string, unknown> | null;
    if (this.createdNode()) return (this.nodeMetadata() as Record<string, unknown> | null) ?? payload;
    return payload;
  });

  // Clear the whole flow for a fresh Erschließung.
  startNew(): void {
    this.gen.last.set(null);
    this.resetNodeState();
  }

  // Load a saved node (from Verlauf) by its node id: retrieve the live node and seed the
  // active-node state (Vorschau + editable Metadaten). Navigation is driven by the caller.
  // Throws if the node can't be fetched — the caller surfaces the error (state untouched).
  async loadFromHistory(entry: HistoryEntry): Promise<void> {
    const full = await this.upload.getNode(entry.nodeId);
    this.applyLoadedNode(entry.nodeId, full, full.name ?? entry.title);
    // Keep the stored parsed result so the Metadaten raw/field views and source line show.
    this.gen.last.set({
      ok: true,
      parsed: entry.parsed,
      source: { url: entry.url, title: entry.title, favIconUrl: entry.favIconUrl }
    });
  }

  // Load a live node by its id — same behaviour as loadFromHistory, but for an externally-
  // received node (e.g. a PREVIEW_NODE event from the OnlyOffice plugin) where there is no
  // stored /generate result. Seeds the active-node state with editable Metadaten.
  // Throws if the node can't be fetched (caller surfaces the error; state stays untouched).
  async loadFromNode(nodeId: string): Promise<void> {
    const full = await this.upload.getNode(nodeId);
    this.applyLoadedNode(nodeId, full, full.name ?? nodeId);
    // No /generate result for an externally-received node; the raw/field views hide.
    this.gen.last.set(null);
  }

  // Shared core of loadFromHistory/loadFromNode: reset state and seed the created node,
  // preview, and editor metadata from the hydrated node.
  private applyLoadedNode(nodeId: string, full: Node, name: string): void {
    this.resetNodeState();
    const base = this.auth.state().repositoryUrl.replace(/\/+$/, '');
    this.createdNode.set({ nodeId, name, link: `${base}/components/render/${nodeId}` });
    this.previewNode.set(full);
    this.nodeMetadata.set((full.properties ?? {}) as Record<string, string[]>);
  }

  private resetNodeState(): void {
    this.createdNode.set(null);
    this.nodeMetadata.set(null);
    this.previewNode.set(null);
    this.saveError.set(null);
    this.assignError.set(null);
    this.assignedCollections.set([]);
  }

  // "Inhalt erschließen": drop any previous node and run /generate. Returns true on success
  // so the footer can advance to the Metadaten screen. Nothing is written to the Verlauf
  // here — an entry is recorded only once a node is actually saved (see save()).
  async run(): Promise<boolean> {
    if (!this.auth.state().loggedIn) return false;
    this.resetNodeState();
    const o = await this.gen.run('de');
    return o.ok && !!o.parsed && !!o.source;
  }

  // "Metadaten" save: create the node the first time, otherwise update it in place.
  // Returns true on success so the Metadaten screen can advance to Vorschau.
  async save(values: Record<string, string[]>): Promise<boolean> {
    if (!this.auth.state().loggedIn) return false;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const existing = this.createdNode();
      const node = existing
        ? await this.upload.updateNode(existing.nodeId, values)
        : await this.upload.createInInbox(values);
      const base = this.auth.state().repositoryUrl.replace(/\/+$/, '');
      this.createdNode.set({ ...node, link: `${base}/components/render/${node.nodeId}` });
      // Load the full hydrated node once: its properties re-seed the editor (so
      // re-editing uses the stored values) and the node itself feeds the preview.
      try {
        const full = await this.upload.getNode(node.nodeId);
        this.previewNode.set(full);
        this.nodeMetadata.set((full.properties ?? {}) as Record<string, string[]>);
      } catch {
        /* keep editor/preview as-is if the reload fails */
      }
      // Record the saved node in the Verlauf (only saved nodes are kept there).
      const src = this.gen.last()?.source;
      const parsed = this.gen.last()?.parsed;
      if (parsed) {
        await this.history.add({
          nodeId: node.nodeId,
          url: src?.url ?? '',
          title: src?.title ?? node.name,
          favIconUrl: src?.favIconUrl,
          fieldsExtracted: parsed.fieldsExtracted,
          fieldsTotal: parsed.fieldsTotal,
          parsed
        });
      }
      // Navigation after a successful save (→ Vorschau) is driven by the Metadaten screen,
      // not here, so save() stays purely about persisting the node.
      return true;
    } catch (e: unknown) {
      this.saveError.set(String((e as Error)?.message || e));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  // Step 4 "Zuordnen": add the created node to the given collection(s).
  async assignToCollection(collections: AssignedCollection[]): Promise<void> {
    const node = this.createdNode();
    if (!node || !this.auth.state().loggedIn || !collections.length) return;
    this.assigning.set(true);
    this.assignError.set(null);
    try {
      for (const c of collections) {
        await this.assign.addToCollection(c.id, node.nodeId);
        // Track it once, avoiding duplicates on repeated inserts.
        this.assignedCollections.update((list) =>
          list.some((x) => x.id === c.id) ? list : [...list, c]
        );
      }
    } catch (e: unknown) {
      this.assignError.set(String((e as Error)?.message || e));
    } finally {
      this.assigning.set(false);
    }
  }
}
