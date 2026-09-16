import { ChangeDetectionStrategy, Component } from '@angular/core';

// A summary of what the extension sends and stores, reachable from the onboarding screen (before a
// repository is chosen) and from the settings (afterwards) — see model/navigation.ts, section
// `privacy`. Deliberately a summary rather than a copy of `PRIVACY.md`: the full document is the one
// place this is written out in full, so the two cannot drift apart from having to be kept in sync by
// hand. `PRIVACY.md` is itself a draft, not yet legally reviewed — see its own header.
@Component({
  selector: 'es-privacy-screen',
  imports: [],
  templateUrl: './privacy-screen.component.html',
  styleUrl: './privacy-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PrivacyScreenComponent {}
