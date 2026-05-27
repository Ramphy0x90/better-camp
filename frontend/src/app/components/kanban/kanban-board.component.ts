/**
 * Kanban board component — ``/kanban``.
 *
 * Displays the user's (or selected person's) Basecamp assignments as draggable
 * cards organised into four columns: To Do, In Progress, In Review, and Done.
 *
 * Drag-and-drop is handled by Angular CDK.  Moving a card to a different
 * column optimistically updates the UI and then calls the move API; on error
 * the card is reverted to its previous column.
 *
 * A small ``_dragging`` flag prevents the detail modal from opening when the
 * user ends a drag on the same card they started on.
 */
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ApiService } from '../../services/api.service';
import { Todo, KanbanColumn, COLUMNS, Person } from '../../models/models';
import { TodoDetailModalComponent } from '../todo-detail-modal/todo-detail-modal.component';

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, TodoDetailModalComponent],
  templateUrl: './kanban-board.component.html',
  styleUrl: './kanban-board.component.scss',
})
export class KanbanBoardComponent implements OnInit {
  private api = inject(ApiService);

  columns = COLUMNS;
  loading = signal(true);
  error = signal<string | null>(null);

  people = signal<Person[]>([]);
  selectedPersonId = signal<number | undefined>(undefined);

  sortBy = signal<'priority' | 'due_date' | 'assignee'>('priority');

  boardTitle = computed(() => {
    const id = this.selectedPersonId();
    if (!id) return 'My Assignments';
    const person = this.people().find(p => p.id === id);
    return person ? `${person.name}'s Assignments` : 'Assignments';
  });

  /** Cards grouped by their current kanban column. */
  cards = signal<Record<KanbanColumn, Todo[]>>({
    todo: [], in_progress: [], in_review: [], done: [],
  });

  /** The todo whose detail modal is currently open, or ``null``. */
  selectedTodo = signal<Todo | null>(null);

  /** Set to ``true`` during a drag to suppress the click-to-open-detail handler. */
  private _dragging = false;

  /** Column IDs used as CDK drop-list connection targets. */
  get columnIds(): string[] {
    return this.columns.map(c => c.id);
  }

  ngOnInit(): void {
    this.api.getPeople().subscribe({ next: p => this.people.set(p) });
    this.load();
  }

  /** Called when the person dropdown changes — reloads the board. */
  onPersonChange(value: string): void {
    this.selectedPersonId.set(value ? +value : undefined);
    this.load();
  }

  /** (Re-)fetch assignments and rebuild the column map. */
  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getAssignments(1, this.selectedPersonId()).subscribe({
      next: todos => {
        const next: Record<KanbanColumn, Todo[]> = { todo: [], in_progress: [], in_review: [], done: [] };
        for (const t of todos) {
          const col: KanbanColumn = t.kanban_column ?? 'todo';
          next[col].push(t);
        }
        for (const col of Object.keys(next) as KanbanColumn[]) {
          next[col] = this._sortTodos(next[col]);
        }
        this.cards.set(next);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load assignments.');
        this.loading.set(false);
      },
    });
  }

  /** Called when a drag gesture begins — suppresses the next click event. */
  onDragStarted(): void {
    this._dragging = true;
  }

  /** Open the detail modal, but only if this is a click (not the end of a drag). */
  openDetail(todo: Todo): void {
    if (this._dragging) {
      this._dragging = false;
      return;
    }
    this.selectedTodo.set(todo);
  }

  /**
   * Handle a CDK drag-drop event.
   *
   * Updates the in-memory column map optimistically, then persists via the API.
   * On API error the card is moved back to its original column.
   */
  drop(event: CdkDragDrop<Todo[]>, targetColumn: KanbanColumn): void {
    const todo: Todo = event.previousContainer.data[event.previousIndex];

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );
    }
    // Arrays inside the signal were mutated in-place — create new outer object to notify Angular.
    this.cards.update(c => ({ ...c }));

    if (event.previousContainer !== event.container) {
      this.api.moveTodo(todo.id, targetColumn, todo.project_id ?? todo.bucket?.['id'] ?? 0, todo.item_type ?? 'todo').subscribe({
        error: () => {
          transferArrayItem(
            event.container.data,
            event.previousContainer.data,
            event.currentIndex,
            event.previousIndex,
          );
          this.cards.update(c => ({ ...c }));
        },
      });
    }
  }

  /** ``trackBy`` function for the ``@for`` loop over todo cards. */
  trackById(_: number, todo: Todo): number {
    return todo.id;
  }

  /**
   * Map the emoji priority prefix to a sort key.
   * 🟥 = 0 (high), 🟨 = 1 (medium), 🟦 = 2 (low), none = 3 (super low).
   */
  private _priority(title: string): number {
    if (title.startsWith('🟥')) return 0;
    if (title.startsWith('🟨')) return 1;
    if (title.startsWith('🟦')) return 2;
    return 3;
  }

  /** Re-sort the currently loaded cards by the new key without reloading. */
  onSortChange(val: string): void {
    this.sortBy.set(val as 'priority' | 'due_date' | 'assignee');
    this.cards.update(c => {
      const next = { ...c } as Record<KanbanColumn, Todo[]>;
      for (const col of Object.keys(next) as KanbanColumn[]) {
        next[col] = this._sortTodos(next[col]);
      }
      return next;
    });
  }

  /** Sort todos by the active ``sortBy`` key, with secondary/tertiary tiebreakers. */
  private _sortTodos(todos: Todo[]): Todo[] {
    const by = this.sortBy();
    return [...todos].sort((a, b) => {
      const cmpPriority = () => this._priority(a.title) - this._priority(b.title);
      const cmpDue = () => {
        if (a.due_on === b.due_on) return 0;
        if (!a.due_on) return 1;
        if (!b.due_on) return -1;
        return a.due_on.localeCompare(b.due_on);
      };
      const cmpAssignee = () =>
        (a.assignees[0]?.name ?? '').localeCompare(b.assignees[0]?.name ?? '');

      if (by === 'priority')  return cmpPriority() || cmpDue()      || cmpAssignee();
      if (by === 'due_date')  return cmpDue()      || cmpPriority() || cmpAssignee();
      /* assignee */          return cmpAssignee() || cmpPriority() || cmpDue();
    });
  }

  /** Return ``true`` if the todo's due date has passed and it is not completed. */
  isOverdue(todo: Todo): boolean {
    if (!todo.due_on || todo.completed) return false;
    return new Date(todo.due_on) < new Date();
  }

  /** Return ``true`` if the todo is due within the next three days. */
  isDueSoon(todo: Todo): boolean {
    if (!todo.due_on || todo.completed) return false;
    const diff = new Date(todo.due_on).getTime() - Date.now();
    return diff >= 0 && diff < 3 * 24 * 60 * 60 * 1000;
  }
}
