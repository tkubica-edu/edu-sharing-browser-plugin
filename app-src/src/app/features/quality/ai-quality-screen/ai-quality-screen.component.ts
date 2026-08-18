import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HOME_REPOSITORY, MdsDefinition, MdsService } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../../../config';
import { CurationService } from '../../../services/curation.service';
import { PageContext, contentContextOf } from '../../../util/page-context';
import {
  CriterionVerdict, criteriaOf, criteriaPropertiesOf, instructionOf, knockoutSatisfied, resultSchemaOf,
  schemaFits, verdictsOf
} from '../../../util/quality-check-request';
import {
  AgentResult, AiAssistantScreenComponent
} from '../../assistant/ai-assistant-screen/ai-assistant-screen.component';

/** Log prefix for what this screen makes of the assistant's answer, as everywhere else in the extension. */
const LOG_QUALITY = '[edu-sharing][quality]';

/** What each way a run can end means for the person, where it ended without an answer. */
const STOPPED: Record<string, string> = {
  deadline: 'Die Prüfung hat zu lange gedauert.',
  token_budget: 'Die Anfrage war zu umfangreich.',
  max_iterations: 'Die Prüfung brauchte zu viele Schritte.',
  no_progress: 'Die Prüfung kam nicht voran.',
  error: 'Der Dienst war kurz nicht erreichbar.'
};

