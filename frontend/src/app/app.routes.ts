import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { appLoginGuard, bcLoginGuard } from './guards/login.guard';

export const routes: Routes = [
  {
    path: 'app-login',
    canActivate: [appLoginGuard],
    loadComponent: () =>
      import('./components/app-login/app-login.component').then(m => m.AppLoginComponent),
  },
  {
    path: 'login',
    canActivate: [bcLoginGuard],
    loadComponent: () =>
      import('./components/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./components/shell/shell.component').then(m => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'kanban',
        loadComponent: () =>
          import('./components/kanban/kanban-board.component').then(m => m.KanbanBoardComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'projects/:id',
        loadComponent: () =>
          import('./components/project-detail/project-detail.component').then(
            m => m.ProjectDetailComponent,
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./components/settings/settings.component').then(m => m.SettingsComponent),
      },
      { path: '', redirectTo: 'kanban', pathMatch: 'full' },
    ],
  },
];
