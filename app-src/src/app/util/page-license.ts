// The licence a page states about itself, as the two properties edu-sharing stores it in. The mirror of
// `licenseUri` in amb-event.ts, which turns those properties back into a Creative Commons address — the two
// belong together, and a family added there has to be readable here.
//
// Only Creative Commons is read. A page that states "© Verlag XY" or links its terms of use under
// `rel="license"` says something real, but mapping that to a licence key would be a legal claim this cannot
// make from a footer; such a page is left without a licence for a person to choose.

import type { PageLicense } from '../services/browser-extension.service';

/** A Creative Commons licence as the node's two properties carry it. */
export interface CcLicense {
  /** `ccm:commonlicense_key` — `CC_BY_SA`, `CC_0`, `PDM`. */
  key: string;
  /** `ccm:commonlicense_cc_version` — `null` where the statement named none. */
  version: string | null;
}

/** The two public-domain dedications, which are addressed under `publicdomain` rather than as a licence. */
const DEDICATIONS: { pattern: RegExp; key: string }[] = [
  { pattern: /creativecommons\.org\/publicdomain\/zero\/([0-9](?:\.[0-9])?)/i, key: 'CC_0' },
  { pattern: /creativecommons\.org\/publicdomain\/mark\/([0-9](?:\.[0-9])?)/i, key: 'PDM' }
];

/** The licence families, as they appear in a `creativecommons.org/licenses/<family>/<version>/` address. */
const FAMILIES: readonly string[] = [
  'by-nc-sa', 'by-nc-nd', 'by-nc', 'by-sa', 'by-nd', 'by', 'zero'
];

/**
 * The licence a Creative Commons address names. `null` for every other address — including a link to a
 * site's own terms, which is what `rel="license"` most often carries.
 *
 * The version is taken from the address rather than defaulted: an address states it, and the page that
 * links `/licenses/by/` without one has said less than it looks like.
 */
export function ccLicenseOfUrl(url: string | null | undefined): CcLicense | null {
  const address = (url ?? '').trim();
  if (!address) return null;
  for (const { pattern, key } of DEDICATIONS) {
    const found = pattern.exec(address);
    if (found) return { key, version: normalizeVersion(found[1]) };
  }
  const licence = /creativecommons\.org\/licenses\/([a-z-]+)(?:\/([0-9](?:\.[0-9])?))?/i.exec(address);
  if (!licence) return null;
  const family = licence[1].toLowerCase();
  if (!FAMILIES.includes(family)) return null;
  if (family === 'zero') return { key: 'CC_0', version: normalizeVersion(licence[2]) };
  return { key: `CC_${family.toUpperCase().replace(/-/g, '_')}`, version: normalizeVersion(licence[2]) };
}

/**
 * The licence a piece of text names — `CC BY-SA 4.0`, `CC0 1.0`, `Creative Commons Attribution`. Read from
 * the spelling a licence notice actually uses, and without a version where the notice names none: a page
 * saying "CC BY" has not said 4.0, and writing one there would state a certainty nothing supports.
 */
export function ccLicenseOfText(text: string | null | undefined): CcLicense | null {
  const stated = (text ?? '').trim();
  if (!stated) return null;
  const zero = /\bCC[\s-]?0(?:[\s-]+([0-9](?:\.[0-9])?))?/i.exec(stated);
  if (zero) return { key: 'CC_0', version: normalizeVersion(zero[1]) };
  const found = /\bCC[\s-]+(BY(?:[\s-]+(?:NC[\s-]+SA|NC[\s-]+ND|NC|SA|ND))?)(?:[\s-]+([0-9](?:\.[0-9])?))?/i
    .exec(stated);
  if (!found) return null;
  const family = found[1].toUpperCase().replace(/[\s-]+/g, '_');
  return { key: `CC_${family}`, version: normalizeVersion(found[2]) };
}

/**
 * The licence of what the extraction found, and how well it is attested. `link[rel=license]` and
 * `meta[DC.rights]` are the page's own machine-readable statements; a hit in the running text or in an
 * article's footer may just as well be another resource's licence, mentioned in passing.
 */
export interface StatedLicense extends CcLicense {
  /** Where it was read — the extraction's own wording (`link[rel=license]`, `body-text`, …). */
  source: string;
  /** Whether the page declared it for itself, as opposed to it merely occurring somewhere on the page. */
  declared: boolean;
}

/** The extraction sources that count as the page declaring its own licence. */
const DECLARING_SOURCES: readonly string[] = ['link[rel=license]', 'meta[DC.rights]'];

/**
 * The licence out of what `extractLicenseInfo` found: the address first, since it is unambiguous, then the
 * text beside it. `null` where nothing Creative Commons was stated at all.
 */
export function ccLicenseOf(license: PageLicense | null | undefined): StatedLicense | null {
  if (!license) return null;
  const found = ccLicenseOfUrl(license.url) ?? ccLicenseOfText(license.text);
  if (!found) return null;
  return { ...found, source: license.source, declared: DECLARING_SOURCES.includes(license.source) };
}

/** A version as the property holds it (`4.0`), or `null` for one that was not stated. */
function normalizeVersion(version: string | null | undefined): string | null {
  const stated = (version ?? '').trim();
  if (!stated) return null;
  return stated.includes('.') ? stated : `${stated}.0`;
}
