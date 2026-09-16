import { ChangeDetectionStrategy, Component } from '@angular/core';

// The legal notice, reachable from the settings screen — see model/navigation.ts, section
// `impressum`. Deliberately a summary rather than a copy of
// `IMPRESSUM.md`: the full document is the one place this is written out in full, so the two
// cannot drift apart from having to be kept in sync by hand. `IMPRESSUM.md` is itself a draft,
// not yet filled in with the actual provider details — see its own header.
@Component({
  selector: 'es-impressum-screen',
  imports: [],
  templateUrl: './impressum-screen.component.html',
  styleUrl: './impressum-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImpressumScreenComponent {}
