import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterRenderEffect, computed, inject,
  input, signal, viewChild
} from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { AuthService } from '../../../services/auth.service';
import { DepthModelService } from '../../../services/depth-model.service';
import { MaterialUploadService } from '../../../services/material-upload.service';
import { GLB_MIME_TYPE, GlbTexture, toGlb } from '../../../util/glb';
import { DEFAULT_RELIEF_OPTIONS, ReliefMesh, buildReliefMesh } from '../../../util/relief-mesh';
import { ReliefViewer, reliefViewerSupported } from '../../../util/relief-viewer';
import { errorMessage } from '../../../util/errors';

/** Longest edge of the picture baked into the file, so a 4K preview does not become a 30 MB model. */
const MAX_TEXTURE_SIZE = 1024;

/** Quality of the JPEG a picture is re-encoded as when it is too large or in a format glTF rejects. */
const JPEG_QUALITY = 0.9;

const JPEG = 'image/jpeg';

/** What the conversion produced: the mesh, the picture on it, and the file both were written to. */
interface Relief {
  mesh: ReliefMesh;
  picture: ImageBitmap | HTMLImageElement;
  file: File;
}

/**
 * Turns the content's preview picture into a 3D relief, on the device and nowhere else: a depth
 * estimate per pixel ({@link DepthModelService}) displaces a grid over the picture, which is then shown
 * in a turnable viewer and can be filed in the repository as a glTF binary.
 *
 * What comes out is a relief and not a body — one picture says nothing about the far side of what it
 * shows — so it is a scene with depth seen from roughly the camera that took it.
 */
