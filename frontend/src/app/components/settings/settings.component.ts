/**
 * Settings / preferences page component — ``/settings``.
 *
 * Lets the user choose which projects are pinned to the sidebar and dashboard.
 * The Basecamp account is configured via ``BASECAMP_ACCOUNT_ID`` in the
 * environment; per-person filtering is done inline on the kanban and dashboard.
 */
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { UserPreferences, Project } from '../../models/models';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);

  loading = signal(true);
  saving = signal(false);

  /** Shown briefly after a successful save. */
  saved = signal(false);
  error = signal<string | null>(null);

  projects = signal<Project[]>([]);

  /** Working copy of preferences — mutated by the UI, saved on submit. */
  prefs = signal<UserPreferences>({ pinned_project_ids: [] });

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: p => { this.prefs.set(p); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.getProjects().subscribe({ next: p => this.projects.set(p) });
  }

  /**
   * Add or remove a project from the pinned list.
   *
   * @param id - Project ID to toggle.
   */
  toggleProject(id: number): void {
    this.prefs.update(p => {
      const pinned = p.pinned_project_ids.includes(id)
        ? p.pinned_project_ids.filter(x => x !== id)
        : [...p.pinned_project_ids, id];
      return { ...p, pinned_project_ids: pinned };
    });
  }

  /** Return ``true`` if the given project is in the pinned list. */
  isPinned(id: number): boolean {
    return this.prefs().pinned_project_ids.includes(id);
  }

  /** Persist the current working preferences to the server. */
  save(): void {
    this.saving.set(true);
    this.error.set(null);
    this.api.saveSettings(this.prefs()).subscribe({
      next: p => {
        this.prefs.set(p);
        this.saving.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 2500);
      },
      error: () => {
        this.error.set('Failed to save settings.');
        this.saving.set(false);
      },
    });
  }
}
