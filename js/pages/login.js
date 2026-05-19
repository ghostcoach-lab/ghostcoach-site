// GhostCoach — Login page logic
// Requires: config.js, supabase-client.js, auth.js

(async () => {
  await GCAuth.redirectIfLoggedIn('/dashboard/');

  const form    = document.getElementById('gc-login-form');
  const emailEl = document.getElementById('gc-email');
  const passEl  = document.getElementById('gc-password');
  const errorEl = document.getElementById('gc-error');
  const btnEl   = document.getElementById('gc-submit-btn');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    btnEl.disabled = true;
    btnEl.textContent = 'Signing in…';

    try {
      await GCAuth.signIn(emailEl.value.trim(), passEl.value);
      window.location.href = '/dashboard/';
    } catch (err) {
      errorEl.textContent = err.message === 'Invalid login credentials'
        ? 'Wrong email or password.'
        : (err.message || 'Something went wrong.');
      btnEl.disabled = false;
      btnEl.textContent = 'Sign in';
    }
  });
})();
