import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { IconDirective } from '../directives/icon.directive';
import { CurationService } from '../services/curation.service';

/**
 * The Material icon for a content's `mediatype`, as the repository types it. A page recognised in the
 * browser is a `link`, which is the fallback too: the panel's content is the open page unless the
 * repository says otherwise.
 */
const TYPE_ICONS: Record<string, string> = {
  link: 'language',
  file: 'draft',
  document: 'description',
  image: 'image',
  video: 'movie',
  audio: 'volume_up',
  folder: 'folder'
};

/**
 * The card that shows *which content the panel is working on* — a heading, a tile carrying the kind
 * of content, and its name. Shared by the two places that have to say it: the main menu's centre
 * ("Geöffneter Inhalt", where it is the way into the Inhaltsoptionen) and the Inhaltsoptionen
 * themselves ("Gewählter Inhalt", where it names what the options below act on).
 *
 * The content is not passed in — both places mean the same one, so the card asks
 * {@link CurationService} for it directly. What differs is only the framing: the heading, the line
 * under the title, and whether the card is a way on ({@link interactive}) or just a statement, which
 * may carry projected content (a link to the node) under the title.
 */
@Component({
  selector: 'es-content-card',
  imports: [IconDirective, NgTemplateOutlet],
  templateUrl: './content-card.component.html',
  styleUrl: './content-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContentCardComponent {
  private readonly curation = inject(CurationService);

  /** What the card is called above it — the heading is the framing, the card body is the same. */
  readonly heading = input.required<string>();

  /** Shown in place of the title while there is no content — for a card that reports that state. */
  readonly fallbackTitle = input('');

  /** The card's own state (e.g. "Bestehender Inhalt"), set in the panel's blue. */
  readonly note = input<string | null>(null);

  /**
   * What pressing the card does, named as the step it leads to ("Inhalt jetzt erschließen") — for a
   * card that is an offer rather than a statement about a content. Shown in place of {@link note} and
   * {@link description}: those describe what is there, and this card's subject is what is not yet.
   */
  readonly action = input('');

  /**
   * The tile's glyph, where the content's own kind is not what the card is about — the offer to
   * curate the open page carries the sign for adding one. Empty means {@link typeIcon}.
   */
  readonly icon = input('');

  /** The line under the title where there is no {@link note}. */
  readonly description = input('');

  /** The content is not known yet: the tile carries the spinner instead of the type icon. */
  readonly loading = input(false);

  /** A card that is a way on: rendered as a button, and {@link activate} reports the click. */
  readonly interactive = input(false);

  readonly disabled = input(false);

  readonly activate = output<void>();

  /** The content's name, once there is a content. */
  protected readonly contentTitle = this.curation.contentTitle;

  /**
   * The kind of content the tile shows. Its *type*, not a picture of it: a screenshot of the open page
   * says nothing the page itself does not already say, and at tile size it is unreadable — whereas the
   * icon is legible and tells the one thing the card cannot say in words.
   */
  protected readonly typeIcon = computed(
    () => TYPE_ICONS[this.curation.previewNode()?.mediatype ?? ''] ?? 'language',
  );
}
