import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent],
  template: `
    <div class="app-shell d-flex h-100">
      <app-sidebar />
      <main class="flex-grow-1 overflow-auto p-4">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [`.app-shell { height: 100vh; }`],
})
export class ShellComponent {}
