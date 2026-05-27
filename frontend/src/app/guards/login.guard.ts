import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Guard for /app-login — redirects away if already app-authenticated. */
export const appLoginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.checkAll().pipe(
    map(result => {
      if (result === 'app') return true;
      if (result === 'basecamp') return router.createUrlTree(['/login']);
      return router.createUrlTree(['/']);
    }),
  );
};

/** Guard for /login — redirects away if fully authenticated or not app-authenticated. */
export const bcLoginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.checkAll().pipe(
    map(result => {
      if (result === 'basecamp') return true;
      if (result === 'app') return router.createUrlTree(['/app-login']);
      return router.createUrlTree(['/']);
    }),
  );
};
