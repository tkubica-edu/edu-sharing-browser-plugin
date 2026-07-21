import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HistoryService, HistoryEntry } from '../services/history.service';

@Component({
  selector: 'es-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss'
})
export class HistoryComponent {
  readonly history = inject(HistoryService);
  readonly expanded = signal<string | null>(null);

  // Request to load a past entry into the Erschließung wizard (handled by the shell).
  @Output() open = new EventEmitter<HistoryEntry>();

  toggle(e: HistoryEntry): void {
    this.expanded.set(this.expanded() === e.id ? null : e.id);
  }

  clear(): void {
    void this.history.clear();
    this.expanded.set(null);
  }

  onImgError(ev: Event): void {
    (ev.target as HTMLImageElement).style.display = 'none';
  }
}
