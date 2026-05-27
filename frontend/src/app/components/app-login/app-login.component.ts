import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="d-flex align-items-center justify-content-center" style="height:100vh">
      <div class="card shadow-sm" style="width:340px">
        <div class="card-body p-4">
          <h5 class="fw-semibold mb-1">BetterCamp</h5>
          <p class="text-muted small mb-4">Enter your credentials to continue.</p>

          @if (error) {
            <div class="alert alert-danger py-2 small">{{ error }}</div>
          }

          <form (ngSubmit)="submit()">
            <div class="mb-3">
              <label class="form-label small fw-medium">Username</label>
              <input class="form-control" type="text" [(ngModel)]="username"
                     name="username" autocomplete="username" required autofocus />
            </div>
            <div class="mb-4">
              <label class="form-label small fw-medium">Password</label>
              <input class="form-control" type="password" [(ngModel)]="password"
                     name="password" autocomplete="current-password" required />
            </div>
            <button class="btn btn-primary w-100" type="submit" [disabled]="loading">
              @if (loading) { <span class="spinner-border spinner-border-sm me-2"></span> }
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  `,
})
export class AppLoginComponent {
  username = '';
  password = '';
  error = '';
  loading = false;

  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  submit(): void {
    this.loading = true;
    this.error = '';
    this.api.appLogin(this.username, this.password).subscribe({
      next: () => {
        this.auth.clearCache();
        this.api.getAuthStatus().subscribe({
          next: s => this.router.navigate([s.authenticated ? '/' : '/login']),
          error: () => this.router.navigate(['/login']),
        });
      },
      error: () => {
        this.loading = false;
        this.error = 'Invalid username or password.';
      },
    });
  }
}
