import { describe, expect, it } from 'vitest';
import type { User } from 'ngx-edu-sharing-api';

import { AuthorityNamePipe } from './authority-name.pipe';

const pipe = new AuthorityNamePipe();

/** An authority in whatever shape the endpoint that answered it uses. */
function anAuthority(fields: Record<string, unknown>): User {
  return fields as unknown as User;
}

describe('AuthorityNamePipe', () => {
  it('takes the display name of the profile before anything else', () => {
    expect(
      pipe.transform(
        anAuthority({
          profile: { displayName: 'Ada Lovelace', firstName: 'Augusta', lastName: 'King' },
          displayName: 'admin',
          authorityName: 'ada',
        }),
      ),
    ).toBe('Ada Lovelace');
  });

  it('composes the profile\'s two names where it states no display name', () => {
    expect(pipe.transform(anAuthority({ profile: { firstName: 'Ada', lastName: 'Lovelace' } }))).toBe(
      'Ada Lovelace',
    );
  });

  it('composes it out of whichever of the two the profile states', () => {
    expect(pipe.transform(anAuthority({ profile: { firstName: 'Ada' } }))).toBe('Ada');
    expect(pipe.transform(anAuthority({ profile: { lastName: 'Lovelace' } }))).toBe('Lovelace');
  });

  it('falls back to the authority\'s own display name where there is no profile', () => {
    expect(pipe.transform(anAuthority({ displayName: 'Ada Lovelace', authorityName: 'ada' }))).toBe(
      'Ada Lovelace',
    );
  });

  it('falls back to the authority\'s own two names after that', () => {
    expect(pipe.transform(anAuthority({ firstName: 'Ada', lastName: 'Lovelace' }))).toBe('Ada Lovelace');
  });

  it('falls back to the login name, the last thing an authority is identified by', () => {
    expect(pipe.transform(anAuthority({ authorityName: 'ada' }))).toBe('ada');
    expect(pipe.transform(anAuthority({ profile: {}, authorityName: 'ada' }))).toBe('ada');
  });

  it('says so where the authority names nothing at all', () => {
    expect(pipe.transform(anAuthority({}))).toBe('invalid');
    expect(pipe.transform(anAuthority({ profile: { displayName: '' }, authorityName: '' }))).toBe('invalid');
    expect(pipe.transform(null)).toBe('invalid');
    expect(pipe.transform(undefined)).toBe('invalid');
  });
});
