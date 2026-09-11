import browser from 'webextension-polyfill';

/**
 * Which of the packaged edu bundle's version folders to load for a repository, and whether it is
 * the one built for the repository's exact `major.minor` or merely the closest one of the same
 * major version. See {@link selectBundleVersion}.
 */
export interface BundleVersionChoice {
  /** The version folder to load (`edu/<version>/…`), or null where none of the packaged bundles fits. */
  version: string | null;
  /** True where `version` was built for the repository's own `major.minor`. */
  exact: boolean;
}

/**
 * The URL a bundle file is packaged under, resolved through the extension's own `runtime.getURL`
 * so it survives being read outside the extension's origin (e.g. from a content script's world).
 * Falls back to the plain relative path where no `runtime` is available, as in a unit test.
 */
export function packageUrl(path: string): string {
  return browser?.runtime?.getURL ? browser.runtime.getURL(path) : path;
}

/**
 * The `major.minor` of a version string as `/_about` or a packaged folder name states it, ignoring
 * any patch component (`"11.0.2"`, `"11.0"` and `"11"` all normalize to `"11.0"`). Null for a string
 * that names no leading version number at all.
 */
export function normalizeVersion(version: string): string | null {
  const match = version.trim().match(/^(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const [, major, minor] = match;
  return `${major}.${minor ?? '0'}`;
}

/** The leading major of a `major.minor` string, as produced by {@link normalizeVersion}. */
function majorOf(version: string): number {
  return Number.parseInt(version, 10);
}

/** The minor of a `major.minor` string, as produced by {@link normalizeVersion}. */
function minorOf(version: string): number {
  return Number.parseInt(version.split('.')[1] ?? '0', 10);
}

/**
 * Which packaged edu bundle folder fits a repository that reported `reported` (already normalized
 * to `major.minor`, or null where none could be read), given the versions the package actually
 * ships (`packaged`, `major.minor` strings as `edu/versions.json` lists them).
 *
 * - No reported version at all: the repository could not be asked or named none, which is not the
 *   statement that it is unsupported (see {@link RepositoryVersionService}) — the newest packaged
 *   bundle is used, `exact: false`.
 * - An exact `major.minor` match among `packaged`: that one, `exact: true`.
 * - Same major, different minor: the closest packaged minor of that major — the highest one at or
 *   below the reported minor, or, failing that, the lowest one above it — `exact: false`.
 * - No packaged bundle of that major at all: `version: null`, which is the refusal case.
 */
export function selectBundleVersion(
  reported: string | null,
  packaged: readonly string[],
): BundleVersionChoice {
  if (packaged.length === 0) return { version: null, exact: false };

  if (reported === null) {
    const newest = [...packaged].sort((a, b) => majorOf(a) - majorOf(b) || minorOf(a) - minorOf(b)).at(-1)!;
    return { version: newest, exact: false };
  }

  if (packaged.includes(reported)) return { version: reported, exact: true };

  const sameMajor = packaged.filter((v) => majorOf(v) === majorOf(reported));
  if (sameMajor.length === 0) return { version: null, exact: false };

  const reportedMinor = minorOf(reported);
  const atOrBelow = sameMajor.filter((v) => minorOf(v) <= reportedMinor);
  const closest = atOrBelow.length > 0
    ? atOrBelow.sort((a, b) => minorOf(b) - minorOf(a))[0]
    : sameMajor.sort((a, b) => minorOf(a) - minorOf(b))[0];
  return { version: closest, exact: false };
}
