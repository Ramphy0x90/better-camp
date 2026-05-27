/**
 * Authentication state service.
 *
 * Handles two authentication layers:
 * 1. App-level: username/password session (required before anything else).
 * 2. Basecamp OAuth: token stored on the server.
 *
 * Both states are cached so repeated route-guard checks don't hit the network.
 */
import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, switchMap, tap, map } from 'rxjs';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);

  private _appAuth = signal<boolean | null>(null);
  private _bcAuth = signal<boolean | null>(null);

  /** Invalidate cached state (call after logout). */
  clearCache(): void {
    this._appAuth.set(null);
    this._bcAuth.set(null);
  }

  /**
   * Full auth check — returns:
   * - ``'app'``      if not app-authenticated
   * - ``'basecamp'`` if app-authenticated but no Basecamp token
   * - ``true``       if both layers pass
   */
  checkAll(): Observable<'app' | 'basecamp' | true> {
    const checkApp$: Observable<boolean> =
      this._appAuth() !== null
        ? of(this._appAuth()!)
        : this.api.checkAppAuth().pipe(
            map(s => s.authenticated),
            tap(v => this._appAuth.set(v)),
          );

    return checkApp$.pipe(
      switchMap(appOk => {
        if (!appOk) return of('app' as const);

        const checkBc$: Observable<boolean> =
          this._bcAuth() !== null
            ? of(this._bcAuth()!)
            : this.api.getAuthStatus().pipe(
                map(s => s.authenticated),
                tap(v => this._bcAuth.set(v)),
              );

        return checkBc$.pipe(
          map(bcOk => (bcOk ? (true as const) : ('basecamp' as const))),
        );
      }),
    );
  }

  /** Convenience check used by the Basecamp login component. */
  check(): Observable<boolean> {
    if (this._bcAuth() !== null) return of(this._bcAuth()!);
    return this.api.getAuthStatus().pipe(
      map(s => s.authenticated),
      tap(v => this._bcAuth.set(v)),
    );
  }
}
