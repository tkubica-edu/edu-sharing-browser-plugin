import { ChangeDetectionStrategy, Component } from '@angular/core';

// "Interaktionen", the fourth sub step of the Inhaltsübersicht: what a content collected in the way
// of comments and answers. The tab is in place while its content is still to come, so the screen
// names itself as unbuilt instead of standing empty — see the registry in model/navigation.ts.
@Component({
  selector: 'es-interactions-screen',
  templateUrl: './interactions-screen.component.html',
  styleUrl: './interactions-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InteractionsScreenComponent {}
