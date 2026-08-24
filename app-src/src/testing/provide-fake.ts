import { AbstractType, Provider, Type } from '@angular/core';

/**
 * Provide `fake` in place of the real `token`. The one place in the test setup that casts away a
 * type, so no spec has to: a fake carries only the members the service under test actually reaches
 * for, which is a `Partial` of the real thing rather than an implementation of it.
 *
 * `Partial<T>` is what keeps the fakes honest — renaming a member of the real service makes every
 * fake that still names the old one a compile error, instead of leaving specs that pass against a
 * surface the app no longer has.
 */
export function provideFake<T>(token: Type<T> | AbstractType<T>, fake: Partial<T>): Provider {
  return { provide: token, useValue: fake as unknown as T };
}
