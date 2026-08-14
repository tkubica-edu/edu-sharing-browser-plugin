import { Pipe, PipeTransform } from '@angular/core';
import { Group, User } from 'ngx-edu-sharing-api';

/** What the pipe reads — an authority as any edu-sharing endpoint may shape it. */
type Authority = Partial<User & Group> & {
  displayName?: string;
  firstName?: string;
  lastName?: string;
};

// `AuthorityNamePipe` from ngx-edu-sharing-ui, ported: the original is not standalone, so using it would pull
// Angular Material, ngx-translate and material-design-icons into the sidebar bundle, against peer ranges that stop
// at Angular 18. The name resolution below is the original's, in its order. Left out: the avatar mode, the vCard
// salutation and the translated group/deleted-user cases, none of which apply to naming the signed-in user.
@Pipe({ name: 'authorityName' })
export class AuthorityNamePipe implements PipeTransform {
  transform(authority: Authority | null | undefined): string {
    if (!authority) return 'invalid';

    const profile = authority.profile as { displayName?: string; firstName?: string; lastName?: string } | undefined;
    if (profile?.displayName) return profile.displayName;
    if (profile?.firstName || profile?.lastName) {
      return `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();
    }
    if (authority.displayName) return authority.displayName;
    if (authority.firstName || authority.lastName) {
      return `${authority.firstName ?? ''} ${authority.lastName ?? ''}`.trim();
    }
    // The login name — the last thing an authority is still identified by.
    return authority.authorityName || 'invalid';
  }
}
