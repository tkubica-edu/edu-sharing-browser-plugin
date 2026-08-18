import { Injectable, inject, signal } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';

import { APP_CONFIG, toTopicAssistantUrl } from '../config';
import { fetchJson } from '../util/json-api';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { DevModeService } from './dev-mode.service';
import { KeywordRankingService, RankedKeyword } from './keyword-ranking.service';
import { RepositoryNodeService } from './repository-node.service';

/**
 * How long to wait for the topic assistant. It matches keywords against the whole topic tree, which is
 * fast — but it is reached through the repository's proxy, so the wait covers two hops.
 */
const TOPICS_TIMEOUT_MS = 30_000;

/**
 * How many of the content's keywords the topics are read from, unless the settings say otherwise. Every
 * further keyword widens the answer rather than sharpening it: the assistant weighs a topic by how many
 * keywords touch it, so a handful of side notes outweigh the one word the content is actually about.
 * Which few those are is {@link KeywordRankingService}'s decision — the generated order is a guess.
 */
export const DEFAULT_MAX_KEYWORDS = 3;

/**
 * The score a keyword has to reach to be asked with, unless the settings say otherwise. The ranking
 * scores against the content's own text and normalises to the best keyword it found, so the scale is
 * relative: high, because a keyword that is not almost as well supported as the best one says less
 * about the content than that one does, and the assistant weighs every keyword it is given alike.
 */
export const DEFAULT_MIN_SCORE = 0.8;

/** A keyword count as it can be used: a whole number, at least one. */
function toCount(value: unknown): number {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) ? Math.max(count, 1) : DEFAULT_MAX_KEYWORDS;
}

/** A score inside the range the ranking answers in (0 to 1). */
function toScore(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.min(Math.max(score, 0), 1) : DEFAULT_MIN_SCORE;
}

/**
 * How many of the answered topics are looked up in the repository at all. The assistant answers with
 * every topic the keywords touch, most of them beside the point; the best few by weight are the ones
 * worth checking, and each one costs two requests.
 */
const MAX_CANDIDATES = 3;

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][collection]';

/**
 * One topic of the assistant's answer. `label` is absent for a topic it names none for — the tree's
 * own root among them — and such a topic is no collection to propose, which is why only labelled ones
 * are followed up. `weight` counts the matches in the sub tree, `match` names the keywords behind it.
 */
interface Topic {
  weight?: number;
  uri?: string;
  label?: string | null;
  match?: string | null;
}

/** The topic assistant's answer (`POST …/kidra/topic-assistant-keywords`). */
interface TopicsAnswer {
  topics?: readonly Topic[];
  /** The version of the topic prediction tool, for the log. */
  version?: string;
}

/**
 * A topic that is worth looking up, reduced to the node it names — with the label and weight it was
 * chosen by, so the log can say which topics were tried and not merely which ids.
 */
interface Candidate {
  nodeId: string;
  label: string;
  weight: number;
}

/** A collection the assistant's answer led to, plus where in the repository it sits. */
export interface RecommendedCollection {
  /** The collection node itself, so a picker can list it as one of the collections it offers. */
  node: Node;
  /**
   * Its own id and those of the collections it sits in, closest first. What it belongs to is read off
   * this: a topic is nested arbitrarily deep, so its parent alone does not say whose collection it is.
   */
  ancestry: readonly string[];
}

/** The node id at the end of a topic's URI; `null` for a URI that carries none. */
function nodeIdOf(uri: string | undefined): string | null {
  const id = (uri ?? '').split('/').pop()?.trim();
  return id ? id : null;
}

/**
 * Proposes the collection a content belongs in, from the keywords that were generated for it: the topic
 * assistant answers them with the topics of the topic tree they fit, and every topic is kept in the
 * repository as a collection — so the best-weighted of its answers that really is one is the proposal.
 * Nothing is decided here; the caller decides what a proposal is worth to it.
 */
@Injectable({ providedIn: 'root' })
export class CollectionRecommendationService {
  private readonly auth = inject(AuthService);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly ranking = inject(KeywordRankingService);
  private readonly devMode = inject(DevModeService);
  private readonly repositoryNodes = inject(RepositoryNodeService);

