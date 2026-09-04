import { describe, expect, it } from 'vitest';

import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('reads an Error as what it says', () => {
    expect(errorMessage(new Error('Repository nicht erreichbar'))).toBe('Repository nicht erreichbar');
  });

  it('reads anything else with a message as that message', () => {
    expect(errorMessage({ message: 'HTTP 500' })).toBe('HTTP 500');
    expect(errorMessage({ message: 404 })).toBe('404');
  });

  it('reads a thrown value that is not an error as itself, so nothing is displayed as blank', () => {
    expect(errorMessage('abgebrochen')).toBe('abgebrochen');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('reads an error whose message is empty as the error itself', () => {
    expect(errorMessage(new Error(''))).toBe('Error');
  });
});