@Component({
  selector: 'es-image-to-3d',
  imports: [IconDirective, SpinnerComponent],
  templateUrl: './image-to-3d.component.html',
  styleUrl: './image-to-3d.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImageTo3dComponent implements OnDestroy {
  /**
   * Where the picture is, asked for at the moment of the click. A function rather than a value: the
   * preview is drawn by an embedded web component, so its address exists only once that has rendered
   * and changes again whenever it redraws.
   */
  readonly source = input.required<() => string | null>();

  /** The content's name, which the model file is named after. */
  readonly contentName = input<string | null>(null);

  protected readonly depthModel = inject(DepthModelService);
  private readonly upload = inject(MaterialUploadService);

  /**
   * Filing the relief creates a node under the user's own account, so it hangs on a repository session
   * and not on `authorized()` — that is also true where the panel skips the login entirely and the
   * session is the host's guest, which may write nothing. Same requirement as the *Datei oder Link*
   * dialog's (`AddMaterialScreenComponent`). The conversion itself asks for no session at all: it runs
   * on the device and touches the repository only to read the picture already on screen.
   */
  protected readonly auth = inject(AuthService);

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  /** The finished relief, or `null` while there is none to show. */
  protected readonly relief = signal<Relief | null>(null);

  protected readonly converting = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The name the relief was filed under, shown as the confirmation of the save. */
  protected readonly savedAs = signal<string | null>(null);

  /** Whether this browser can draw the result at all; without it the button would lead nowhere. */
  protected readonly supported = reliefViewerSupported();

  /** The size of the model file, for the caption under the viewer. */
  protected readonly fileSize = computed(() => {
    const file = this.relief()?.file;
    return file ? `${Math.round(file.size / 1024)} kB` : null;
  });

  /** What the wait is currently spent on — the two downloads are by far the longest part of a first run. */
  protected readonly waitLabel = computed(() => {
    const progress = this.depthModel.progress();
    switch (this.depthModel.stage()) {
      case 'downloading':
        return progress === null
          ? 'Modell wird geladen …'
          : `Modell wird geladen … ${Math.round(progress * 100)} %`;
      case 'preparing':
        return 'Modell wird vorbereitet …';
      case 'running':
        return 'Tiefe wird geschätzt …';
      default:
        return 'Bild wird gelesen …';
    }
  });

  private viewer: ReliefViewer | null = null;

  constructor() {
    // The canvas exists only once a relief does, and the viewer needs the element itself — hence the
    // write phase, and hence tearing the old viewer down here rather than in the conversion.
    afterRenderEffect({
      write: () => {
        const relief = this.relief();
        const canvas = this.canvas()?.nativeElement;
        if (!relief || !canvas) return;
        if (this.viewer) return;
        try {
          this.viewer = new ReliefViewer(canvas, relief.mesh, relief.picture);
        } catch (error) {
          this.error.set(errorMessage(error));
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.viewer?.dispose();
    this.viewer = null;
  }

  /** Reads the preview picture, estimates its depth and builds the relief from the two. */
  protected async convert(): Promise<void> {
    if (this.converting()) return;
    this.error.set(null);
    this.savedAs.set(null);
    // The old relief goes before the new one is attempted, so a conversion that fails cannot leave a
    // canvas behind whose viewer has already been torn down.
    this.discard();
    this.converting.set(true);
    try {
      const address = this.source()();
      if (!address) throw new Error('Es ist kein Vorschaubild vorhanden.');
      // Through the extension's own permissions rather than through the page: the picture is served by
      // the repository, which shares it with no other origin, and it stays inside the browser either way.
      const response = await fetch(address, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Das Vorschaubild ist nicht lesbar (${response.status}).`);
      }
      const original = await response.blob();
      const picture = await decodeImage(original);
      const depth = await this.depthModel.estimate(picture);
      const texture = await toTexture(picture, original);
      const aspect = sizeOf(texture.picture).width / sizeOf(texture.picture).height;
      const mesh = buildReliefMesh(depth, aspect, DEFAULT_RELIEF_OPTIONS);
      const glb = toGlb(mesh, texture);
      this.relief.set({
        mesh,
        picture: texture.picture,
        file: new File([glb], this.fileName(), { type: GLB_MIME_TYPE })
      });
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.converting.set(false);
    }
  }

  /** Files the relief in the repository as a material of its own. */
  protected async save(): Promise<void> {
    const file = this.relief()?.file;
    // The session is checked here as well as in the template: the write would otherwise be one refusal
    // the repository has to answer, and the node it creates belongs to whoever is signed in.
    if (!file || this.saving() || !this.auth.loggedIn()) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const [created] = await this.upload.create({ kind: 'file', files: [file] });
      this.savedAs.set(created?.name ?? file.name);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Puts the view back to the angle the relief opened at. */
  protected reset(): void {
    this.viewer?.reset();
  }

  /** Drops the relief and everything drawn from it, back to the plain preview. */
  protected discard(): void {
    this.discardViewer();
    this.relief.set(null);
    this.savedAs.set(null);
    this.error.set(null);
  }

  private discardViewer(): void {
    this.viewer?.dispose();
    this.viewer = null;
  }

  /** The model's file name, derived from the content's so the two read as belonging together. */
  private fileName(): string {
    const base = (this.contentName() ?? 'vorschau').replace(/\.[^.]+$/, '').trim() || 'vorschau';
    return `${base}-3d.glb`;
  }
}

/** The picture as something drawable, whichever of the two ways the browser offers. */
async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // Revoked once decoded: the pixels are the element's own from then on.
    URL.revokeObjectURL(url);
  }
}

function sizeOf(image: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return 'naturalWidth' in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };
}

/**
 * The picture in a form the model file may carry: glTF allows PNG and JPEG only, and a picture larger
 * than {@link MAX_TEXTURE_SIZE} is scaled down first — the relief's grid is far coarser than that, so
 * the detail would go into the file's size and nowhere else. Anything already small enough and in an
 * allowed format is embedded byte for byte.
 */
async function toTexture(
  picture: ImageBitmap | HTMLImageElement,
  original: Blob
): Promise<GlbTexture & { picture: ImageBitmap | HTMLImageElement }> {
  const { width, height } = sizeOf(picture);
  const scale = Math.min(1, MAX_TEXTURE_SIZE / Math.max(width, height));
  const allowed = original.type === JPEG || original.type === 'image/png';
  if (scale === 1 && allowed) {
    return { bytes: new Uint8Array(await original.arrayBuffer()), mimeType: original.type, picture };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Kein 2D-Kontext verfügbar.');
  // On white, because JPEG has no alpha channel and an unpainted background would come out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, JPEG, JPEG_QUALITY)
  );
  if (!encoded) throw new Error('Das Vorschaubild konnte nicht umgewandelt werden.');
  return {
    bytes: new Uint8Array(await encoded.arrayBuffer()),
    mimeType: JPEG,
    picture: await decodeImage(encoded)
  };
}
