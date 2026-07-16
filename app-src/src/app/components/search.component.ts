import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Shown only on recognized pages (e.g. the OnlyOffice editor). Placeholder for now.
@Component({
  selector: 'es-search',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent {
  @Input() contextUrl: string | null = null;
}
