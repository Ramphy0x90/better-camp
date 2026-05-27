import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.checkAll().pipe(
    map(result => {
      if (result === 'app') return router.createUrlTree(['/app-login']);
      if (result === 'basecamp') return router.createUrlTree(['/login']);
      return true;
    }),
  );
};
