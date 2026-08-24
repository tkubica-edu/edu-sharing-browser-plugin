import { ReliefMesh } from './relief-mesh';

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uProjection;
uniform mat4 uModelView;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = mat3(uModelView) * aNormal;
  vUv = aUv;
  gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
}`;

// Lit from the camera's side, so turning the relief shows its shape rather than darkening it: a fixed
// key light plus a generous ambient term, which keeps the picture's own colours readable.
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTexture;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 normal = normalize(vNormal);
  float key = max(dot(normal, normalize(vec3(0.3, 0.5, 1.0))), 0.0);
  gl_FragColor = vec4(texture2D(uTexture, vUv).rgb * (0.55 + 0.45 * key), 1.0);
}`;

/** The camera's vertical field of view, in radians. */
const FIELD_OF_VIEW = 0.9;

/** Air left around the relief once it is framed, so a turned one does not immediately clip. */
const FRAMING_MARGIN = 1.12;

/** How far in and out of the framed distance the wheel may go. */
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 3;

/** How far the relief may be turned away from the camera it was seen by, in radians. */
const MAX_TILT = Math.PI / 2.2;

/**
 * Shows a {@link ReliefMesh} textured with its picture, turnable by dragging and zoomable by wheel.
 * Written against plain WebGL rather than a 3D library: one textured mesh under one light is the whole
 * scene, and any library that could draw it weighs more than the model does.
 */
