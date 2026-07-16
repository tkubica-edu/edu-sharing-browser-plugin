import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { BOOT_ROOT_URL } from '../app.config';

// Adds a node to a collection via the edu-sharing collection REST endpoint.
//
// ngx-edu-sharing-api does not export CollectionV1Service from its public API
// (only the read-only CollectionService wrapper), and the package's `exports` map
// blocks deep imports. So we call the same endpoint the library would
// (`addToCollection` → PUT …/references/{node}) through HttpClient. The library's
// ApiInterceptor is registered globally (withInterceptorsFromDi), so this request
// still carries the auth header + credentials.
@Injectable({ providedIn: 'root' })
export class AssignService {
  private readonly http = inject(HttpClient);
  private readonly rootUrl = inject(BOOT_ROOT_URL);

  // PUT /collection/v1/collections/{repository}/{collection}/references/{node}
  addToCollection(collectionId: string, nodeId: string, repository = '-home-'): Promise<unknown> {
    const url =
      `${this.rootUrl}/collection/v1/collections/` +
      `${encodeURIComponent(repository)}/${encodeURIComponent(collectionId)}` +
      `/references/${encodeURIComponent(nodeId)}`;
    return firstValueFrom(this.http.put(url, null));
  }
}
