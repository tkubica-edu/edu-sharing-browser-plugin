import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CurationService } from '../../../services/curation.service';
import { PageContext, contentContextOf } from '../../../util/page-context';
import { AiAssistantScreenComponent } from '../../assistant/ai-assistant-screen/ai-assistant-screen.component';

// "Individuelle Qualitätsprüfung mit KI": the content analysed against the requirements of the collection it was
// filed in, as a dialogue — one of the two processes "Prüfprozess auswählen" offers. The dialogue is the
// assistant's own chat, the same widget its screen embeds, handed the content instead of the open tab: the
// assistant retrieves the skill it checks with by the collection, and reads the content off the title and the
// text it was erschlossen from.
@Component({
  selector: 'es-ai-quality-screen',
  imports: [AiAssistantScreenComponent],
  templateUrl: './ai-quality-screen.component.html',
  styleUrl: './ai-quality-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiQualityScreenComponent {
  private readonly curation = inject(CurationService);

  /**
   * The collection the check is against: the first the filing steps put the content in. One collection, because
   * one skill is what the assistant works with — where the content was filed in several, the first is the one
   * the dialogue is about.
   */
  protected readonly collection = computed(() => this.curation.filedCollections()[0] ?? null);

  /**
   * What the assistant is handed: the content's title and text, and the collection whose requirements it is to
   * be measured against. Recomputed as the content changes, so an edit made while the dialogue is open reaches
   * it (the chat is given the new context, see AiAssistantScreenComponent).
   */
  protected readonly context = computed<PageContext>(() =>
    contentContextOf({
      title: this.curation.contentTitle(),
      text: this.curation.contentText(),
      url: this.curation.contentUrl(),
      collectionId: this.collection()?.id ?? null
    }),
  );
}