export class ReliefViewer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly texture: WebGLTexture;
  private readonly indexCount: number;
  private readonly uniforms: {
    projection: WebGLUniformLocation | null;
    modelView: WebGLUniformLocation | null;
    texture: WebGLUniformLocation | null;
  };
  private readonly cleanups: (() => void)[] = [];

  /** Half the mesh's extent along each axis — what the camera distance is computed from. */
  private readonly extent: { x: number; y: number; z: number };

  private yaw = 0;
  private pitch = 0;
  /** Multiplier on the distance that just frames the relief; 1 is the view it opens at. */
  private zoom = 1;
  private frame = 0;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    mesh: ReliefMesh,
    picture: TexImageSource
  ) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL steht in diesem Browser nicht zur Verfügung.');
    this.gl = gl;
    this.program = buildProgram(gl);
    this.indexCount = mesh.indices.length;
    this.extent = halfExtent(mesh.positions);

    this.attribute('aPosition', mesh.positions, 3);
    this.attribute('aNormal', mesh.normals, 3);
    this.attribute('aUv', mesh.uvs, 2);
    const indexBuffer = gl.createBuffer();
    if (!indexBuffer) throw new Error('WebGL-Puffer konnte nicht angelegt werden.');
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.buffers.push(indexBuffer);

    this.texture = this.uploadTexture(picture);
    this.uniforms = {
      projection: gl.getUniformLocation(this.program, 'uProjection'),
      modelView: gl.getUniformLocation(this.program, 'uModelView'),
      texture: gl.getUniformLocation(this.program, 'uTexture')
    };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.96, 0.97, 0.98, 1);

    this.bindPointer();
    this.render();
  }

  /** Puts the relief back to the view it opened in. */
  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1;
    this.draw();
  }

  /** Releases the GPU resources and the listeners; the canvas may be reused afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    for (const cleanup of this.cleanups) cleanup();
    const gl = this.gl;
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
  }

  /** Redraws at the canvas' current size — for a panel that resized under it. */
  render(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private attribute(name: string, data: Float32Array, size: number): void {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('WebGL-Puffer konnte nicht angelegt werden.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(this.program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    this.buffers.push(buffer);
  }

  /**
   * The picture as a texture. Without mipmaps and with clamped edges, which is what WebGL 1 allows for
   * a texture whose sides are not powers of two — and a preview picture's rarely are.
   */
  private uploadTexture(picture: TexImageSource): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('WebGL-Textur konnte nicht angelegt werden.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Dragging turns the relief, the wheel moves the camera in and out. */
  private bindPointer(): void {
    const canvas = this.canvas;
    let pointer: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const down = (event: PointerEvent) => {
      pointer = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return;
      this.yaw = clamp(this.yaw + (event.clientX - lastX) * 0.008, -MAX_TILT, MAX_TILT);
      this.pitch = clamp(this.pitch + (event.clientY - lastY) * 0.008, -MAX_TILT, MAX_TILT);
      lastX = event.clientX;
      lastY = event.clientY;
      this.render();
    };
    const up = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return;
      pointer = null;
      canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      this.zoom = clamp(this.zoom * (event.deltaY > 0 ? 1.1 : 0.9), MIN_ZOOM, MAX_ZOOM);
      this.render();
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  /**
   * How far back the camera has to stand for the relief to fill the canvas, with the wheel's zoom on
   * top. Computed per frame rather than once, because the distance that frames a mesh depends on the
   * shape of the box the panel currently gives the canvas.
   */
  private cameraDistance(aspect: number): number {
    const half = Math.tan(FIELD_OF_VIEW / 2);
    const fit = Math.max(this.extent.y / half, this.extent.x / (half * aspect));
    // Plus how far the relief reaches towards the camera: its own depth, and — once it is turned — the
    // part of its width and height that the turn has swung forward. Without that second term the near
    // edge grows out of the frame as soon as the relief is turned far.
    const reach =
      this.extent.z +
      Math.abs(Math.sin(this.yaw)) * this.extent.x +
      Math.abs(Math.sin(this.pitch)) * this.extent.y;
    return fit * FRAMING_MARGIN * this.zoom + reach;
  }

  private draw(): void {
    if (this.disposed) return;
    const gl = this.gl;
    const canvas = this.canvas;
    // The backing store follows the box the layout gave the canvas, at the display's pixel density.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const aspect = width / height;
    gl.uniformMatrix4fv(this.uniforms.projection, false, perspective(FIELD_OF_VIEW, aspect, 0.01, 100));
    gl.uniformMatrix4fv(
      this.uniforms.modelView,
      false,
      modelView(this.yaw, this.pitch, this.cameraDistance(aspect))
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.texture, 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
  }
}

/**
 * Whether the browser can draw a relief at all: WebGL plus the extension that allows more than 65 536
 * vertices per draw, which a relief of any useful resolution exceeds. Answered once and remembered —
 * asking costs a WebGL context, and a browser hands out only a handful before it drops the oldest.
 */
export function reliefViewerSupported(): boolean {
  supported ??= (() => {
    const gl = document.createElement('canvas').getContext('webgl');
    return !!gl?.getExtension('OES_element_index_uint');
  })();
  return supported;
}

let supported: boolean | null = null;

function buildProgram(gl: WebGLRenderingContext): WebGLProgram {
  // 32-bit indices are an extension in WebGL 1; enabling it is what makes `UNSIGNED_INT` legal.
  gl.getExtension('OES_element_index_uint');
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL-Programm konnte nicht angelegt werden.');
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('WebGL-Shader konnte nicht angelegt werden.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader-Programm: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);
  return program;
}

/** A right-handed perspective projection, column-major as WebGL expects it. */
function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const range = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, 2 * near * far * range, 0
  ]);
}

/** The relief turned by yaw and pitch, then pushed away from the camera along -z. */
function modelView(yaw: number, pitch: number, distance: number): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Yaw about the relief's own up axis first, then pitch about the camera's x — the two as one
  // matrix, with the translation in its last column so it moves the camera back after the turn.
  // prettier-ignore
  return new Float32Array([
    cy, sy * sp, -sy * cp, 0,
    0, cp, sp, 0,
    sy, -cy * sp, cy * cp, 0,
    0, 0, -distance, 1
  ]);
}

/** Half the size of the box the mesh occupies, per axis. */
function halfExtent(positions: Float32Array): { x: number; y: number; z: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return {
    x: (max[0] - min[0]) / 2,
    y: (max[1] - min[1]) / 2,
    z: (max[2] - min[2]) / 2
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
