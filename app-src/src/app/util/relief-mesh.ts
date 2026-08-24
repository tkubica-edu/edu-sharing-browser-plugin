import type { DepthMap } from '../services/depth-model.service';

/** An indexed triangle mesh with the attributes a textured surface needs. */
export interface ReliefMesh {
  /** Vertex positions, 3 floats each; x/y span the picture, z is its relief. */
  positions: Float32Array;
  /** Per-vertex normals, 3 floats each, unit length. */
  normals: Float32Array;
  /** Texture coordinates, 2 floats each, glTF orientation (v grows downwards). */
  uvs: Float32Array;
  /** Triangle corners, 3 indices each. */
  indices: Uint32Array;
  /** Width / height of the picture the mesh was built from — the aspect its x/y span carries. */
  aspect: number;
}

/** How the relief is built. */
export interface ReliefOptions {
  /** Vertices along the longer edge; the shorter one gets proportionally fewer. */
  resolution: number;
  /** How far the nearest point stands out from the furthest, in units of the mesh's longer edge. */
  relief: number;
  /** Radius of the box blur over the depth map, in samples; 0 leaves it as estimated. */
  smoothing: number;
}

export const DEFAULT_RELIEF_OPTIONS: ReliefOptions = { resolution: 192, relief: 0.35, smoothing: 1 };

/**
 * A depth map as a displaced surface: a regular grid over the picture, every vertex pushed along z by
 * the depth estimated at it and carrying the picture as its texture. It is a relief, not a solid — a
 * single view knows nothing of what is behind what it sees — so it reads as a scene seen from the
 * camera that took it and falls apart when turned right around.
 */
export function buildReliefMesh(depth: DepthMap, aspect: number, options: ReliefOptions): ReliefMesh {
  const smoothed = options.smoothing > 0 ? boxBlur(depth, options.smoothing) : depth;
  const columns = Math.max(2, aspect >= 1 ? options.resolution : Math.round(options.resolution * aspect));
  const rows = Math.max(2, aspect >= 1 ? Math.round(options.resolution / aspect) : options.resolution);

  // The longer edge spans one unit, so the mesh keeps the picture's proportions whatever its size.
  const spanX = aspect >= 1 ? 1 : aspect;
  const spanY = aspect >= 1 ? 1 / aspect : 1;

  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    for (let column = 0; column < columns; column++) {
      const u = column / (columns - 1);
      const index = row * columns + column;
      positions[index * 3] = (u - 0.5) * spanX;
      positions[index * 3 + 1] = (0.5 - v) * spanY;
      positions[index * 3 + 2] = (sample(smoothed, u, v) - 0.5) * options.relief;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let at = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const topLeft = row * columns + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns;
      const bottomRight = bottomLeft + 1;
      // Counter-clockwise seen from +z, which is the front face for glTF and for the viewer.
      indices[at++] = topLeft;
      indices[at++] = bottomLeft;
      indices[at++] = topRight;
      indices[at++] = topRight;
      indices[at++] = bottomLeft;
      indices[at++] = bottomRight;
    }
  }

  return { positions, normals: computeNormals(positions, indices), uvs, indices, aspect };
}

/** Bilinear depth at a point of the picture, given in 0…1 coordinates from its top left. */
function sample(depth: DepthMap, u: number, v: number): number {
  const x = clamp(u * (depth.width - 1), 0, depth.width - 1);
  const y = clamp(v * (depth.height - 1), 0, depth.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, depth.width - 1);
  const y1 = Math.min(y0 + 1, depth.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = depth.data[y0 * depth.width + x0] * (1 - fx) + depth.data[y0 * depth.width + x1] * fx;
  const bottom = depth.data[y1 * depth.width + x0] * (1 - fx) + depth.data[y1 * depth.width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * The depth map softened by a box blur of the given radius. Estimated depth is blocky at object edges —
 * the backbone works on patches — and every such step becomes a visible cliff once it is geometry.
 */
function boxBlur(depth: DepthMap, radius: number): DepthMap {
  const pass = (source: Float32Array, width: number, height: number, horizontal: boolean) => {
    const out = new Float32Array(source.length);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    for (let a = 0; a < outer; a++) {
      for (let b = 0; b < inner; b++) {
        let sum = 0;
        let taken = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const at = b + offset;
          if (at < 0 || at >= inner) continue;
          sum += source[horizontal ? a * width + at : at * width + a];
          taken++;
        }
        out[horizontal ? a * width + b : b * width + a] = sum / taken;
      }
    }
    return out;
  };
  const once = pass(depth.data, depth.width, depth.height, true);
  return { data: pass(once, depth.width, depth.height, false), width: depth.width, height: depth.height };
}

/** Per-vertex normals as the area-weighted average of the faces meeting at each vertex. */
function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    // The cross product's length is twice the triangle's area, so leaving it unnormalised is what
    // weights each face by its size.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vertex of [a, b, c]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
