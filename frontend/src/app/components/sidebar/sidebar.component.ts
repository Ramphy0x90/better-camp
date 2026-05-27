/**
 * Application sidebar component.
 *
 * Renders the navigation links, pinned project list, user profile footer, and
 * the notifications bell icon with its dropdown panel.
 *
 * Notifications are loaded lazily — only on the first time the bell is clicked.
 * The dropdown closes when the user clicks anywhere outside the sidebar, handled
 * via a ``@HostListener`` on the document click event.
 */
import { Component, OnInit, inject, signal, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { Project, Me, Notification } from '../../models/models';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private el = inject(ElementRef);
  theme = inject(ThemeService);

  /** Pinned projects displayed in the nav (falls back to all active projects). */
  projects = signal<Project[]>([]);
  me = signal<Me | null>(null);
  notifications = signal<Notification[]>([]);

  /** Whether the notifications dropdown panel is currently open. */
  notifOpen = signal(false);

  /** ``true`` while the initial notifications fetch is in flight. */
  notifLoading = signal(false);

  /** Error message set when the notifications fetch fails. */
  notifError = signal<string | null>(null);

  /** Number of unread notifications, shown as a badge on the bell icon. */
  get unreadCount(): number {
    return this.notifications().filter(n => !n.read).length;
  }

  ngOnInit(): void {
    this.api.getPinnedProjects().subscribe({ next: p => this.projects.set(p) });
    this.api.getMe().subscribe({ next: m => this.me.set(m) });
  }

  /**
   * Toggle the notifications panel.
   *
   * Fetches notifications on first open; subsequent opens reuse the cached
   * list from the current session.
   */
  toggleNotif(): void {
    if (!this.notifOpen()) {
      this.notifOpen.set(true);
      this.notifError.set(null);
      this.notifLoading.set(true);
      this.api.getNotifications().subscribe({
        next: n => { this.notifications.set(n); this.notifLoading.set(false); },
        error: () => {
          this.notifError.set('Could not load notifications.');
          this.notifLoading.set(false);
        },
      });
    } else {
      this.notifOpen.set(false);
    }
  }

  /** Close the notifications panel when the user clicks outside the sidebar. */
  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (this.notifOpen() && !this.el.nativeElement.contains(event.target)) {
      this.notifOpen.set(false);
    }
  }

  /** Log out of the app session and redirect to the login page. */
  logout(): void {
    this.api.appLogout().subscribe({
      next: () => {
        this.auth.clearCache();
        this.router.navigate(['/app-login']);
      },
      error: () => {
        this.auth.clearCache();
        this.router.navigate(['/app-login']);
      },
    });
  }

  /** Format an ISO date string to a compact locale date + time for notification timestamps. */
  formatDateTime(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
