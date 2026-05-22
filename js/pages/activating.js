// GhostCoach — Activating page (post-card, pre-chat)
// Requires: config.js, supabase-client.js, auth.js
//
// Polls users.status every 3 seconds. When status changes to anything
// other than 'pending', redirects to /chat/. After 30 seconds of polling
// with no change, surfaces a help fallback link.

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  const userId = session.user.id;
  let redirected = false;
  let pollCount = 0;
  const HELP_AFTER_POLLS = 10;  // 10 × 3s = 30 seconds

  async function checkStatus() {
    if (redirected) return;
    pollCount++;

    try {
      const { data, error } = await gcSupabase
        .from('users')
        .select('status')
        .eq('id', userId)
        .single();
      if (data && data.status && data.status !== 'pending') {
        redirected = true;
        window.location.href = '/chat/';
        return;
      }
    } catch (e) {
      console.warn('Status poll failed:', e?.message || e);
    }

    if (pollCount >= HELP_AFTER_POLLS) {
      const help = document.getElementById('gc-help-fallback');
      if (help) help.style.display = 'block';
    }
  }

  await checkStatus();
  if (!redirected) setInterval(checkStatus, 3000);
})();
