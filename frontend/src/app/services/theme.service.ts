/**
 * Bootstrap dark/light theme service.
 *
 * Persists the user's theme preference to ``localStorage`` and applies it to
 * the ``data-bs-theme`` attribute on ``<html>`` so Bootstrap picks it up.
 * Call ``init()`` once at application startup to restore the saved theme.
 */
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _dark = signal(localStorage.getItem('theme') === 'dark');

  /** Read-only signal: ``true`` when dark mode is active. */
  readonly dark = this._dark.asReadonly();

  /** Toggle between dark and light mode and persist the choice. */
  toggle(): void {
    const next = !this._dark();
    this._dark.set(next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    document.documentElement.setAttribute('data-bs-theme', next ? 'dark' : 'light');
  }

  /** Apply the saved theme preference on app startup. */
  init(): void {
    const saved = localStorage.getItem('theme') ?? 'light';
    document.documentElement.setAttribute('data-bs-theme', saved);
    this._dark.set(saved === 'dark');
  }
}
