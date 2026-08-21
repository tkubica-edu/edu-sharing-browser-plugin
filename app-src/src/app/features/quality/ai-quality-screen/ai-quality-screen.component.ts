import {
  ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HOME_REPOSITORY, MdsDefinition, MdsService } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../../../config';
import { AuthorityNamePipe } from '../../../pipes/authority-name.pipe';
import { AuthService } from '../../../services/auth.service';
import { CurationService } from '../../../services/curation.service';
import { LeaveGuard, NavigationService } from '../../../services/navigation.service';
import {
  enrichmentSchemaOf, originSchemaOf, proofreadSchemaOf, resultSchemaOf, schemaFits
} from '../../../util/ai-schemas';
import { AI_REPLIES } from '../../../util/ai-prompts';
import { chatSession, resetChatSession } from '../../../util/chat-session';
import { firstString } from '../../../util/mds-values';
import { PageContext, contentContextOf } from '../../../util/page-context';
import {
  ContentOrigin, CriterionVerdict, EnrichedMetadata, ProofreadResult, closingInstructionOf, criteriaOf,
  criteriaPropertiesOf, enrichmentInstructionOf, enrichmentOf, enrichmentPropertiesOf, knockoutSatisfied,
  originGuessOf, originInstructionOf, originOf, proofreadInstructionOf, proofreadOf, qualityInstructionOf,
  verdictsOf
} from '../../../util/quality-check-request';
import {
  AgentResult, AiAssistantScreenComponent, AssistantTask
} from '../../assistant/ai-assistant-screen/ai-assistant-screen.component';

/** Log prefix for what this screen makes of the assistant's answer, as everywhere else in the extension. */
const LOG_QUALITY = '[edu-sharing][quality]';

/** The steps the check runs through, in the order it runs them — see {@link AiQualityScreenComponent.step}. */
type CheckStep = 'origin' | 'proofread' | 'quality' | 'enrichment' | 'done';

/**
 * The bubble each step is shown as in the chat. The instruction itself is long and written for the assistant —
 * it stays out of the conversation (see {@link AssistantTask}), and this is what the person reads in its place:
 * the step, in the words the panel uses for it elsewhere.
 */
const STEP_MESSAGE: Record<CheckStep, string> = {
  origin: 'Herkunft des Inhalts klären',
  proofread: 'Inhalt Korrektur lesen',
  quality: 'Qualität prüfen',
  enrichment: 'Metadaten anreichern',
  done: 'Prüfung abschließen'
};

/**
 * The chips of each step, as this screen offers them; the labels themselves stand beside the tasks that quote
 * them (see {@link AI_REPLIES}). Bound as a record over the steps, so a step left without chips does not
 * compile.
 */
const STEP_REPLIES: Record<Exclude<CheckStep, 'done'>, readonly string[]> = AI_REPLIES;

/**
 * The steps whose second chip asks for *changes* rather than answering the question — as against `origin`,
 * where both chips are an answer, and `proofread`, where both are a way on. Once changes are being worked on,
 * offering that chip again says nothing: it is what the person just tapped, and the way on is the other one.
 */
const ADJUSTING_STEPS: readonly CheckStep[] = ['quality', 'enrichment'];

/**
 * How many chips a turn about changes may show: the confirmation, plus up to two the widget composes from what
 * the assistant just wrote. The step's own way on therefore stays where it was, and what is offered beside it
 * follows the conversation — which is what the person is in at that point, rather than at a fork of two.
 *
 * It is the whole offer, not the number added to ours: the widget puts the stated chips in front and fills the
 * rest up to this many. One of its own that repeats one of ours is dropped, so a turn may arrive one short.
 */
const ADJUSTING_REPLIES_MAX = 3;

/**
 * Asked before the step is walked back out of: the dialogue lives in the chat widget, which is destroyed with
 * this screen, and the check cannot be picked up halfway — the next entry opens a new conversation.
 */
