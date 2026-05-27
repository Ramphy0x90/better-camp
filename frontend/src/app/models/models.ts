/**
 * Shared domain models and constants for the BetterCamp frontend.
 *
 * These interfaces mirror the JSON shapes returned by the backend API.
 * All date fields are ISO 8601 strings unless noted otherwise.
 */

/** The four fixed columns of the kanban board. */
export type KanbanColumn = 'todo' | 'in_progress' | 'in_review' | 'done';

/** A person assigned to a todo or card. */
export interface Assignee {
  id: number;
  name: string;
  avatar_url?: string;
}

/** A single todo or card returned from the assignments or projects endpoints. */
export interface Todo {
  id: number;
  title: string;
  completed: boolean;
  due_on: string | null;
  /** Discriminates between a regular Basecamp todo and a card-table card. */
  item_type: 'todo' | 'card';
  assignees: Assignee[];
  project_id: number;
  /** The kanban column this item is currently placed in. */
  kanban_column?: KanbanColumn;
  /** The Basecamp project (bucket) this item belongs to. */
  bucket?: { id: number; name: string };
  /** The parent todo list (or card-table column) this item belongs to. */
  todolist?: { id: number; title: string };
}

/** A Basecamp project / bucket. */
export interface Project {
  id: number;
  name: string;
  description: string;
  status: string;
}

/** A todo list within a project. */
export interface TodoList {
  id: number;
  name: string;
  description: string;
  completed_ratio: string;
  todos_count: number;
}

/** A comment on a todo or card. */
export interface Comment {
  id: number;
  content: string;
  creator: { id: number; name: string; avatar_url: string } | null;
  created_at: string;
}

/** Full detail for a single todo or card, including its comments. */
export interface TodoDetail {
  id: number;
  title: string;
  description: string;
  completed: boolean;
  due_on: string | null;
  created_at: string;
  updated_at: string;
  creator: { id: number; name: string; avatar_url: string } | null;
  assignees: Assignee[];
  /** Direct link to open this item in Basecamp. */
  app_url: string;
  comments: Comment[];
}

/** A single todo in the dashboard project view. */
export interface DashboardTodo {
  id: number;
  title: string;
  completed: boolean;
  due_on: string | null;
  created_at: string | null;
  app_url: string | null;
  assignees: { id: number; name: string; avatar_url?: string }[];
}

/** A todo list with its todos, as returned by the dashboard endpoint. */
export interface DashboardList {
  id: number;
  title: string;
  todos: DashboardTodo[];
}

/** Dashboard data for a single project. */
export interface DashboardProject {
  project_id: number;
  project_name: string;
  lists: DashboardList[];
}

/** Authenticated user's profile. */
export interface Me {
  id: number;
  name: string;
  email: string;
  avatar_url: string;
}

/** A single notification derived from a recent comment on an assigned item. */
export interface Notification {
  id: number;
  /** Human-readable description, e.g. ``commented on "Fix the login bug"``. */
  title: string;
  action: string;
  /** Plain-text comment body, shown as a preview in the panel. */
  content?: string;
  creator: { id: number; name: string; avatar_url?: string } | null;
  created_at: string;
  /** Direct link to the comment in Basecamp. */
  app_url: string;
  read: boolean;
  project_name?: string;
}

/** Persisted user preferences from the Settings page. */
export interface UserPreferences {
  /** IDs of projects pinned to the sidebar and dashboard. Empty = show all. */
  pinned_project_ids: number[];
}

/** A member of a Basecamp organisation. */
export interface Person {
  id: number;
  name: string;
  email_address?: string;
  avatar_url?: string;
}

/** Metadata for each of the four kanban columns. */
export const COLUMNS: { id: KanbanColumn; label: string; colorClass: string }[] = [
  { id: 'todo',        label: 'To Do',       colorClass: 'border-secondary' },
  { id: 'in_progress', label: 'In Progress',  colorClass: 'border-primary' },
  { id: 'in_review',   label: 'In Review',    colorClass: 'border-warning' },
  { id: 'done',        label: 'Done',         colorClass: 'border-success' },
];
