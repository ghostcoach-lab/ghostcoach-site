// GhostCoach — Processing page (post-onboarding, Marcus profile bridge)
// Requires: config.js, supabase-client.js, auth.js, webhooks.js
//
// Behavior:
//   1. Auth gate — redirect to /login/ if not authenticated
//   2. On load — check if marcus_ready_at is already set (returning user case)
//      then redirect to /card/ immediately
//   3. Otherwise — subscribe to Supabase real-time updates on the user's
//      profile row. When n8n S2 sets marcus_ready_at, redirect to /card/
//   4. Polling fallback every 30 seconds in case real-time misses an event

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  const userId = session.user.id;
  let redirected = false;

  function redirectNext() {
    if (redirected) return;
    redirected = true;
    window.location.href = '/dashboard/';
  }

  async function checkReady() {
    if (redirected) return;
    try {
      const { data, error } = await gcSupabase
        .from('profiles')
        .select('marcus_ready_at')
        .eq('user_id', userId)
        .single();
      if (data && data.marcus_ready_at) {
        redirectNext();
      }
    } catch (e) {
      console.warn('Profile readiness check failed:', e && e.message || e);
    }
  }

  // 1. Initial check — if already ready (returning user), redirect immediately
  await checkReady();
  if (redirected) return;

  // 2. Subscribe to real-time updates on the profile row
  gcSupabase
    .channel('profile-ready-' + userId)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'profiles',
      filter: 'user_id=eq.' + userId
    }, function (payload) {
      if (payload.new && payload.new.marcus_ready_at) {
        redirectNext();
      }
    })
    .subscribe();

  // 3. Polling fallback (every 30s) — defends against missed real-time events
  setInterval(checkReady, 30000);
})();
