/**
 * Project detail component — ``/projects/:id``.
 *
 * Shows all todo lists for a project as collapsible accordions.
 * Individual todo lists are loaded on first expand and then cached in
 * ``todosByList`` so subsequent opens are instant.
 */
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { TodoList, Todo } from '../../models/models';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './project-detail.component.html',
})
export class ProjectDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  projectId = signal(0);
  todolists = signal<TodoList[]>([]);
  loading = signal(true);

  /** IDs of todo lists whose accordion is currently expanded. */
  openListIds = signal<number[]>([]);

  /** Cache of loaded todos keyed by todo list ID. */
  todosByList = signal<Record<number, Todo[]>>({});

  /** IDs of todo lists whose todos are currently being fetched. */
  loadingListIds = signal<number[]>([]);

  ngOnInit(): void {
    this.route.params.subscribe(p => {
      this.projectId.set(+p['id']);
      this.load();
    });
  }

  /** Fetch the top-level list of todo lists for the current project. */
  load(): void {
    this.loading.set(true);
    this.api.getTodolists(this.projectId()).subscribe({
      next: lists => {
        this.todolists.set(lists);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Return ``true`` if the given todo list's accordion is open. */
  isOpen(id: number): boolean {
    return this.openListIds().includes(id);
  }

  /** Return ``true`` if todos for the given list are currently loading. */
  isLoadingTodos(id: number): boolean {
    return this.loadingListIds().includes(id);
  }

  /**
   * Expand or collapse a todo list accordion.
   *
   * Triggers a network request the first time a list is opened; subsequent
   * opens use the cached result from ``todosByList``.
   */
  toggleList(list: TodoList): void {
    if (this.isOpen(list.id)) {
      this.openListIds.update(ids => ids.filter(id => id !== list.id));
      return;
    }
    this.openListIds.update(ids => [...ids, list.id]);
    if (this.todosByList()[list.id]) return;

    this.loadingListIds.update(ids => [...ids, list.id]);
    this.api.getTodos(this.projectId(), list.id).subscribe({
      next: todos => {
        this.todosByList.update(m => ({ ...m, [list.id]: todos }));
        this.loadingListIds.update(ids => ids.filter(id => id !== list.id));
      },
      error: () => this.loadingListIds.update(ids => ids.filter(id => id !== list.id)),
    });
  }

  /** Return the cached todos for a list, or an empty array if not yet loaded. */
  todosForList(id: number): Todo[] {
    return this.todosByList()[id] ?? [];
  }
}