// "Individuelle Qualitätsprüfung mit KI": the content analysed against the requirements of the collection it was
// filed in, as a dialogue — one of the two processes "Prüfprozess auswählen" offers. The dialogue is the
// assistant's own chat, the same widget its screen embeds, handed the content instead of the open tab: the
// assistant retrieves the skill it checks with by the collection, and reads the content off the title and the
// text it was erschlossen from.
//
// It ends in the same record the structured check produces. The criteria are read out of the metadata set and
// go to the assistant twice over: as the task, so it knows what it is judging, and as the shape of its answer,
// so what comes back can be recorded rather than read. What it answers lands in the same node properties the
// boxes of the structured check write — see {@link AiQualityScreenComponent.take}.
@Component({
  selector: 'es-ai-quality-screen',
  imports: [AiAssistantScreenComponent],
  templateUrl: './ai-quality-screen.component.html',
  styleUrl: './ai-quality-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiQualityScreenComponent {
  private readonly curation = inject(CurationService);
  private readonly mdsService = inject(MdsService);

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
      collectionId: this.collection()?.id ?? null,
      nodeId: this.curation.activeNode()?.nodeId ?? null
    }),
  );

  /**
   * The metadata set the criteria are defined in — the WLO one, as in the structured check: they are defined
   * nowhere else, and this step exists only where the panel is a WLO one anyway.
   */
  private readonly mds = signal<MdsDefinition | null>(null);

  /**
   * Whether the criteria have been looked for — however that turned out. The chat waits for it: it reads task
   * and schema as it mounts and mounts once, so one started before the criteria are known would stay a plain
   * chat for good.
   */
  protected readonly settled = signal(false);

  /** What went wrong, whether while reading the criteria or while the assistant was answering. */
  protected readonly problem = signal<string | null>(null);

  /** The criteria the content is judged by, both lists in the order the set gives them. */
  protected readonly criteria = computed(() => criteriaOf(this.mds()));

  /**
   * What the assistant answered per criterion; empty until it has. Not on screen: the dialogue itself is what
   * the person reads, and a second rendering of the same answer beside it would compete with it. It is held
   * because a later turn is laid over it, and it goes to the console for whoever is following the check.
   */
  private readonly verdicts = signal<readonly CriterionVerdict[]>([]);

  /**
   * The shape the answer has to arrive in, built from the criteria themselves. Null while there are none: a
   * schema over an empty list would ask the assistant for an empty object, and the chat is better left a plain
   * chat then — see {@link problem}, which says why the criteria are missing.
   */
  protected readonly resultSchema = computed<Record<string, unknown> | null>(() => {
    const criteria = this.criteria();
    if (!criteria.length) return null;
    const schema = resultSchemaOf(criteria);
    if (schemaFits(schema)) {
      console.log(`${LOG_QUALITY} the answer is asked for in this shape`, {
        criteria: criteria.length,
        characters: JSON.stringify(schema).length,
        schema
      });
      return schema;
    }
    // The backend refuses an oversized schema outright, which would leave a chat that answers nothing and
    // says nothing. Better to run the dialogue without a schema and say so.
    console.warn(`${LOG_QUALITY} the result schema is too large for ${criteria.length} criteria`);
    return null;
  });

  /**
   * What the assistant is asked to do. Only where the answer can be recorded: a task that asks for a
   * structured verdict without a schema to submit it in produces prose about criteria, which looks like a
   * check and records nothing.
   */
  protected readonly task = computed<string | null>(() => {
    if (!this.resultSchema()) return null;
    const text = this.curation.contentText();
    const task = instructionOf(this.criteria(), {
      title: this.curation.contentTitle(),
      text,
      url: this.curation.contentUrl(),
      collection: this.collection()?.name ?? null
    });
    console.log(
      `${LOG_QUALITY} the assistant will be asked this (${task.length} characters, ` +
        `${text.length} of them the content's own text)\n${task}`,
    );
    return task;
  });

  constructor() {
    // What the check is about, before any of it goes out: the chat's own trace then says when it went.
    effect(() =>
      console.log(`${LOG_QUALITY} the check is about`, {
        title: this.curation.contentTitle(),
        nodeId: this.curation.activeNode()?.nodeId ?? null,
        collection: this.collection(),
        url: this.curation.contentUrl(),
        textLength: this.curation.contentText().length,
        context: this.context()
      }),
    );
    effect(() => void this.load());
  }

  /**
   * Take the assistant's answer over: the verdicts onto the criteria's own properties, and the knock-out gate
   * on to the flow — the same two things the structured check's view reports, so the confirmation that follows
   * is the same statement either way.
   *
   * Fires on every turn, most of which submit nothing: someone thanking the assistant must not clear a
   * judgement that stands. So an answer without verdicts changes nothing but the note above the chat.
   *
   * What it does answer is laid over what stands rather than put in its place. A later turn is usually about
   * one criterion — the person asks after one, the assistant reconsiders it — and taking that answer as the
   * whole result would drop every other criterion from the record and close the confirmation again.
   */
  protected take(answer: AgentResult): void {
    const { verdicts, summary } = verdictsOf(answer.result, this.criteria());
    if (!verdicts.length) {
      console.log(`${LOG_QUALITY} ← the turn submitted no verdicts`, {
        stopReason: answer.stopReason,
        // Whole: an answer that carried something but not in the agreed shape is the case worth seeing,
        // and it is indistinguishable from an empty one unless it is printed.
        result: answer.result,
        standing: this.verdicts().length
      });
      this.problem.set(this.verdicts().length ? null : STOPPED[answer.stopReason] ?? null);
      return;
    }
    const judged = merge(this.verdicts(), verdicts);
    const properties = criteriaPropertiesOf(verdicts, this.mds()?.widgets, this.curation.editorMetadata());
    const satisfied = knockoutSatisfied(judged, this.criteria());
    // The whole outcome in one line, since it is not on screen anywhere: what was judged this turn, what the
    // record now says, and whether the confirmation is open.
    console.log(`${LOG_QUALITY} ← the assistant judged ${verdicts.length} criteria this turn`, {
      subject: { title: this.curation.contentTitle(), nodeId: this.curation.activeNode()?.nodeId ?? null },
      collection: this.collection(),
      thisTurn: verdicts.map(({ criterion, met, reason }) => ({ criterion: criterion.caption, met, reason })),
      standing: judged.map(({ criterion, met }) => `${met ? '✓' : '✗'} ${criterion.caption}`),
      summary,
      recorded: properties,
      knockoutSatisfied: satisfied,
      stopReason: answer.stopReason,
      raw: answer.result
    });
    this.problem.set(null);
    this.verdicts.set(judged);
    this.curation.recordValues(properties);
    this.curation.reportQualityCriteria(satisfied);
    // What the footer's confirmation waits for. Not the same as the gate above: the assistant judged
    // every criterion, including the ones it found wanting, and whether that judgement is confirmed is
    // the person's call — so the button opens on an answer, not on a good one.
    this.curation.reportQualityJudged();
  }

  /** Read the set the criteria are defined in. Without them there is nothing to check against. */
  private async load(): Promise<void> {
    console.log(`${LOG_QUALITY} reading the criteria from ${APP_CONFIG.metadataSet}`);
    try {
      this.mds.set(
        await firstValueFrom(
          this.mdsService.getMetadataSet({
            repository: HOME_REPOSITORY,
            metadataSet: APP_CONFIG.metadataSet
          }),
        ),
      );
      const criteria = this.criteria();
      console.log(`${LOG_QUALITY} ${criteria.length} criteria read`, {
        knockout: criteria.filter((item) => item.kind === 'knockout').map((item) => item.caption),
        editorial: criteria.filter((item) => item.kind === 'editorial').map((item) => item.caption),
        keys: Object.fromEntries(criteria.map((item) => [item.key, item.id]))
      });
      if (!criteria.length) {
        this.problem.set('Die Qualitätskriterien sind in diesem Repositorium nicht hinterlegt.');
      }
    } catch (error) {
      console.warn(`${LOG_QUALITY} the criteria could not be read:`, error);
      this.problem.set('Die Qualitätskriterien konnten nicht geladen werden.');
    } finally {
      this.settled.set(true);
    }
  }
}

/**
 * The verdicts as they stand after a turn: what it answered, over what was answered before, in the order the
 * criteria are shown. Kept out of the component because it is the rule about two answers to one criterion —
 * the later one is the one that counts — and not about this screen.
 */
function merge(
  standing: readonly CriterionVerdict[],
  latest: readonly CriterionVerdict[]
): readonly CriterionVerdict[] {
  const judged = new Map(standing.map((verdict) => [verdict.criterion.id, verdict]));
  for (const verdict of latest) judged.set(verdict.criterion.id, verdict);
  return [...judged.values()];
}
