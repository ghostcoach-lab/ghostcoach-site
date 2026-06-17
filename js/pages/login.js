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
  // Decide where a logged-in user should land. Rules by users.status:
  //   trialing / active            -> /account/
  //   canceled                     -> /account/  (resubscribe flow comes later)
  //   past_due                     -> /account/  (better handling comes later)
  //   pending                      -> /payment/  (signed up, card not validated)
  //   deleted                      -> NO ACCESS  (sign out, must make a new account)
  //   anything else / unknown      -> /account/  (safe default for a logged-in user)
  // ?next= still wins for everything EXCEPT deleted (a deleted user is blocked
  // regardless of where they were headed).
  // Returns a path string, or the sentinel '__BLOCKED__' for deleted accounts.
  async function routeFor(uid) {
    let status = null;
    try {
      const { data: u } = await gcSupabase
        .from('users').select('status').eq('id', uid).maybeSingle();
      if (u) status = u.status;
    } catch (_) {}

    if (status === 'deleted') return '__BLOCKED__';

    const nextParam = new URLSearchParams(window.location.search).get('next');
    if (nextParam && /^\/[^/]/.test(nextParam)) return nextParam;

    if (status === 'pending') return '/payment/';
    // trialing, active, canceled, past_due, null/unknown -> account
    return '/account/';
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
    const dest = await routeFor(uid);
    if (dest === '__BLOCKED__') {
      // Deleted account: no access. Clear the session and send them to signup.
      // Use the raw client signOut (GCAuth.signOut() force-redirects to '/',
      // which would override the destination below).
      try { await gcSupabase.auth.signOut(); } catch (_) {}
      window.location.href = '/signup/?deleted=1';
      return;
    }
    window.location.href = dest;
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
