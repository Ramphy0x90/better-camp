/**
 * Todo / card detail modal component.
 *
 * Opened by the kanban board when the user clicks a card.  Fetches full detail
 * (description, assignees, comments) on demand and allows posting new
 * plain-text comments.
 *
 * The modal closes when the user clicks the backdrop or the close button.
 * State is reset each time the ``todo`` input changes so stale data from the
 * previous card is never shown.
 */
import {
  Component, input, output, OnChanges, inject, signal, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../services/api.service';
import { Todo, TodoDetail } from '../../models/models';

@Component({
  selector: 'app-todo-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './todo-detail-modal.component.html',
  styleUrl: './todo-detail-modal.component.scss',
})
export class TodoDetailModalComponent implements OnChanges {
  /** The todo or card to display; set to ``null`` to close the modal. */
  todo = input<Todo | null>(null);

  /** Emitted when the modal requests to be closed. */
  closed = output<void>();

  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);

  detail = signal<TodoDetail | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  /** Draft text for the new-comment textarea. */
  newComment = signal('');
  posting = signal(false);
  postError = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['todo'] && this.todo()) {
      this.load();
    }
  }

  private load(): void {
    const t = this.todo()!;
    this.detail.set(null);
    this.loading.set(true);
    this.error.set(null);
    this.newComment.set('');
    this.postError.set(null);
    this.api.getItemDetail(t.id, t.project_id ?? t.bucket?.id ?? 0, t.item_type ?? 'todo').subscribe({
      next: d => { this.detail.set(d); this.loading.set(false); },
      error: () => { this.error.set('Failed to load details.'); this.loading.set(false); },
    });
  }

  /**
   * Sanitise raw HTML from Basecamp for safe insertion into the DOM.
   * Only used for description and comment content fields.
   */
  safeHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html ?? '');
  }

  /** Emit the ``closed`` event to let the parent hide the modal. */
  close(): void {
    this.closed.emit();
  }

  /** Close when the user clicks the backdrop (not the modal content itself). */
  onBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal')) {
      this.close();
    }
  }

  /**
   * Submit the draft comment.
   *
   * Appends the new comment to the local list on success so the UI updates
   * immediately without a full reload.
   */
  submitComment(): void {
    const content = this.newComment().trim();
    if (!content || this.posting()) return;
    const t = this.todo()!;
    const projectId = t.project_id ?? t.bucket?.id ?? 0;
    this.posting.set(true);
    this.postError.set(null);
    this.api.postComment(t.id, projectId, content).subscribe({
      next: comment => {
        this.detail.update(d => d ? { ...d, comments: [...d.comments, comment] } : d);
        this.newComment.set('');
        this.posting.set(false);
      },
      error: () => {
        this.postError.set('Failed to post comment.');
        this.posting.set(false);
      },
    });
  }

  /** Format an ISO date string to a short locale date (e.g. "May 26, 2026"). */
  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  /** Format an ISO date string to a short locale date + time. */
  formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
