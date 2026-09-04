import { describe, expect, it } from 'vitest';

import { nodeIdFromRepositoryUrl, renderLink } from './repository-links';

const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';

describe('renderLink', () => {
  it('names the node under the repository UI\'s render route', () => {
    expect(renderLink('https://repo.example.org/edu-sharing', NODE)).toBe(
      `https://repo.example.org/edu-sharing/components/render/${NODE}`,
    );
  });

  it('takes a repository address however many slashes it ends in', () => {
    expect(renderLink('https://repo.example.org/edu-sharing///', NODE)).toBe(
      `https://repo.example.org/edu-sharing/components/render/${NODE}`,
    );
  });
});

describe('nodeIdFromRepositoryUrl', () => {
  it('reads back the node a render link names — the inverse of renderLink', () => {
    expect(nodeIdFromRepositoryUrl(renderLink('https://repo.example.org/edu-sharing', NODE))).toBe(NODE);
  });

  it('reads the node a render link names when the view carries more path behind it', () => {
    expect(
      nodeIdFromRepositoryUrl(`https://repo.example.org/edu-sharing/components/render/${NODE}/1.0`),
    ).toBe(NODE);
  });

  it('reads the node an open collection or folder carries as its id parameter', () => {
    expect(
      nodeIdFromRepositoryUrl(`https://repo.example.org/edu-sharing/components/collections?id=${NODE}`),
    ).toBe(NODE);
    expect(
      nodeIdFromRepositoryUrl(`https://repo.example.org/edu-sharing/components/workspace/files?id=${NODE}`),
    ).toBe(NODE);
  });

  it('prefers the node in the path over one named beside it', () => {
    const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(
      nodeIdFromRepositoryUrl(
        `https://repo.example.org/edu-sharing/components/render/${NODE}?id=${other}`,
      ),
    ).toBe(NODE);
  });

  it('reads only pages of the repository UI, so a node id elsewhere is never taken for one it shows', () => {
    expect(nodeIdFromRepositoryUrl(`https://example.org/blog/${NODE}`)).toBeNull();
    expect(nodeIdFromRepositoryUrl(`https://example.org/artikel?id=${NODE}`)).toBeNull();
  });

  it('reads a repository page that names no node as naming none', () => {
    expect(nodeIdFromRepositoryUrl('https://repo.example.org/edu-sharing/components/search?q=optik')).toBeNull();
    expect(nodeIdFromRepositoryUrl('https://repo.example.org/edu-sharing/components/collections?id=-home-')).toBeNull();
  });

  it('refuses something that only looks like a node id', () => {
    expect(
      nodeIdFromRepositoryUrl('https://repo.example.org/edu-sharing/components/render/2c4d6b1a-8f3e-4c2b-9a10'),
    ).toBeNull();
    expect(
      nodeIdFromRepositoryUrl('https://repo.example.org/edu-sharing/components/render/xxxxxxxx-8f3e-4c2b-9a10-7d5e6f8b0c31'),
    ).toBeNull();
  });

  it('answers nothing for an address that is none', () => {
    expect(nodeIdFromRepositoryUrl(null)).toBeNull();
    expect(nodeIdFromRepositoryUrl(undefined)).toBeNull();
    expect(nodeIdFromRepositoryUrl('')).toBeNull();
    expect(nodeIdFromRepositoryUrl(`/components/render/${NODE}`)).toBeNull();
  });
});
