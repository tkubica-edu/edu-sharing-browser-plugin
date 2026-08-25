import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BrowserExtensionService, WORKER_UNREACHABLE, WORKER_UNREACHABLE_TEXT } from './browser-extension.service';
import { MetadataAgentApiService } from './metadata-agent-api.service';
import { NodeWriteService } from './node-write.service';
import { MdsValues } from '../util/mds-values';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';

/** Values as the editor hands them over: every property a list, however many it holds. */
const VALUES: MdsValues = { 'cclom:title': ['Optik'], 'cclom:general_keyword': ['Licht', 'Linse'] };

/** A payload as the agent answered it: the envelope, the raw text, and a field of its own. */
const PAYLOAD: Record<string, unknown> = {
  contextName: 'wlo',
  schemaVersion: '1.0',
  metadataset: 'mds_oeh',
  _source_text: 'Der ganze Seitentext.',
  _origins: { 'cclom:title': 'page' },
};

describe('NodeWriteService', () => {
  let write: NodeWriteService;
  let extension: BrowserExtensionFake;
  let agentApi: MetadataAgentApiService;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    write = TestBed.inject(NodeWriteService);
    // The real one: it computes the agent's address from the configured repository and has nothing else
    // in it, so faking it would only restate the constant the service is expected to send.
    agentApi = TestBed.inject(MetadataAgentApiService);
  });

  /** The body of the write the service sent, as the worker received it. */
  function sentBody(): Record<string, unknown> {
    expect(extension.fake.saveNode).toHaveBeenCalled();
    return extension.fake.saveNode.mock.calls[0][0];
  }

  describe('the body it assembles', () => {
    it('puts the values under `metadata` and the envelope beside it', async () => {
      await write.write(VALUES, PAYLOAD, null);

      const body = sentBody();
      expect(body['metadata']).toEqual(VALUES);
      expect(body['contextName']).toBe('wlo');
      expect(body['metadataset']).toBe('mds_oeh');
      expect(body['_origins']).toEqual({ 'cclom:title': 'page' });
    });

    it('leaves out a property the editor reported as empty', async () => {
      await write.write({ 'cclom:title': ['Optik'], 'cclom:description': [] }, null, null);

      // Sending it would clear a field on the node that nothing in this flow ever touched.
      expect(sentBody()['metadata']).toEqual({ 'cclom:title': ['Optik'] });
    });

    it('states all three step flags, so the endpoint never falls back to its own defaults', async () => {
      await write.write(VALUES, null, null);

      const body = sentBody();
      expect(body['write_extended_data']).toBe(false);
      expect(body['start_quality_workflow']).toBe(false);
      expect(body['start_review_workflow']).toBe(false);
    });

    it('states the steps that were asked for', async () => {
      await write.write(VALUES, null, null, { extended: true, quality: true, review: true });

      const body = sentBody();
      expect(body['write_extended_data']).toBe(true);
      expect(body['start_quality_workflow']).toBe(true);
      expect(body['start_review_workflow']).toBe(true);
    });

    it('lets no payload key displace a step flag', async () => {
      await write.write(VALUES, { ...PAYLOAD, write_extended_data: true }, null);

      // Only the envelope keys travel, and the flags are stated after them either way.
      expect(sentBody()['write_extended_data']).toBe(false);
    });

    it('names no node for a create — the key`s presence is what tells the two apart', async () => {
      await write.write(VALUES, PAYLOAD, null);

      expect('node_id' in sentBody()).toBe(false);
    });

    it('names the node it updates', async () => {
      await write.write(VALUES, PAYLOAD, 'node-7');

      expect(sentBody()['node_id']).toBe('node-7');
    });

    it('sends the raw text only where the extended fields carry it', async () => {
      await write.write(VALUES, PAYLOAD, null, { extended: true });

      expect(sentBody()['extended_text']).toBe('Der ganze Seitentext.');
    });

    it('leaves the raw text out without the extended fields — it would have nowhere to go', async () => {
      await write.write(VALUES, PAYLOAD, null);

      expect('extended_text' in sentBody()).toBe(false);
    });

    it('leaves the raw text out where the payload carries none', async () => {
      await write.write(VALUES, { contextName: 'wlo' }, null, { extended: true });

      expect('extended_text' in sentBody()).toBe(false);
    });

    it('names the collections the content is to be filed in', async () => {
      await write.write(VALUES, null, null, { collections: ['coll-1', 'coll-2'] });

      expect(sentBody()['collection_id']).toEqual(['coll-1', 'coll-2']);
    });

    it('leaves the collections out where nothing was picked', async () => {
      await write.write(VALUES, null, null, { collections: [] });

      // An empty list is not a statement the request needs to make.
      expect('collection_id' in sentBody()).toBe(false);
    });

    it('names the picture where one was picked, and nothing where none was', async () => {
      await write.write(VALUES, null, null, { preview: 'https://example.org/cover.png' });
      expect(sentBody()['preview']).toBe('https://example.org/cover.png');

      extension.fake.saveNode.mockClear();
      await write.write(VALUES, null, null, {});
      expect('preview' in sentBody()).toBe(false);
    });

    it('sends it to the agent, not to the configured repository', async () => {
      await write.write(VALUES, null, null);

      expect(extension.fake.saveNode).toHaveBeenCalledWith(expect.anything(), agentApi.baseUrl());
    });
  });

  describe('what it makes of the answer', () => {
    it('reports the node the endpoint described', async () => {
      const node = { nodeId: 'node-9', title: 'Optik' };
      const nodeFull = { ref: { id: 'node-9' } };
      extension.writes({ success: true, node, node_full: nodeFull, node_created: true });

      const outcome = await write.write(VALUES, PAYLOAD, null);

      expect(outcome).toMatchObject({ ok: true, node, nodeFull, created: true });
      expect(outcome.error).toBeUndefined();
    });

    it('answers a write the endpoint refused with its reason', async () => {
      extension.writes({ success: false, error: 'Node ist älter als zwei Stunden.' });

      expect(await write.write(VALUES, null, 'node-7')).toMatchObject({
        ok: false,
        error: 'Node ist älter als zwei Stunden.',
      });
    });

    it('has a word for a refusal that names no reason', async () => {
      extension.writes({ success: false });

      expect((await write.write(VALUES, null, null)).error).toBe('Speichern fehlgeschlagen.');
    });

    it('says what a message that reached no worker means, in place of the code', async () => {
      extension.refuses(WORKER_UNREACHABLE);

      expect(await write.write(VALUES, null, null)).toEqual({
        ok: false,
        error: WORKER_UNREACHABLE_TEXT,
      });
    });

    it('passes on any other transport failure as it stands', async () => {
      extension.refuses('Tab ist verschwunden.');

      expect((await write.write(VALUES, null, null)).error).toBe('Tab ist verschwunden.');
    });

    it('answers an empty reply as a failed write rather than as a written node', async () => {
      extension.writes(undefined);

      expect(await write.write(VALUES, null, null)).toMatchObject({ ok: false });
    });

    it('reports what was thrown on the way', async () => {
      extension.fake.saveNode.mockRejectedValue(new Error('Nachricht abgebrochen'));

      expect(await write.write(VALUES, null, null)).toEqual({
        ok: false,
        error: 'Nachricht abgebrochen',
      });
    });
  });

  describe('the steps it reports beside the write', () => {
    it('names the workflow step that did not run, with its reason', async () => {
      extension.writes({
        success: true,
        workflow: [
          { status: '140_ELEMENT_LEGALLY_APPROVED', success: true },
          { status: '200_tocheck', success: false, error: 'Keine Berechtigung' },
        ],
      });

      const outcome = await write.write(VALUES, null, null, { quality: true, review: true });

      // The metadata is written either way, so a failed handover is a report and not a failed write.
      expect(outcome.ok).toBe(true);
      expect(outcome.workflowError).toBe('200_tocheck: Keine Berechtigung');
    });

    it('names a workflow step that failed without saying why', async () => {
      extension.writes({ success: true, workflow: [{ status: '200_tocheck', success: false }] });

      expect((await write.write(VALUES, null, null)).workflowError).toBe('200_tocheck nicht gesetzt.');
    });

    it('reports nothing where every requested step ran', async () => {
      extension.writes({ success: true, workflow: [{ status: '200_tocheck', success: true }] });

      expect((await write.write(VALUES, null, null)).workflowError).toBeUndefined();
    });

    it('names the collection the content did not reach', async () => {
      extension.writes({
        success: true,
        collections: [
          { collectionId: 'coll-1', success: true },
          { collectionId: 'coll-2', success: false, error: 'Keine Berechtigung' },
        ],
      });

      expect((await write.write(VALUES, null, null, { collections: ['coll-1', 'coll-2'] })).collectionError)
        .toBe('Sammlung coll-2: Keine Berechtigung');
    });

    it('keeps quiet about a collection that holds the content already', async () => {
      extension.writes({
        success: true,
        collections: [
          { collectionId: 'coll-1', success: false, error: 'DuplicateNodeException: already in there' },
        ],
      });

      // The request asked for the content to be in it, and it is.
      expect((await write.write(VALUES, null, null)).collectionError).toBeUndefined();
    });

    it('reports a picture the endpoint could not use', async () => {
      extension.writes({ success: true, preview: { success: false, error: 'Bild nicht lesbar' } });

      expect((await write.write(VALUES, null, null, { preview: 'data:image/png;base64,xx' })).previewError)
        .toBe('Bild nicht lesbar');
    });

    it('has a word for a picture that failed without a reason', async () => {
      extension.writes({ success: true, preview: { success: false } });

      expect((await write.write(VALUES, null, null)).previewError).toBe('Vorschaubild nicht gesetzt.');
    });

    it('reports nothing about a picture the endpoint took', async () => {
      extension.writes({ success: true, preview: { success: true } });

      expect((await write.write(VALUES, null, null)).previewError).toBeUndefined();
    });

    it('reports none of the steps for a write that did not happen', async () => {
      extension.writes({
        success: false,
        error: 'Node ist älter als zwei Stunden.',
        workflow: [{ status: '200_tocheck', success: false }],
        collections: [{ collectionId: 'coll-1', success: false }],
        preview: { success: false },
      });

      const outcome = await write.write(VALUES, null, 'node-7');

      // What a step of a write reports is only worth reading where the write itself held.
      expect(outcome.workflowError).toBeUndefined();
      expect(outcome.collectionError).toBeUndefined();
      expect(outcome.previewError).toBeUndefined();
    });
  });
});
