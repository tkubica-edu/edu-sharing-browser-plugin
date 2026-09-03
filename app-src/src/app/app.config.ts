import {
  ApplicationConfig, InjectionToken, importProvidersFrom, provideZonelessChangeDetection
} from '@angular/core';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { EduSharingApiModule } from 'ngx-edu-sharing-api';
import { BApiModule } from 'ngx-edu-sharing-b-api';

// The rootUrl (`<repo>/edu-sharing/rest`) the app was bootstrapped with. The library
// freezes rootUrl at bootstrap, so changing repositories requires a reload.
export const BOOT_ROOT_URL = new InjectionToken<string>('BOOT_ROOT_URL');

// Root providers for a given repository rootUrl. withInterceptorsFromDi() is required
// so the library's ApiInterceptor (auth header + withCredentials) runs.
export function buildAppConfig(rootUrl: string): ApplicationConfig {
  return {
    providers: [
      // The sidebar app is zoneless (signal-driven). zone.js is NOT loaded for the
      // app; the edu-sharing web-component bundle loads its own zone.js on demand
      // (see WebComponentBundleService), since that bundle is a zone-based Angular app.
      provideZonelessChangeDetection(),
      { provide: BOOT_ROOT_URL, useValue: rootUrl },
      provideHttpClient(withInterceptorsFromDi()),
      importProvidersFrom(
        EduSharingApiModule.forRoot({ rootUrl }),
        // The b-API hangs off the REST root, as it does in the edu-sharing frontend
        // (`environment.bApiUrl`). Under the same root, so the library's interceptor
        // recognises its requests as the repository's and sends the session with them.
        BApiModule.forRoot({ rootUrl: `${rootUrl}/bapi` }),
      )
    ]
  };
}
