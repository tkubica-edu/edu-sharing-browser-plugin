import { ReliefMesh } from './relief-mesh';

/** glTF's binary container magic (`glTF`) and the version it is written in. */
const MAGIC = 0x46546c67;
const VERSION = 2;

/** Chunk types of the container: the scene description, then the buffer it points into. */
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** glTF component types, given as the OpenGL enums the format inherits. */
const UNSIGNED_INT = 5125;
const FLOAT = 5126;

/** Buffer view targets: what the data is bound as. */
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** Sampler enums: bilinear magnification, trilinear minification, clamped edges. */
const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;
const CLAMP_TO_EDGE = 33071;

/** The two picture formats glTF allows as a texture. */
const TEXTURE_MIME_TYPES = ['image/jpeg', 'image/png'];

export const GLB_MIME_TYPE = 'model/gltf-binary';

/** The picture a mesh is textured with, in the bytes it will be embedded as. */
export interface GlbTexture {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * The mesh as a self-contained `.glb`: one buffer holding geometry and picture alike, so the file
 * carries its texture rather than referring to one. Written by hand because the alternative is a glTF
 * library an order of magnitude larger than the few hundred lines the format costs.
 */
export function toGlb(mesh: ReliefMesh, texture: GlbTexture): Blob {
  if (!TEXTURE_MIME_TYPES.includes(texture.mimeType)) {
    throw new Error(`glTF erlaubt als Textur nur ${TEXTURE_MIME_TYPES.join(' oder ')}.`);
  }
  const parts = [
    new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength),
    new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength),
    new Uint8Array(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.byteLength),
    new Uint8Array(mesh.uvs.buffer, mesh.uvs.byteOffset, mesh.uvs.byteLength),
    texture.bytes
  ];

  // Every view starts on a four-byte boundary, which the format requires of accessor data and which
  // keeps the reader from ever having to copy a misaligned array.
  const views: { byteOffset: number; byteLength: number }[] = [];
  let offset = 0;
  for (const part of parts) {
    views.push({ byteOffset: offset, byteLength: part.byteLength });
    offset += align4(part.byteLength);
  }
  const binary = new Uint8Array(offset);
  for (let i = 0; i < parts.length; i++) binary.set(parts[i], views[i].byteOffset);

  const bounds = boundingBox(mesh.positions);
  const gltf = {
    asset: { version: '2.0', generator: 'edu-sharing Browser-Erweiterung' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Relief' }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 }, indices: 0, material: 0 }
        ]
      }
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1
        },
        // The relief has no back, so a viewer must not cull one away and leave a hole.
        doubleSided: true
      }
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [
      { magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR, wrapS: CLAMP_TO_EDGE, wrapT: CLAMP_TO_EDGE }
    ],
    images: [{ bufferView: 4, mimeType: texture.mimeType }],
    accessors: [
      { bufferView: 0, componentType: UNSIGNED_INT, count: mesh.indices.length, type: 'SCALAR' },
      {
        bufferView: 1,
        componentType: FLOAT,
        count: mesh.positions.length / 3,
        type: 'VEC3',
        // Required of the position accessor: a reader sizes the scene from it without decoding data.
        min: bounds.min,
        max: bounds.max
      },
      { bufferView: 2, componentType: FLOAT, count: mesh.normals.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: FLOAT, count: mesh.uvs.length / 2, type: 'VEC2' }
    ],
    bufferViews: views.map((view, index) => ({
      buffer: 0,
      byteOffset: view.byteOffset,
      byteLength: view.byteLength,
      // Only the geometry views name a target; the picture's is not bound to the GPU as it stands.
      ...(index === 0 ? { target: ELEMENT_ARRAY_BUFFER } : {}),
      ...(index >= 1 && index <= 3 ? { target: ARRAY_BUFFER } : {})
    })),
    buffers: [{ byteLength: binary.byteLength }]
  };

  // Chunks are padded to four bytes with a filler that stays valid inside them: spaces for the JSON,
  // zeroes for the buffer.
  const json = padded(new TextEncoder().encode(JSON.stringify(gltf)), 0x20);
  const bin = padded(binary, 0x00);
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, total, true);
  view.setUint32(12, json.byteLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(json, 20);
  const binHeader = 20 + json.byteLength;
  view.setUint32(binHeader, bin.byteLength, true);
  view.setUint32(binHeader + 4, CHUNK_BIN, true);
  out.set(bin, binHeader + 8);

  return new Blob([out], { type: GLB_MIME_TYPE });
}

function boundingBox(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

function align4(length: number): number {
  return (length + 3) & ~3;
}

function padded(bytes: Uint8Array, filler: number): Uint8Array {
  const length = align4(bytes.byteLength);
  if (length === bytes.byteLength) return bytes;
  const out = new Uint8Array(length).fill(filler);
  out.set(bytes);
  return out;
}
