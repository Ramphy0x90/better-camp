/**
 * Dashboard component — ``/dashboard``.
 *
 * Provides a multi-project view of todos with:
 * - Per-project tabs that load data on demand and cache it in ``_cache``.
 * - An "All" aggregate tab combining all selected projects with Chart.js
 *   visualisations (status doughnut + workload bar chart).
 * - Assignee workload breakdown per project and across all selected projects.
 * - A search filter applied to the active project's todo list.
 *
 * Project selection defaults to pinned projects from Settings; the user can
 * further refine which projects are included in the "All" view via the picker.
 */
import {
  Component, OnInit, OnDestroy, inject, signal, computed, effect, viewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { Project, DashboardProject, DashboardList, DashboardTodo, Person } from '../../models/models';

Chart.register(...registerables);

const ALL_STORAGE_KEY  = 'dashboard_all_ids';
const PIN_STORAGE_KEY  = 'dashboard_pinned_ids';

const DONE_KW     = ['done', 'completed', 'complete', 'finished', 'closed', 'fixed', 'resolved', 'shipped'];
const REVIEW_KW   = ['review', 'testing', 'qa', 'staging', 'checked'];
const PROGRESS_KW = ['progress', 'doing', 'active', 'working', 'dev', 'started', 'wip', 'current'];
const BLOCKED_KW  = ['blocked', 'stuck', 'hold', 'waiting'];

export function normalizeStatus(title: string): 'done' | 'review' | 'progress' | 'blocked' | 'open' {
  const t = title.toLowerCase();
  if (DONE_KW.some(k => t.includes(k))) return 'done';
  if (REVIEW_KW.some(k => t.includes(k))) return 'review';
  if (PROGRESS_KW.some(k => t.includes(k))) return 'progress';
  if (BLOCKED_KW.some(k => t.includes(k))) return 'blocked';
  return 'open';
}

const STATUS_COLOR: Record<string, string> = {
  done: '#198754', review: '#ffc107', progress: '#0d6efd', blocked: '#dc3545', open: '#6c757d',
};

const PERSON_PALETTE = [
  '#0d6efd','#6610f2','#6f42c1','#d63384','#dc3545',
  '#fd7e14','#ffc107','#198754','#20c997','#0dcaf0',
];

export interface AssigneeStat {
  id: number;
  name: string;
  avatar_url?: string;
  total: number;
  byList: { listTitle: string; count: number; status: string }[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private api    = inject(ApiService);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  theme          = inject(ThemeService);

  // ── state ────────────────────────────────────────────────────────────────
  allProjects        = signal<Project[]>([]);
  pinnedIds          = signal<number[]>(JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) ?? '[]'));
  activeTab          = signal<'all' | number>('all');
  projectsLoading    = signal(true);        // initial project list load
  tabLoading         = signal(false);       // per-tab load indicator
  tabError           = signal<string | null>(null);

  // Cache: projectId → loaded data
  private _cache = signal<Map<number, DashboardProject>>(new Map());

  // Which projects to include in the "All" aggregate view
  allSelectedIds = signal<number[]>([]);
  showAllPicker  = signal(false);
  allLoading     = signal(false);

  searchQuery = signal('');

  people = signal<Person[]>([]);
  selectedPersonId = signal<number | undefined>(undefined);

  // ── chart canvas refs ─────────────────────────────────────────────────────
  statusCanvas   = viewChild<ElementRef<HTMLCanvasElement>>('statusCanvas');
  workloadCanvas = viewChild<ElementRef<HTMLCanvasElement>>('workloadCanvas');
  private _charts: Chart[] = [];

  // ── computed ──────────────────────────────────────────────────────────────
  sortedProjects = computed(() => {
    const pinned = this.pinnedIds();
    const all = this.allProjects();
    return [
      ...all.filter(p => pinned.includes(p.id)),
      ...all.filter(p => !pinned.includes(p.id)),
    ];
  });

  activeProject = computed<DashboardProject | null>(() => {
    const tab = this.activeTab();
    if (tab === 'all') return null;
    return this._cache().get(tab) ?? null;
  });

  allData = computed<DashboardProject[]>(() => {
    const ids = this.allSelectedIds();
    const cache = this._cache();
    return ids.map(id => cache.get(id)).filter((p): p is DashboardProject => !!p);
  });

  listStats = computed(() => {
    const p = this.activeProject();
    if (!p) return [];
    return p.lists.map(l => ({ ...l, count: l.todos.length, status: normalizeStatus(l.title) }));
  });

  filteredListStats = computed(() => {
    const q = this.searchQuery().toLowerCase();
    if (!q) return this.listStats();
    return this.listStats()
      .map(l => ({ ...l, todos: l.todos.filter(t => t.title.toLowerCase().includes(q)) }))
      .filter(l => l.todos.length > 0);
  });

  assigneeStats = computed<AssigneeStat[]>(() => this._buildAssigneeStats(this.activeProject()?.lists ?? []));

  allTotalStats = computed(() => {
    const statusMap = new Map<string, number>();
    let total = 0;
    for (const p of this.allData()) {
      for (const l of p.lists) {
        statusMap.set(normalizeStatus(l.title), (statusMap.get(normalizeStatus(l.title)) ?? 0) + l.todos.length);
        total += l.todos.length;
      }
    }
    return {
      total,
      open:     statusMap.get('open') ?? 0,
      progress: statusMap.get('progress') ?? 0,
      review:   statusMap.get('review') ?? 0,
      blocked:  statusMap.get('blocked') ?? 0,
      done:     statusMap.get('done') ?? 0,
    };
  });

  allPersonStats = computed<AssigneeStat[]>(() => {
    const map = new Map<number, AssigneeStat & { _lm: Map<string, number> }>();
    for (const p of this.allData()) {
      for (const l of p.lists) {
        for (const todo of l.todos) {
          const people = todo.assignees.length > 0 ? todo.assignees : [{ id: 0, name: 'Unassigned', avatar_url: undefined }];
          for (const a of people) {
            if (!map.has(a.id)) map.set(a.id, { id: a.id, name: a.name, avatar_url: a.avatar_url, total: 0, byList: [], _lm: new Map() });
            const e = map.get(a.id)!;
            e.total++;
            e._lm.set(p.project_name, (e._lm.get(p.project_name) ?? 0) + 1);
          }
        }
      }
    }
    return Array.from(map.values())
      .map(e => ({ id: e.id, name: e.name, avatar_url: e.avatar_url, total: e.total, byList: Array.from(e._lm.entries()).map(([listTitle, count]) => ({ listTitle, count, status: normalizeStatus(listTitle) })) }))
      .sort((a, b) => b.total - a.total);
  });

  allStatusBreakdown = computed(() => {
    const map = new Map<string, number>();
    for (const p of this.allData()) for (const l of p.lists) if (l.todos.length) map.set(l.title, (map.get(l.title) ?? 0) + l.todos.length);
    return Array.from(map.entries()).map(([title, count]) => ({ title, count, status: normalizeStatus(title) })).sort((a, b) => b.count - a.count);
  });

  // ── lifecycle ─────────────────────────────────────────────────────────────
  constructor() {
    effect(() => {
      const tab     = this.activeTab();
      const data    = this.allData();
      const canvas1 = this.statusCanvas();
      const canvas2 = this.workloadCanvas();
      if (tab !== 'all') { this._destroyCharts(); return; }
      if (data.length > 0 && canvas1 && canvas2) {
        this._destroyCharts();
        this._renderStatusChart(canvas1.nativeElement);
        this._renderWorkloadChart(canvas2.nativeElement);
      }
    });
  }

  ngOnInit(): void {
    this.api.getPeople().subscribe({ next: p => this.people.set(p) });
    this.api.getPinnedProjects().subscribe({
      next: projects => {
        this.allProjects.set(projects);
        this.projectsLoading.set(false);

        // Restore or default the "All" selection
        const saved = localStorage.getItem(ALL_STORAGE_KEY);
        let allIds: number[];
        if (saved) {
          allIds = (JSON.parse(saved) as number[]).filter(id => projects.some(p => p.id === id));
        } else {
          allIds = projects.map(p => p.id); // default: all projects in aggregate
        }
        this.allSelectedIds.set(allIds);

        // Tab selection priority:
        // 1. ?project=<id> in the URL (deep-link)
        // 2. Exactly one project available → open it directly
        // 3. Multiple projects → overview
        const urlParam = this.route.snapshot.queryParamMap.get('project');
        if (urlParam && urlParam !== 'all') {
          const id = +urlParam;
          if (projects.some(p => p.id === id)) {
            this.selectTab(id);
            return;
          }
        }
        if (projects.length === 1) {
          this.selectTab(projects[0].id);
        } else {
          this.selectTab('all');
        }
      },
      error: () => this.projectsLoading.set(false),
    });
  }

  ngOnDestroy(): void { this._destroyCharts(); }

  // ── tab switching ─────────────────────────────────────────────────────────
  selectTab(tab: 'all' | number): void {
    this.activeTab.set(tab);
    this.searchQuery.set('');
    this.router.navigate([], { queryParams: { project: tab }, replaceUrl: true });
    if (tab === 'all') {
      this._loadMissingAllProjects();
    } else if (!this._cache().has(tab)) {
      this._loadProject(tab);
    }
  }

  private _loadProject(id: number): void {
    this.tabLoading.set(true);
    this.tabError.set(null);
    this.api.getDashboard([id]).subscribe({
      next: data => {
        if (data[0]) {
          this._cache.update(m => { const n = new Map(m); n.set(id, data[0]); return n; });
        }
        this.tabLoading.set(false);
      },
      error: () => { this.tabError.set('Failed to load project data.'); this.tabLoading.set(false); },
    });
  }

  private _loadMissingAllProjects(): void {
    const missing = this.allSelectedIds().filter(id => !this._cache().has(id));
    if (missing.length === 0) return;
    this.allLoading.set(true);
    this.api.getDashboard(missing).subscribe({
      next: data => {
        this._cache.update(m => {
          const n = new Map(m);
          for (const d of data) n.set(d.project_id, d);
          return n;
        });
        this.allLoading.set(false);
      },
      error: () => this.allLoading.set(false),
    });
  }

  // ── all-picker ────────────────────────────────────────────────────────────
  togglePin(id: number, event: MouseEvent): void {
    event.stopPropagation(); // don't trigger tab click
    const cur = this.pinnedIds();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    this.pinnedIds.set(next);
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next));
  }

  isPinned(id: number): boolean { return this.pinnedIds().includes(id); }

  toggleAllProject(id: number): void {
    const cur = this.allSelectedIds();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    this.allSelectedIds.set(next);
    localStorage.setItem(ALL_STORAGE_KEY, JSON.stringify(next));
  }

  applyAllPicker(): void {
    this.showAllPicker.set(false);
    this._loadMissingAllProjects();
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  normalizeStatus = normalizeStatus;

  /** Return ``true`` if the todo matches the selected person filter (or no filter set). */
  matchesPerson(todo: DashboardTodo): boolean {
    const id = this.selectedPersonId();
    if (!id) return true;
    return todo.assignees.some(a => a.id === id);
  }

  countByStatus(lists: DashboardList[], status: string): number {
    return lists.filter(l => normalizeStatus(l.title) === status).reduce((s, l) => s + l.todos.length, 0);
  }

  totalBugs(p: DashboardProject): number { return p.lists.reduce((s, l) => s + l.todos.length, 0); }

  cachedTotal(id: number): number {
    const p = this._cache().get(id);
    return p ? this.totalBugs(p) : -1; // -1 = not loaded yet
  }

  statusColor(s: string): string { return STATUS_COLOR[s] ?? '#6c757d'; }

  statusBadgeClass(s: string): string {
    return ({ done: 'bg-success', review: 'bg-warning text-dark', progress: 'bg-primary', blocked: 'bg-danger', open: 'bg-secondary' } as Record<string, string>)[s] ?? 'bg-secondary';
  }

  isOverdue(todo: DashboardTodo): boolean { return !!todo.due_on && new Date(todo.due_on) < new Date(); }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  initials(name: string): string { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }

  maxAssigneeTotal(): number { return Math.max(1, ...this.assigneeStats().map(a => a.total)); }

  private _buildAssigneeStats(lists: DashboardList[]): AssigneeStat[] {
    const map = new Map<number, AssigneeStat & { _lm: Map<string, number> }>();
    for (const list of lists) {
      for (const todo of list.todos) {
        const people = todo.assignees.length > 0 ? todo.assignees : [{ id: 0, name: 'Unassigned', avatar_url: undefined }];
        for (const a of people) {
          if (!map.has(a.id)) map.set(a.id, { id: a.id, name: a.name, avatar_url: a.avatar_url, total: 0, byList: [], _lm: new Map() });
          const e = map.get(a.id)!;
          e.total++;
          e._lm.set(list.title, (e._lm.get(list.title) ?? 0) + 1);
        }
      }
    }
    return Array.from(map.values())
      .map(e => ({ id: e.id, name: e.name, avatar_url: e.avatar_url, total: e.total, byList: Array.from(e._lm.entries()).map(([listTitle, count]) => ({ listTitle, count, status: normalizeStatus(listTitle) })) }))
      .sort((a, b) => b.total - a.total);
  }

  // ── charts ────────────────────────────────────────────────────────────────
  private _destroyCharts(): void { this._charts.forEach(c => c.destroy()); this._charts = []; }

  private _isDark(): boolean { return document.documentElement.getAttribute('data-bs-theme') === 'dark'; }

  private _renderStatusChart(canvas: HTMLCanvasElement): void {
    const dark = this._isDark();

    const counts: Record<string, number> = { open: 0, progress: 0, review: 0, done: 0 };
    for (const p of this.allData()) {
      for (const l of p.lists) {
        const s = normalizeStatus(l.title);
        const key = s === 'blocked' ? 'open' : s;
        counts[key] += l.todos.length;
      }
    }

    const buckets = [
      { label: 'Open',        key: 'open',     color: '#6c757d' },
      { label: 'In Progress', key: 'progress', color: '#0d6efd' },
      { label: 'In Review',   key: 'review',   color: '#ffc107' },
      { label: 'Done',        key: 'done',      color: '#198754' },
    ].filter(b => counts[b.key] > 0);

    this._charts.push(new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [{ data: buckets.map(b => counts[b.key]), backgroundColor: buckets.map(b => b.color), borderColor: dark ? '#161b22' : '#fff', borderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: dark ? '#c9d1d9' : '#212529', padding: 12, boxWidth: 12 } } },
      },
    }));
  }

  private _renderWorkloadChart(canvas: HTMLCanvasElement): void {
    const people = this.allPersonStats().slice(0, 12);
    const dark = this._isDark();
    const projectNames = [...new Set(this.allData().map(p => p.project_name))];
    const multiProject = projectNames.length > 1;

    const datasets = multiProject
      ? projectNames.map((proj, i) => ({ label: proj, data: people.map(p => p.byList.find(b => b.listTitle === proj)?.count ?? 0), backgroundColor: PERSON_PALETTE[i % PERSON_PALETTE.length] + 'cc', borderRadius: 4 }))
      : [{ label: 'Issues', data: people.map(p => p.total), backgroundColor: people.map((_, i) => PERSON_PALETTE[i % PERSON_PALETTE.length] + 'cc') as any, borderRadius: 4 }];

    this._charts.push(new Chart(canvas, {
      type: 'bar',
      data: { labels: people.map(p => p.name), datasets: datasets as any },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        scales: {
          x: { stacked: multiProject, ticks: { color: dark ? '#8b949e' : '#6c757d', precision: 0 }, grid: { color: dark ? '#30363d' : '#dee2e6' } },
          y: { stacked: multiProject, ticks: { color: dark ? '#c9d1d9' : '#212529' }, grid: { display: false } },
        },
        plugins: { legend: { display: multiProject, labels: { color: dark ? '#c9d1d9' : '#212529' } } },
      },
    }));
  }
}
