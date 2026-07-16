import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from './auth.service';
import { GenerateService } from './generate.service';
import { HistoryService } from './history.service';
import { UploadService, UploadedNode } from './upload.service';

export type WizardStep = 1 | 2 | 3 | 4;

export interface CreatedNode extends UploadedNode {
  link: string;
}

// State + actions for the multi-step "Erschließen" flow.
@Injectable({ providedIn: 'root' })
export class ErschliessenService {
  private readonly auth = inject(AuthService);
  private readonly gen = inject(GenerateService);
  private readonly upload = inject(UploadService);
  private readonly history = inject(HistoryService);

  readonly step = signal<WizardStep>(1);
  readonly createdNode = signal<CreatedNode | null>(null);
  readonly nodeMetadata = signal<Record<string, string[]> | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly running = this.gen.running;

  // Step 2 available once there is a /generate result or a created node.
  readonly hasResult = computed(() => this.gen.last()?.ok === true || this.createdNode() !== null);
  // Steps 3 & 4 available once a node was created.
  readonly hasNode = computed(() => this.createdNode() !== null);

  // Metadata fed to the editor: the created node's metadata if present, else the
  // /generate payload. Falls back to the payload while the node metadata loads, so
  // the editor never briefly unmounts.
  readonly editorMetadata = computed<Record<string, unknown> | null>(() => {
    const payload = (this.gen.last()?.parsed?.raw ?? null) as Record<string, unknown> | null;
    if (this.createdNode()) return (this.nodeMetadata() as Record<string, unknown> | null) ?? payload;
    return payload;
  });

  goTo(step: WizardStep): void {
    if (step === 2 && !this.hasResult()) return;
    if ((step === 3 || step === 4) && !this.hasNode()) return;
    this.step.set(step);
  }

  // Step 1 "Erschließen": drop any previous node, run /generate, advance to step 2.
  async run(): Promise<void> {
    if (!this.auth.state().loggedIn) return;
    this.createdNode.set(null);
    this.nodeMetadata.set(null);
    this.saveError.set(null);
    const o = await this.gen.run('de');
    if (o.ok && o.parsed && o.source) {
      await this.history.add({
        url: o.source.url,
        title: o.source.title,
        favIconUrl: o.source.favIconUrl,
        fieldsExtracted: o.parsed.fieldsExtracted,
        fieldsTotal: o.parsed.fieldsTotal,
        parsed: o.parsed
      });
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
      // Load persisted metadata so re-editing uses the stored values.
      try {
        this.nodeMetadata.set(await this.upload.getNodeMetadata(node.nodeId));
      } catch {
        /* keep editor as-is if the reload fails */
      }
      if (!existing) this.step.set(3); // first create → Preview shows the link
    } catch (e: unknown) {
      this.saveError.set(String((e as Error)?.message || e));
    } finally {
      this.saving.set(false);
    }
  }
}
