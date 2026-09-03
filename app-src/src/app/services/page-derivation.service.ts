import { Injectable, inject } from '@angular/core';

import { KeywordRankingService } from './keyword-ranking.service';
import { PageData } from './browser-extension.service';
import { WebsiteInformationService } from './website-information.service';
import {
  DerivationReport, derivedPayload, inferredFields, pageTermsEnvelope, rejectedFields, statedFields,
  withPageStatements
} from '../util/derived-metadata';
import { PageStatements, pageStatementsOf } from '../util/page-statements';
import { candidateKeywords, rankingTextOf } from '../util/text-keywords';
import { describesSamePage, websiteInformationFields } from '../util/website-information';
import { pageFactsOf, pageMetadata } from '../util/page-facts';

/** Log prefix for the metadata a page is described with where nothing generated it. */
const LOG = '[edu-sharing][derived]';

/** How many keywords are derived from the text where the page states none of its own. */
const DERIVED_KEYWORDS_MAX = 5;

/** What a derivation produced: the payload the flow carries on with, and what it is made of. */
export interface PageDerivation {
  payload: Record<string, unknown>;
  report: DerivationReport;
  statements: PageStatements;
}

/**
 * The content's metadata from the page alone — the way without a metadata agent and without the
 * repository's own generation. What the page *declares* about itself becomes a value; what is *derived* from
 * it becomes a proposal the form offers for acceptance (see util/derived-metadata.ts for that split, which
 * is the whole design).
 *
 * Two things are asked for beyond the page itself: the repository's own reading of the same address, which
 * the recognition fetched anyway (see WebsiteInformationService), and the keyword ranking, which is local.
 * Neither is required — a derivation without them is smaller, not wrong.
 */
@Injectable({ providedIn: 'root' })
export class PageDerivationService {
  private readonly websiteInformation = inject(WebsiteInformationService);
  private readonly ranking = inject(KeywordRankingService);

  /**
   * The page as metadata. `null` for a page nothing could be read off at all; everything else answers, since
   * a page that declares nothing still has a title and an address.
   *
   * The order the fields are assembled in *is* the precedence rule ({@link mergeDerived} keeps the first per
   * property): the page's own declarations lead, the repository's reading of the address fills what they
   * left, and the derivations come last — and only for properties still empty, because a property cannot be
   * a value and a proposal at once.
   */
  async derive(data: PageData | null | undefined): Promise<PageDerivation | null> {
    const statements = pageStatementsOf(data);
    const facts = pageFactsOf(data);
    if (!statements || !facts) return null;

    const stated = statedFields(statements);
    const fromRepository = await this.repositoryFields(statements);
    const settled = [...stated, ...fromRepository].map((field) => field.property);
    const inferred = inferredFields(statements, settled, this.derivedKeywords(statements, settled));

    const { values, origins, report } = derivedPayload(
      [...stated, ...fromRepository, ...inferred],
      rejectedFields(statements),
    );
    const payload: Record<string, unknown> = {
      // The page's three plain facts first — the title, the picture and the text it was read from. The
      // derivation's own title replaces the document title where it found a better source for it.
      ...pageMetadata(facts),
      ...values,
      ...pageTermsEnvelope(statements.terms)
    };
    if (Object.keys(origins).length) payload['_origins'] = origins;

    console.log(`${LOG} ${report.fields.length} fields derived for ${statements.url}`, {
      values: report.fields
        .filter((field) => field.standing === 'stated')
        .map((field) => `${field.property} ← ${field.source}`),
      proposals: report.fields
        .filter((field) => field.standing === 'inferred')
        .map((field) => `${field.property} ← ${field.source}`),
      notTaken: report.rejected.map((field) => `${field.property}: ${field.reason}`),
      terms: statements.terms
    });
    return { payload, report, statements };
  }

  /**
   * A generated payload with the page's own statements underneath it — the way in *with* a model. The run's
   * answer stands wherever it answered; what the page declares fills the fields it left empty, and the few
   * where a declaration outranks a generated guess replace it (see {@link withPageStatements}).
   *
   * The same reading of the same page either way, so a field means the same thing on both routes and the
   * report says where it came from. `null` for a page nothing could be read off, which leaves the caller
   * with the generated answer alone.
   */
  async deriveUnder(
    data: PageData | null | undefined,
    generated: Record<string, unknown>,
  ): Promise<PageDerivation | null> {
    const derived = await this.derive(data);
    if (!derived) return null;
    const payload = withPageStatements(generated, derived.payload);
    console.log(`${LOG} the page's statements laid under the generated answer`, {
      addedByPage: Object.keys(derived.payload).filter(
        (key) => key.includes(':') && payload[key] === derived.payload[key],
      ),
      generated: Object.keys(generated).filter((key) => key.includes(':')).length
    });
    return { ...derived, payload };
  }

  /**
   * What the repository made of the same address, where it describes the same page. The server fetches the
   * address without the user's session and without JavaScript, so behind a login or a cookie wall it
   * describes that wall — {@link describesSamePage} is what keeps such an answer out (see
   * util/website-information.ts).
   */
  private async repositoryFields(statements: PageStatements) {
    const info = await this.websiteInformation.read(statements.url);
    if (!info) return [];
    if (!describesSamePage(info, statements.title?.value, statements.contentText)) {
      console.log(
        `${LOG} the repository's reading of ${statements.url} describes another page — not used`,
        { readTitle: info.title, pageTitle: statements.title?.value },
      );
      return [];
    }
    return websiteInformationFields(info);
  }

  /**
   * Keywords out of the page's own text, ranked against it — offered only where the page states none of its
   * own, since a property holds either stated values or a proposal, never both.
   */
  private derivedKeywords(statements: PageStatements, settled: readonly string[]): string[] {
    if (settled.includes('cclom:general_keyword') || !statements.contentText) return [];
    const candidates = candidateKeywords(
      statements.contentText,
      statements.headings,
      DERIVED_KEYWORDS_MAX,
    );
    if (!candidates.length) return [];
    const ranked = this.ranking.rank(
      candidates,
      rankingTextOf([statements.title?.value ?? '', ...statements.headings], statements.contentText),
    );
    return ranked.map((entry) => entry.keyword);
  }
}
