// GhostCoach — Login page logic
// Requires: config.js, supabase-client.js, auth.js

// OAuth sign-in. Requires Google provider to be enabled in the Supabase dashboard.
// We send the user back to /login/ (not straight to /payment/) so that, on
// return, the already-logged-in routing at the bottom of this file runs and
// sends them to the right place by account status — same rules as email login.
// Any ?next= present when they clicked is preserved across the round-trip.
async function handleSocial(provider) {
  const errorEl = document.getElementById('gc-error');
  if (errorEl) errorEl.textContent = '';
  try {
    const nextParam = new URLSearchParams(window.location.search).get('next');
    let returnUrl = window.location.origin + '/login/';
    if (nextParam && /^\/[^/]/.test(nextParam)) {
      returnUrl += '?next=' + encodeURIComponent(nextParam);
    }
    const { error } = await gcSupabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: returnUrl }
    });
    if (error) throw error;
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Could not start ' + provider + ' sign-in. Please log in with email instead.';
  }
}

(async () => {
  // Decide where a logged-in user should land. ?next= always wins; otherwise
  // trialing/active -> /account/, everyone else -> /payment/. Shared by the
  // already-logged-in check below and the post-login handler.
  async function routeFor(uid) {
    const nextParam = new URLSearchParams(window.location.search).get('next');
    if (nextParam && /^\/[^/]/.test(nextParam)) return nextParam;
    let paid = false;
    try {
      const { data: u } = await gcSupabase
        .from('users').select('status').eq('id', uid).maybeSingle();
      if (u && (u.status === 'active' || u.status === 'trialing')) paid = true;
    } catch (_) {}
    if (!paid) {
      try {
        const { data: sub } = await gcSupabase
          .from('subscriptions').select('status').eq('user_id', uid)
          .in('status', ['active', 'trialing']).maybeSingle();
        if (sub) paid = true;
      } catch (_) {}
    }
    return paid ? '/account/' : '/payment/';
  }

  // Already logged in? Route them correctly instead of always bouncing to /payment/.
  // Two triggers, because OAuth returns with the session in the URL hash and the
  // client parses it asynchronously — getSession() may be null on the first read,
  // then the SIGNED_IN event fires once the hash is processed. A guard prevents
  // a double redirect if both fire.
  let routed = false;
  async function routeAndGo(uid) {
    if (routed) return;
    routed = true;
    window.location.href = await routeFor(uid);
  }
  try {
    const existing = await GCAuth.getSession();
    if (existing) { await routeAndGo(existing.user.id); return; }
  } catch (_) {}
  // Catch the OAuth round-trip: fires when the session lands after the redirect back.
  try {
    gcSupabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) routeAndGo(session.user.id);
    });
  } catch (_) {}

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
      await routeAndGo(data.user.id);
      return;
    } catch (err) {
      errorEl.textContent = err.message === 'Invalid login credentials'
        ? 'Wrong email or password.'
        : (err.message || 'Something went wrong.');
      btnEl.disabled = false;
      btnEl.textContent = 'Sign in';
    }
  });
})();