  private readonly maxKeywordsState = signal(DEFAULT_MAX_KEYWORDS);

  /** How many keywords are asked with at most — see {@link DEFAULT_MAX_KEYWORDS}. Persisted. */
  readonly maxKeywords = this.maxKeywordsState.asReadonly();

  private readonly minScoreState = signal(DEFAULT_MIN_SCORE);

  /** What a keyword has to score to be asked with — see {@link DEFAULT_MIN_SCORE}. Persisted. */
  readonly minScore = this.minScoreState.asReadonly();

  /**
   * Load the persisted settings. Before the first proposal, so it is made the way the settings say and
   * not the way the defaults do — a proposal takes the choice of a collection, which is not something to
   * do twice differently.
   */
  async load(): Promise<void> {
    const keys = APP_CONFIG.storageKeys;
    this.maxKeywordsState.set(
      toCount(await this.browserExtension.storageGet(keys.recommendationKeywords, DEFAULT_MAX_KEYWORDS)),
    );
    this.minScoreState.set(
      toScore(await this.browserExtension.storageGet(keys.recommendationMinScore, DEFAULT_MIN_SCORE)),
    );
  }

  /** Take over how many keywords are asked with; the value is brought into range first. */
  async setMaxKeywords(count: number): Promise<void> {
    const value = toCount(count);
    this.maxKeywordsState.set(value);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.recommendationKeywords, value);
  }

  /** Take over what a keyword has to score; the value is brought into range first. */
  async setMinScore(score: number): Promise<void> {
    const value = toScore(score);
    this.minScoreState.set(value);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.recommendationMinScore, value);
  }

  /** Put both settings back to what they are without anybody setting them. */
  async resetToDefaults(): Promise<void> {
    await this.setMaxKeywords(DEFAULT_MAX_KEYWORDS);
    await this.setMinScore(DEFAULT_MIN_SCORE);
  }

  /**
   * The collection the keywords lead to — the best-weighted candidate this session can read, or `null`
   * where none of them is one. `text` is the content the keywords were generated from, which is what
   * ranks them; without it their own order stands. The whole list is taken and only the keywords that
   * carry the content asked about ({@link minScore}, {@link maxKeywords}), so the cut stays with the
   * reading of the answer it shapes — a list where nothing scores high enough asks nothing at all.
   * Rejects when the assistant itself does not answer: a proposal that could not be made is the caller's
   * to shrug off, and it reads differently from one that came up empty.
   */
  async recommend(
    keywords: readonly string[],
    text = '',
  ): Promise<RecommendedCollection | null> {
    // The dev mode's collection is the proposal, and the topic assistant is not asked at all: what a
    // step behind this one is being tested against is then the collection named in the settings rather
    // than whatever the keywords of the moment lead to (see DevModeService). The collection itself is
    // read from the repository like any other proposal, so what follows works on a real node.
    const faked = this.devMode.fakedCollectionId();
    if (faked) {
      const found = await this.resolve(faked);
      console.log(
        `${LOG} ➡ dev mode: proposing the collection from the settings`,
        found ? { id: faked, title: found.node.title ?? found.node.name, ancestry: found.ancestry } : { id: faked },
      );
      if (!found) console.warn(`${LOG} ${faked} is no collection this session can read`);
      return found;
    }
    const ranked = this.ranking.rank(keywords, text);
    // The score is only a statement where there was a text to rank against: without one every keyword
    // scores 0, and the threshold would reject the whole list rather than its weak part. The keywords
    // then stand as they were generated, and only their number is cut.
    const strong = text ? ranked.filter((entry) => entry.score >= this.minScoreState()) : ranked;
    const asked = strong.slice(0, this.maxKeywordsState()).map((entry) => entry.keyword);
    this.logRanking(ranked, asked, text);
    const query = asked.join(', ').trim();
    if (!query) return null;
    const answer = await fetchJson<TopicsAnswer>({
      service: 'Themen-Assistent',
      url: toTopicAssistantUrl(this.auth.repositoryUrl()),
      method: 'POST',
      // The assistant sits behind the repository's own proxy, which authorizes by repository session.
      credentials: 'include',
      body: { text: query },
      timeoutMs: TOPICS_TIMEOUT_MS
    });
    const candidates = this.candidatesOf(answer.topics ?? []);
    console.log(
      `${LOG} ⬅ ${answer.topics?.length ?? 0} topics, best ${candidates.length} by weight:`,
      candidates.map((candidate) => `${candidate.label} (${candidate.weight})`),
    );
    for (const candidate of candidates) {
      const found = await this.resolve(candidate.nodeId);
      if (found) {
        console.log(`${LOG} ➡ proposing`, found.node.title ?? found.node.name, found.ancestry);
        return found;
      }
      console.log(`${LOG} … ${candidate.label} (${candidate.nodeId}) is no collection to file into`);
    }
    return null;
  }

  /**
   * Report which keywords the assistant is asked with and why. The evidence goes out as a table, because
   * that is the form the ranking is judged from — why a keyword sits where it does is only visible next
   * to its neighbours' numbers, and the settings that cut the list are only readable against them.
   * Without the text the ranking has nothing to work from and the order is the one the keywords arrived
   * in, which is said rather than left to be inferred from zeroes.
   */
  private logRanking(ranked: readonly RankedKeyword[], asked: readonly string[], text: string): void {
    console.log(
      `${LOG} ➡ asking with:`,
      asked.join(', ') || '— nothing reached the minimum score',
      text ? `| ranked against ${text.length} chars of text` : '| unranked, no text to rank against',
      `| at most ${this.maxKeywordsState()}, from ${this.minScoreState()}`,
      '| left out:',
      ranked.map((entry) => entry.keyword).filter((keyword) => !asked.includes(keyword)),
    );
    console.table(
      ranked.map((entry) => ({
        keyword: entry.keyword,
        asked: asked.includes(entry.keyword),
        score: Number(entry.score.toFixed(3)),
        text: entry.textScore,
        occurrences: entry.occurrences,
        title: entry.inTitle,
        heading: entry.inHeading,
        allTerms: entry.allTermsPresent,
        agentRank: entry.agentRank
      })),
    );
  }

  /**
   * The topics worth looking up, best first: the ones the assistant named a label for — an unlabelled
   * topic is no collection to propose — by weight, which counts the matches in the topic's sub tree and
   * is the assistant's own measure of how much of the text belongs to it. Its answer's order is the
   * topic tree's, so it says nothing about fit; among equal weights it decides, since the sort is
   * stable. Each node once, and only the best few (see {@link MAX_CANDIDATES}).
   */
  private candidatesOf(topics: readonly Topic[]): Candidate[] {
    const candidates = topics
      .filter((topic) => !!topic.label?.trim())
      .slice()
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .map((topic) => ({
        nodeId: nodeIdOf(topic.uri),
        label: topic.label ?? '',
        weight: topic.weight ?? 0
      }))
      .filter((candidate): candidate is Candidate => !!candidate.nodeId);
    const seen = new Set<string>();
    const unique: Candidate[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.nodeId)) continue;
      seen.add(candidate.nodeId);
      unique.push(candidate);
    }
    return unique.slice(0, MAX_CANDIDATES);
  }

  /**
   * One candidate, or `null` where it is nothing to propose: a node the repository does not hand back
   * (gone, or not this session's to see) and a node that is not a collection are the same answer here —
   * the content cannot be filed into either.
   */
  private async resolve(nodeId: string): Promise<RecommendedCollection | null> {
    try {
      const node = await this.repositoryNodes.get(nodeId);
      if (!node.collection) return null;
      return { node, ancestry: await this.ancestryOf(node) };
    } catch {
      return null;
    }
  }

  /** The collection's own id and those of the collections it sits in, closest first. */
  private async ancestryOf(node: Node): Promise<string[]> {
    try {
      const ids = (await this.repositoryNodes.ancestors(node.ref.id)).map((entry) => entry.ref.id);
      // The answer leads with the node itself; where it does not, it is put in front — the list stands
      // for the collection *and* where it sits.
      return ids.includes(node.ref.id) ? ids : [node.ref.id, ...ids];
    } catch {
      // The chain could not be read, so the node's own parent is all that is known of where it sits.
      return node.parent?.id ? [node.ref.id, node.parent.id] : [node.ref.id];
    }
  }
}
