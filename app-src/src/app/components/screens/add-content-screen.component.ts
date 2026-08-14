import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../../directives/icon.directive';
import { SectionId } from '../../model/navigation';
import { ConditionsService } from '../../services/conditions.service';
import { NavigationService } from '../../services/navigation.service';
import { OptionIconService } from '../../services/option-icon.service';

/** One way of adding content, offered as a card. Each one opens its own section. */
interface AddOption {
  section: SectionId;
  label: string;
  description: string;
}

// "Inhalt hinzufügen": the choice of *how* content enters the repository. A placeholder for the
// repository's own add web component — it will replace this list, which is why the options are
// data (see {@link AddOption}) and every one of them only navigates: nothing about adding content
// is implemented here.
@Component({
  selector: 'es-add-content-screen',
  imports: [IconDirective],
  templateUrl: './add-content-screen.component.html',
  styleUrl: './add-content-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddContentScreenComponent {
  protected readonly navigation = inject(NavigationService);
  protected readonly icons = inject(OptionIconService);
  private readonly conditions = inject(ConditionsService);

  private readonly allOptions: readonly AddOption[] = [
    {
      section: 'new-document',
      label: 'Erstellen',
      description: 'Ein neues Dokument anlegen und im Connector bearbeiten'
    },
    {
      section: 'add-material',
      label: 'Datei oder Link',
      description: 'Eine Datei hochladen oder einen Link als neuen Inhalt speichern'
    },
    {
      section: 'search',
      label: 'Suchen & einfügen',
      description: 'Einen vorhandenen Inhalt suchen und in das geöffnete Dokument einfügen'
    }
  ];

  /** Only what is reachable right now — the target section's own visibility decides. */
  protected readonly options = computed(() => {
    const conditions = this.conditions.snapshot();
    return this.allOptions.filter(
      (option) => this.navigation.isVisible(option.section, conditions),
    );
  });
}
