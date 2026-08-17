// Comparing the addresses of pages, for the places where two of them have to be recognised as the
// same page: the judgement's input and the recognition of a page that was erschlossen before.

/**
 * Whether two addresses name the same page: a fragment is a position within the page and a trailing
 * slash the same path, so neither tells two of them apart. Nothing else is normalized — a query is
 * part of what a page shows.
 */
export function sameAddress(
  one: string | null | undefined,
  other: string | null | undefined,
): boolean {
  return !!one && !!other && normalizeAddress(one) === normalizeAddress(other);
}

/** An address in the shape {@link sameAddress} compares. */
export function normalizeAddress(address: string): string {
  try {
    const url = new URL(address);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    // Not an address the URL parser takes; compared as the text it is, minus the same two parts.
    return address.trim().replace(/#.*$/, '').replace(/\/+$/, '');
  }
}
