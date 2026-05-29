// GhostCoach — Login page logic
// Requires: config.js, supabase-client.js, auth.js

// OAuth sign-in. Requires Google/Facebook providers to be enabled in the Supabase dashboard.
async function handleSocial(provider) {
  const errorEl = document.getElementById('gc-error');
  if (errorEl) errorEl.textContent = '';
  try {
    const { error } = await gcSupabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/dashboard/' }
    });
    if (error) throw error;
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Could not start ' + provider + ' sign-in. Please log in with email instead.';
  }
}

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
      const data = await GCAuth.signIn(emailEl.value.trim(), passEl.value);
      // Smart redirect: users with an active/trialing subscription go straight to the app;
      // anyone still in the funnel (e.g. confirmed email but no payment yet) lands on /dashboard/.
      let target = '/dashboard/';
      try {
        const { data: sub } = await gcSupabase
          .from('subscriptions')
          .select('status')
          .eq('user_id', data.user.id)
          .in('status', ['active', 'trialing'])
          .maybeSingle();
        if (sub) target = '/chat/';
      } catch (_) { /* subscriptions table not populated yet — default to /dashboard/ */ }
      window.location.href = target;
    } catch (err) {
      errorEl.textContent = err.message === 'Invalid login credentials'
        ? 'Wrong email or password.'
        : (err.message || 'Something went wrong.');
      btnEl.disabled = false;
      btnEl.textContent = 'Sign in';
    }
  });
})();