const LEAVE_PROMPT =
  'Wenn du diesen Schritt verlässt, wird der Dialog mit der KI beendet und der Gesprächsverlauf gelöscht. ' +
  'Trotzdem zurück?';

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
// The dialogue opens with a greeting that asks the one thing nothing here knows: whether the content is the
// person's own or someone else's. On their own content a pass over spelling and wording follows, since its
// findings are theirs to act on; on someone else's it is skipped, and the check goes straight on.
//
// Then two steps, and both end with the person: the assistant judges the quality, has them go through the
// judgement and confirm it, then enriches the metadata and has them confirm those too. Only a confirmed step
// is submitted, and only both of them together open the footer's way out. Being the one thing here that can
// talk, the assistant is what brings them there — the panel says none of it beside it.
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
  providers: [AuthorityNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiQualityScreenComponent implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly authorityName = inject(AuthorityNamePipe);
  private readonly curation = inject(CurationService);
  private readonly mdsService = inject(MdsService);
  private readonly navigation = inject(NavigationService);

  /**
   * What both back buttons ask before they walk out of this step — the topbar's and the footer's alike, since
   * the walk itself is one (NavigationService.back). Held as a field so the same function can be taken back
   * again when the screen goes.
   */
  private readonly leaveGuard: LeaveGuard = () => this.mayLeave();

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
      nodeId: this.curation.subjectNodeId()
    }),
  );

  /**
   * Whom the content names as having made it. The free-text author first, since that is the field an editor
   * fills in and the one a person would recognise themselves in; the combined publisher stands in for it where
   * the extraction found an organisation and no person.
   */
  private readonly author = computed<string | null>(() => {
    const metadata = this.curation.editorMetadata();
    return (
      firstString(metadata?.['ccm:author_freetext']) ?? firstString(metadata?.['ccm:oeh_publisher_combined'])
    );
  });

  /**
   * Who the panel is acting as, named the way the repository names them everywhere else. Handed over so the
   * assistant's guess has somebody to hold the content's author against — the two matching is the one clear
   * sign that a content is the person's own.
   */
  private readonly signedIn = computed<string | null>(() => {
    const user = this.auth.currentUser();
    const name = user ? this.authorityName.transform(user) : null;
    return (name === 'invalid' ? null : name) || this.auth.username();
  });

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
   * Which of the check's steps is out. One at a time, never two at once: they run through the same iteration
   * and token caps, and asked together they compete for them — the one the model reaches last is the one that
   * suffers. Asked in turn, each gets a run of its own, and each starts from what the previous one settled.
   *
   * `origin` is the greeting and its question, and it is what decides whether `proofread` is run at all. What
   * moves every later step on is the person, through the assistant: each task has it propose in the chat, ask
   * them to go through it, and submit only once they have confirmed — so the answer that lands here is one
   * somebody stood behind. Where they are in the check is therefore said in the conversation, by the one
   * thing on this screen that can talk; the panel does not narrate it a second time beside it.
   *
   * `done` is the end of what the panel asks for, and it too is said in the chat: the closing word
   * congratulates the person and points at the footer, which is the way on. Nothing is asked of them after
   * it — they can carry the conversation on from there.
   */
  private readonly step = signal<CheckStep>('origin');

  /**
   * How many turns have been answered since the open step was put. Its task is the first of them, so a count
   * above zero means the step's proposal is on screen and whatever comes next is the person answering it —
   * see {@link AiQualityScreenComponent.adjusting}.
   */
  private readonly turnsInStep = signal(0);

  /** Whose content this is, as the person answered the opening question; null until they have. */
  private readonly origin = signal<ContentOrigin | null>(null);

  /**
   * What the language pass found, on one's own content. Null on someone else's, where the step is not run —
   * which is a different thing from a pass that found nothing, and the two are told apart by it.
   */
  private readonly proofread = signal<ProofreadResult | null>(null);

  /** What the enrichment answered; null until it has. */
  private readonly metadata = signal<EnrichedMetadata | null>(null);

  /** The assistant's summary over the criteria, kept for the finished result. */
  private readonly summary = signal('');

  /**
   * Whether the assistant holds the content fit for use in education — its judgement over all criteria
   * together. Kept because it is the only place a collection's own requirements can land where we hold no
   * field for them: what an instruction checks beyond our criteria has nowhere else to go.
   */
  private readonly suitable = signal<boolean | null>(null);

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
    const step = this.step();
    if (step === 'origin') return announced('the opening question is asked in this shape', originSchemaOf());
    if (step === 'proofread') {
      return announced('the language pass is asked for in this shape', proofreadSchemaOf());
    }
    if (step !== 'quality') {
      return announced('the enrichment is asked for in this shape', enrichmentSchemaOf());
    }
    const schema = resultSchemaOf(criteria);
    if (schemaFits(schema)) {
      console.log(`${LOG_QUALITY} the judgement is asked for in this shape`, {
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
   * What the assistant is asked to do. A step that asks for something to be recorded is only put where the
   * answer can be recorded: a task that asks for a structured verdict without a schema to submit it in
   * produces prose about criteria, which looks like a check and records nothing.
   *
   * The closing word is the one task that is not such a step — it asks for nothing back — so it goes out
   * whether or not a schema stands.
   */
  protected readonly task = computed<AssistantTask | null>(() => {
    const step = this.step();
    if (step !== 'done' && !this.resultSchema()) return null;
    const subject = {
      title: this.curation.contentTitle(),
      text: this.curation.contentText(),
      url: this.curation.contentUrl(),
      collection: this.collection()?.name ?? null,
      author: this.author(),
      signedIn: this.signedIn()
    };
    const task =
      step === 'origin'
        ? originInstructionOf(subject)
        : step === 'proofread'
          ? proofreadInstructionOf(subject)
          : step === 'quality'
            ? qualityInstructionOf(this.criteria(), subject)
            : step === 'enrichment'
              ? enrichmentInstructionOf(subject)
              : closingInstructionOf(subject);
    // The content's own text is not in here — it travels in the page context (see contentContextOf), and
    // every task states a few hundred to a few thousand characters of instruction and nothing that grows
    // with the page.
    console.log(
      `${LOG_QUALITY} the assistant will be asked this (step ${step}, ${task.length} characters)\n${task}`,
    );
    return { text: task, message: STEP_MESSAGE[step] };
  });

  /**
   * Whether what comes next is a turn about changes rather than the step's own proposal — on a step whose
   * second chip is what the person asks for them with ({@link ADJUSTING_STEPS}).
   *
   * True as soon as that proposal has come back, which is a turn earlier than it reads: the chips of a turn
   * are settled when it is *sent*, since the widget carries them in its request — so what is offered under an
   * answer is what stood before that answer was asked for. Switched here, the reduced offer reaches the very
   * turn the person starts from the proposal; waiting for that turn to come back put it one answer late.
   */
  private readonly adjusting = computed(
    () => this.turnsInStep() > 0 && ADJUSTING_STEPS.includes(this.step()),
  );

  /**
   * What the open step offers as chips; nothing once the check is through, where there is no answer left for
   * the panel to prescribe — the closing word asks nothing, and what the person says after it is their own
   * conversation. Once the step's proposal is on screen it is the confirmation alone: the other chip is what
   * the person answers it *with*, and the widget fills the rest of the offer from what the assistant writes
   * next ({@link quickRepliesMax}). See {@link STEP_REPLIES}.
   */
  protected readonly quickReplies = computed<readonly string[]>(() => {
    const step = this.step();
    if (step === 'done') return [];
    const replies = STEP_REPLIES[step];
    return this.adjusting() ? replies.slice(0, 1) : replies;
  });

  /**
   * How many chips the widget may show, where it is to fill up past the one the panel states — only once the
   * step's proposal is out. Null everywhere else, which is what keeps a step's two answers the whole offer:
   * a proposal is answered by a tap, and a third chip from the assistant's own generator is an offer the
   * check cannot act on.
   */
  protected readonly quickRepliesMax = computed<number | null>(() =>
    this.adjusting() ? ADJUSTING_REPLIES_MAX : null,
  );

  constructor() {
    // What the check is about, before any of it goes out: the chat's own trace then says when it went.
    effect(() =>
      console.log(`${LOG_QUALITY} the check is about`, {
        title: this.curation.contentTitle(),
        nodeId: this.curation.subjectNodeId(),
        collection: this.collection(),
        url: this.curation.contentUrl(),
        textLength: this.curation.contentText().length,
        context: this.context()
      }),
    );
    effect(() => void this.load());
    this.navigation.registerLeaveGuard(this.leaveGuard);
  }

  ngOnDestroy(): void {
    this.navigation.clearLeaveGuard(this.leaveGuard);
  }

  /**
   * Whether the step may be left by a back button: the dialogue is what the check consists of and it does not
   * survive the screen, so the person is told before it goes rather than after. Confirmed, the conversation is
   * ended here and now — left in local storage it would be resumed by the next chat, which is how the previous
   * check's messages end up greeting the next one.
   *
   * Nothing to lose before the chat has a session of its own, and then nothing is asked.
   */
  private mayLeave(): boolean {
    if (!chatSession()) return true;
    if (!confirm(LEAVE_PROMPT)) return false;
    resetChatSession('the KI-Qualitätsprüfung was left');
    return true;
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
    const step = this.step();
    this.turnsInStep.update((turns) => turns + 1);
    // Past the last step there is nothing left to take over: the values are recorded, the confirmation is
    // reported, and the schema of the enrichment still stands — so a turn that fills it in again (the
    // closing word's own among them) would write an answer nobody was asked for over one that was.
    if (step === 'done') {
      console.log(`${LOG_QUALITY} ← a turn after the check — nothing left to take over`, {
        stopReason: answer.stopReason,
        result: answer.result
      });
      return;
    }
    if (step === 'origin') {
      this.takeOrigin(answer);
      return;
    }
    if (step === 'proofread') {
      this.takeProofread(answer);
      return;
    }
    if (step !== 'quality') {
      this.takeEnrichment(answer);
      return;
    }
    const { verdicts, summary, suitable, confirmed } = verdictsOf(answer.result, this.criteria());
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
      subject: { title: this.curation.contentTitle(), nodeId: this.curation.subjectNodeId() },
      collection: this.collection(),
      thisTurn: verdicts.map(({ criterion, met, reason }) => ({ criterion: criterion.caption, met, reason })),
      standing: judged.map(({ criterion, met }) => `${met ? '✓' : '✗'} ${criterion.caption}`),
      suitableForEducation: suitable,
      summary,
      recorded: properties,
      knockoutSatisfied: satisfied,
      confirmed,
      stopReason: answer.stopReason,
      raw: answer.result
    });
    this.problem.set(null);
    this.verdicts.set(judged);
    this.curation.recordValues(properties);
    this.curation.reportQualityCriteria(satisfied);
    this.summary.set(summary);
    if (suitable !== null) this.suitable.set(suitable);
    // The step is the person going through the verdicts, not the assistant reaching them: a judgement
    // submitted in the same turn as it was proposed has been put to nobody, so it is kept as it stands and
    // the step stays open. The assistant submits again once they have answered — the schema stands for every
    // turn of the conversation.
    if (!confirmed) {
      console.log(`${LOG_QUALITY} … the judgement is not confirmed yet — the step stays open`);
      return;
    }
    // What the footer's confirmation waits for: the assistant judged every criterion, including the ones it
    // found wanting, and the person has stood behind that judgement in the chat — so the button opens on a
    // judgement somebody answered for, not on a good one.
    this.curation.reportQualityJudged();
    // Only now: the enrichment is a run of its own, and it starts from a content whose quality is
    // established. Flipping the step re-states task and schema, which the chat then puts as a further turn.
    this.goTo('enrichment');
  }

  /**
   * Move the check on to `step`: its task goes out as the next turn, and the count starts again with it — what
   * the person said about the step just left says nothing about the one now open (see {@link turnsInStep}).
   */
  private goTo(step: CheckStep): void {
    this.turnsInStep.set(0);
    this.step.set(step);
  }

  /**
   * Take the answer to the opening question over — whose content this is, and with it whether the language
   * pass is run. Nothing about the content itself is settled here; what the turn establishes is who the
   * person is in relation to it, which is the one thing the panel cannot work out for itself.
   *
   * Most turns of this step submit nothing, and that is the step working: the assistant greeted, asked, and
   * is waiting. An answer arrives once the person has given one.
   */
  private takeOrigin(answer: AgentResult): void {
    const origin = originOf(answer.result);
    if (!origin) {
      console.log(`${LOG_QUALITY} ← the turn did not say whose content this is`, {
        stopReason: answer.stopReason,
        result: answer.result
      });
      this.problem.set(STOPPED[answer.stopReason] ?? null);
      return;
    }
    // Own content is the only case a language pass helps: its author can go and fix what it finds, while
    // whoever files someone else's can do nothing with a list of its typos but read it.
    const next = origin === 'own' ? 'proofread' : 'quality';
    const guess = originGuessOf(answer.result);
    console.log(`${LOG_QUALITY} ← the person calls this ${origin === 'own' ? 'their own' : "someone else's"} content`, {
      origin,
      // What the assistant took it for beforehand, and whether that held. The guess is made from the source,
      // the named author and who is signed in; how often it matches is what says whether it is worth making.
      guess,
      guessHeld: guess === null ? null : guess === origin,
      author: this.author(),
      signedIn: this.signedIn(),
      next,
      stopReason: answer.stopReason
    });
    this.problem.set(null);
    this.origin.set(origin);
    this.goTo(next);
  }

  /**
   * Take the language pass over: the places it wants changed, as the person confirmed them. They are kept and
   * logged, not recorded — there is no property on the content that holds a correction, and the person has
   * them where they are of use, which is in the chat next to their own text.
   *
   * An empty list is an answer and is taken as one: a text with nothing to correct is what this step hopes
   * for, and it moves the check on exactly like a list of findings does.
   *
   * What moves the check on is the person's decision about the places — taken on or skipped, both of them end
   * the step — and not the answer itself; see {@link ProofreadResult.decision}.
   */
  private takeProofread(answer: AgentResult): void {
    const proofread = proofreadOf(answer.result);
    if (!proofread) {
      // The ordinary case: the assistant named its corrections and is waiting for the person to go through
      // them. It submits once they have, and that turn lands here again.
      console.log(`${LOG_QUALITY} ← the turn proofread nothing`, {
        stopReason: answer.stopReason,
        result: answer.result
      });
      this.problem.set(STOPPED[answer.stopReason] ?? null);
      return;
    }
    console.log(`${LOG_QUALITY} ← the language pass names ${proofread.findings.length} place(s) to change`, {
      findings: proofread.findings.map(({ passage, correction, kind }) => `${kind}: ${passage} → ${correction}`),
      summary: proofread.summary,
      decision: proofread.decision,
      stopReason: answer.stopReason
    });
    this.problem.set(null);
    this.proofread.set(proofread);
    // The step is the person going through the places, not the assistant naming them: a pass submitted in the
    // same turn as its findings has asked nobody anything yet, so what it says is kept and the step stays open.
    // It submits again once they have answered — the schema stands for every turn of the conversation.
    if (!proofread.decision) {
      console.log(`${LOG_QUALITY} … the language pass is not decided yet — the step stays open`);
      return;
    }
    // Taken on or skipped, the step is done either way: nothing was written to the content in either case,
    // and a person who cannot edit the text right now must be able to walk on (see ProofreadResult.decision).
    this.goTo('quality');
  }

  /**
   * Take the enriched metadata over — the check's second answer and its last. What it states goes onto the
   * content's own properties, the same ones the metadata step writes: the person has been through these
   * values in the chat and confirmed them, which is what makes them the content's rather than a proposal
   * about it. They are recorded, not saved; the write is the confirmation this step ends in.
   */
  private takeEnrichment(answer: AgentResult): void {
    const metadata = enrichmentOf(answer.result);
    if (!metadata) {
      // The ordinary case, not a failure: the assistant proposed its values and is waiting for the person
      // to go through them. It submits once they have, and that turn lands here again.
      console.log(`${LOG_QUALITY} ← the turn enriched nothing`, {
        stopReason: answer.stopReason,
        result: answer.result
      });
      this.problem.set(STOPPED[answer.stopReason] ?? null);
      return;
    }
    const properties = enrichmentPropertiesOf(metadata, this.curation.editorMetadata());
    this.problem.set(null);
    this.metadata.set(metadata);
    this.curation.recordValues(properties);
    // The values are the assistant's until the person says otherwise: proposed and submitted in one turn,
    // they are a suggestion nobody has been through, and the way out of the check must not open on one. The
    // proposal is kept — a confirming turn submits it again, and then it counts.
    if (!metadata.confirmed) {
      console.log(`${LOG_QUALITY} … the metadata are not confirmed yet — the step stays open`);
      return;
    }
    this.goTo('done');
    // The other half of what the way on out of this step waits for; the judgement reported the first.
    this.curation.reportMetadataEnriched();
    // The finished result, both halves in one line: what the content is worth, and what it is about.
    console.log(`${LOG_QUALITY} ✔ the check is complete`, {
      subject: { title: this.curation.contentTitle(), nodeId: this.curation.subjectNodeId() },
      collection: this.collection(),
      origin: this.origin(),
      // Null where the pass was not run at all, which is what someone else's content means here — a text
      // that came back clean states an empty list instead.
      proofread: this.proofread(),
      quality: {
        verdicts: this.verdicts().map(({ criterion, met, reason }) => ({
          criterion: criterion.caption,
          met,
          reason
        })),
        summary: this.summary(),
        suitableForEducation: this.suitable(),
        knockoutSatisfied: this.curation.qualityCriteriaMet(),
        recorded: this.curation.editorMetadata()
      },
      metadata,
      // What of the enrichment reached the node, beside what was answered: a value whose URI came out of a
      // vocabulary the property does not hold is left out, and the two lines side by side say which.
      recordedMetadata: properties
    });
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
 * A schema, with the line that says what the assistant was asked for. Logged rather than shown: what shape an
 * answer had to arrive in is the first question about a step that answered nothing, and none of it is on
 * screen anywhere.
 */
function announced(what: string, schema: Record<string, unknown>): Record<string, unknown> {
  console.log(`${LOG_QUALITY} ${what}`, { characters: JSON.stringify(schema).length, schema });
  return schema;
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
