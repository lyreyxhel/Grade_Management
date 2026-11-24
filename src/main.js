import './styles/main.css';

import { supabase, supabaseConfigured } from './lib/supabase.js';
import { renderLogin, bindLogin } from './js/auth.js';
import { renderDashboard, bindDashboard } from './js/dashboard.js';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('The #app element was not found. Check your index.html.');
}

let dashboardBindingReady = false;

async function showLogin() {
  dashboardBindingReady = false;

  if (!supabaseConfigured) {
    app.innerHTML = `

    `;
    return;
  }

  renderLogin(app);

  bindLogin(app, async (user) => {
    await showDashboard(user);
  });
}

async function showDashboard(user) {
  try {
    const dashboardUser = await renderDashboard(app, user);

    if (!dashboardBindingReady) {
      bindDashboard(app, dashboardUser, showLogin);
      dashboardBindingReady = true;
    }
  } catch (error) {
    console.error('Dashboard error:', error);

    app.innerHTML = `
      <main class="auth-container">
        <section class="auth-card">
          <h1>Unable to Load Dashboard</h1>
          <p>${String(error?.message || 'An unexpected error occurred.').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
          })[char])}</p>
          <button id="retry-login" type="button">Return to Login</button>
        </section>
      </main>
    `;

    app.querySelector('#retry-login')?.addEventListener('click', showLogin);
  }
}

async function initializeApp() {
  if (!supabaseConfigured) {
    await showLogin();
    return;
  }

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
      await showDashboard(data.session.user);
    } else {
      await showLogin();
    }
  } catch (error) {
    console.error('Application initialization error:', error);
    await showLogin();
  }
}

initializeApp();