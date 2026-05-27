/**
 * Central HTTP client service for all BetterCamp backend API calls.
 *
 * Every method maps to one backend endpoint.  Base path is ``/api`` which the
 * Angular dev-server proxy (or nginx in production) forwards to the FastAPI
 * backend.
 */
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Todo, Project, TodoList, Me, KanbanColumn, TodoDetail,
  DashboardProject, Comment, Notification,
  UserPreferences, Person,
} from '../models/models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/api';

  // ── Auth ──────────────────────────────────────────────────────────────────

  /** Check whether the app-level session is authenticated. */
  checkAppAuth(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>('/auth/app-status');
  }

  /** Submit app-level username/password credentials. */
  appLogin(username: string, password: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/auth/app-login', { username, password });
  }

  /** Clear the app-level session on the server. */
  appLogout(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/auth/app-logout', {});
  }

  /** Check whether an OAuth token is stored on the server. */
  getAuthStatus(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>('/auth/status');
  }

  // ── Current user ──────────────────────────────────────────────────────────

  /** Fetch the authenticated user's profile (name, email, avatar). */
  getMe(): Observable<Me> {
    return this.http.get<Me>(`${this.base}/me`);
  }

  /** List all members of the Basecamp organisation. Used by person-filter dropdowns. */
  getPeople(): Observable<Person[]> {
    return this.http.get<Person[]>(`${this.base}/me/people`);
  }

  /**
   * Fetch recent ``commented``, ``mentioned``, and ``boosted`` activity events
   * across the user's 15 most recent assignments.
   */
  getNotifications(): Observable<Notification[]> {
    return this.http.get<Notification[]>(`${this.base}/me/notifications`);
  }

  // ── Assignments (kanban) ──────────────────────────────────────────────────

  /**
   * Fetch todos and cards for the kanban board.
   *
   * Pass ``personId`` to search another person's assignments across projects.
   * Without it, ``/my/assignments.json`` is used (token owner only).
   */
  getAssignments(page = 1, personId?: number): Observable<Todo[]> {
    const params = personId ? `page=${page}&person_id=${personId}` : `page=${page}`;
    return this.http.get<Todo[]>(`${this.base}/assignments?${params}`);
  }

  /**
   * Move a todo or card to a different kanban column.
   * Also syncs the completion state to Basecamp when moving to/from ``done``.
   */
  moveTodo(todoId: number, column: KanbanColumn, projectId: number, itemType: string): Observable<unknown> {
    return this.http.patch(`${this.base}/assignments/${todoId}/move`, {
      column,
      project_id: projectId,
      item_type: itemType,
    });
  }

  // ── Item detail & comments ────────────────────────────────────────────────

  /**
   * Fetch the full detail of a todo or card, including its comments.
   *
   * @param itemId - Basecamp recording ID.
   * @param projectId - Basecamp bucket / project ID.
   * @param itemType - ``'todo'`` or ``'card'``.
   */
  getItemDetail(itemId: number, projectId: number, itemType: string): Observable<TodoDetail> {
    return this.http.get<TodoDetail>(
      `${this.base}/items/${itemId}?project_id=${projectId}&item_type=${itemType}`,
    );
  }

  /**
   * Post a plain-text comment on a todo or card.
   *
   * @param itemId - Basecamp recording ID to comment on.
   * @param projectId - Basecamp bucket / project ID.
   * @param content - Comment body text.
   */
  postComment(itemId: number, projectId: number, content: string): Observable<Comment> {
    return this.http.post<Comment>(`${this.base}/items/${itemId}/comments`, { content, project_id: projectId });
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  /** Fetch all active projects (unfiltered). Used by the Settings page. */
  getProjects(): Observable<Project[]> {
    return this.http.get<Project[]>(`${this.base}/projects`);
  }

  /**
   * Fetch only the projects pinned in Settings.
   * Falls back to all active projects when nothing is pinned.
   * Used by the sidebar and dashboard.
   */
  getPinnedProjects(): Observable<Project[]> {
    return this.http.get<Project[]>(`${this.base}/projects?pinned=true`);
  }

  /** Fetch all todo lists for a project. */
  getTodolists(projectId: number): Observable<TodoList[]> {
    return this.http.get<TodoList[]>(`${this.base}/projects/${projectId}/todolists`);
  }

  /** Fetch all active todos in a specific todo list. */
  getTodos(projectId: number, todolistId: number): Observable<Todo[]> {
    return this.http.get<Todo[]>(`${this.base}/projects/${projectId}/todolists/${todolistId}/todos`);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /**
   * Fetch aggregated todo data for one or more projects.
   *
   * @param projectIds - List of project IDs to include.  When empty the
   *   backend defaults to pinned projects (or all active projects).
   */
  getDashboard(projectIds: number[]): Observable<DashboardProject[]> {
    const ids = projectIds.join(',');
    return this.http.get<DashboardProject[]>(`${this.base}/dashboard?project_ids=${ids}`);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  /** Fetch the current user preferences from the server. */
  getSettings(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>(`${this.base}/settings`);
  }

  /** Persist user preferences (pinned projects). */
  saveSettings(prefs: UserPreferences): Observable<UserPreferences> {
    return this.http.put<UserPreferences>(`${this.base}/settings`, prefs);
  }
}
