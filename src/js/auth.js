import { supabase } from '../lib/supabase.js';

export function renderLogin(root) {
  root.innerHTML = `
    <main class="login-layout">
      <section class="login-intro">
        <div class="brand-mark"><img src="/LOGO.jpg" alt="Balingasa High School logo" /></div>
        <p class="eyebrow">BALINGASA HIGH SCHOOL</p>
        <h1>Grade Management<br />and Distribution</h1>
        
        
      </section>
      
      <section class="login-panel">
        <form id="login-form" class="login-card">
          <p class="eyebrow">TEACHER PORTAL</p>
          <h2>Welcome back</h2>
          <p class="muted">Sign in with your school account.</p>
          <label for="email">Email address</label>
          <input id="email" name="email" type="email" autocomplete="username" placeholder="Enter your email" required />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required />
          <button class="button primary full-width" type="submit">Sign in</button>
          <p id="login-message" class="form-message" role="status"></p>
          <p class="small muted">Accounts should be created or approved by the system administrator.</p>
        </form>
      </section>
    </main>`;
}

export function bindLogin(root, onSignedIn) {
  const form = root.querySelector('#login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const message = root.querySelector('#login-message');
    const email = form.email.value.trim();
    const password = form.password.value;
    button.disabled = true;
    button.textContent = 'Signing in…';
    message.textContent = '';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    button.disabled = false;
    button.textContent = 'Sign in';

    if (error) {
      message.textContent = error.message;
      message.className = 'form-message error';
      return;
    }
    if (data.user) await onSignedIn(data.user);
  });
}