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

export type WizardStep = 1 | 2 | 3 | 4;

export interface CreatedNode extends UploadedNode {
  link: string;
}

// State + actions for the multi-step curation flow.
@Injectable({ providedIn: 'root' })
export class CurationService {
  private readonly auth = inject(AuthService);
  private readonly gen = inject(GenerateService);
  private readonly upload = inject(UploadService);
  private readonly history = inject(HistoryService);
  private readonly assign = inject(AssignService);

  readonly step = signal<WizardStep>(1);
  readonly createdNode = signal<CreatedNode | null>(null);
  readonly nodeMetadata = signal<Record<string, string[]> | null>(null);
  // The full hydrated node, fed to the preview web component (step 3).
  readonly previewNode = signal<Node | null>(null);
  // True once the user has advanced PAST Vorschau to Zuordnen → marks step 3 done.
  // (Merely visiting Vorschau does not count.)
  readonly previewConfirmed = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  // Step 4 "Zuordnen": add the created node to a collection.
  readonly assigning = signal(false);
  readonly assignError = signal<string | null>(null);
  readonly assignedCollections = signal<AssignedCollection[]>([]);

  readonly running = this.gen.running;

  // Step 2 available once there is a /generate result or a created node.
  readonly hasResult = computed(() => this.gen.last()?.ok === true || this.createdNode() !== null);
  // Steps 3 & 4 available once a node was created.
  readonly hasNode = computed(() => this.createdNode() !== null);

  // A long-running action is in flight — freeze sub-tab navigation while it runs.
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

  goTo(step: WizardStep): void {
    if (this.busy()) return; // no jumping between steps while an action runs
    if (step === 2 && !this.hasResult()) return;
    if ((step === 3 || step === 4) && !this.hasNode()) return;
    // Vorschau (step 3) is "done" only once the user moves forward from it to Zuordnen.
    if (this.step() === 3 && step === 4) this.previewConfirmed.set(true);
    this.step.set(step);
  }

  // Clear the whole flow and return to step 1 for a fresh Erschließung.
  startNew(): void {
    this.gen.last.set(null);
    this.resetNodeState();
    this.step.set(1);
  }

  // Load a saved node (from Verlauf) by its node id: retrieve the live node, open its
  // Vorschau (step 3), and leave Metadaten (step 2) editable. Throws if the node can't
  // be fetched — the caller surfaces the error (state stays untouched on failure).
  async loadFromHistory(entry: HistoryEntry): Promise<void> {
    const full = await this.upload.getNode(entry.nodeId);
    this.resetNodeState();
    const base = this.auth.state().repositoryUrl.replace(/\/+$/, '');
    this.createdNode.set({
      nodeId: entry.nodeId,
      name: full.name ?? entry.title,
      link: `${base}/components/render/${entry.nodeId}`
    });
    this.previewNode.set(full);
    this.nodeMetadata.set((full.properties ?? {}) as Record<string, string[]>);
    // Keep the stored parsed result so step 2's raw/field views and the source line show.
    this.gen.last.set({
      ok: true,
      parsed: entry.parsed,
      source: { url: entry.url, title: entry.title, favIconUrl: entry.favIconUrl }
    });
    this.step.set(3);
  }

  private resetNodeState(): void {
    this.createdNode.set(null);
    this.nodeMetadata.set(null);
    this.previewNode.set(null);
    this.previewConfirmed.set(false);
    this.saveError.set(null);
    this.assignError.set(null);
    this.assignedCollections.set([]);
  }

  // Step 1 "Erschließen": drop any previous node, run /generate, advance to step 2.
  // Nothing is written to the Verlauf here — an entry is recorded only once a node is
  // actually saved (see save()), so the Verlauf holds saved nodes only.
  async run(): Promise<void> {
    if (!this.auth.state().loggedIn) return;
    this.resetNodeState();
    const o = await this.gen.run('de');
    if (o.ok && o.parsed && o.source) {
      this.step.set(2);
    }
  }

  // Step 2 "Save": create the node the first time, otherwise update it in place.
  async save(values: Record<string, string[]>): Promise<void> {
    if (!this.auth.state().loggedIn) return;
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
      // The footer's step-2 primary action is "Speichern"; every successful save
      // (first create AND later updates) advances to Vorschau (step 3), matching the
      // forward flow of the other steps' actions.
      this.step.set(3);
    } catch (e: unknown) {
      this.saveError.set(String((e as Error)?.message || e));
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
