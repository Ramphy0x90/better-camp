import { Component } from '@angular/core';

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <div class="d-flex align-items-center justify-content-center flex-column gap-3" style="height:100vh">
      <h4 class="fw-semibold">BetterCamp</h4>
      <p class="text-muted mb-1">Sign in with your Basecamp account to continue.</p>
      <a href="/auth/login" class="btn btn-primary px-4">Connect Basecamp</a>
    </div>
  `,
})
export class LoginComponent {}
