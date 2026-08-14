import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { HistoryEntry, HistoryService } from '../../../services/history.service';

// The saved nodes, newest first. Each entry can be expanded to show its metadata, or reopened —
// loading it is the shell's job, so this component only reports the request.
@Component({
  selector: 'es-history-screen',
  imports: [DatePipe],
  templateUrl: './history-screen.component.html',
  styleUrl: './history-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryScreenComponent {
  protected readonly history = inject(HistoryService);

  /** Request to reopen a past entry. */
  readonly open = output<HistoryEntry>();

  /** Id of the expanded entry, if any. */
  protected readonly expandedId = signal<string | null>(null);

  protected toggle(entry: HistoryEntry): void {
    this.expandedId.update((id) => (id === entry.id ? null : entry.id));
  }

  protected clear(): void {
    void this.history.clear();
    this.expandedId.set(null);
  }

  protected hideBrokenIcon(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
