// GhostCoach — Session complete / recap summary page
// Requires: config.js, supabase-client.js, auth.js
//
// Flow: chat.js endSession() stores the session id in sessionStorage as
// 'gc_last_session', then redirects here. n8n S3 (session-end) generates the
// 3-bullet summary + committed action and writes them to the sessions row,
// then emails the full recap. This page shows the summary as soon as it lands
// (immediate read → realtime subscribe → polling backup), and falls back to a
// friendly "check your inbox" message if it isn't ready within ~30s.

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  const summaryEl = document.getElementById('gc-summary');
  const actionEl  = document.getElementById('gc-action');

  const sessionId = sessionStorage.getItem('gc_last_session');

  let done = false;

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Render the 3-bullet summary + committed action. Returns true if it rendered.
  function renderSummary(row) {
    if (done || !row || !row.summary) return false;
    done = true;

    const bullets = String(row.summary)
      .split('\n')
      .map(s => s.replace(/^[-•\s]+/, '').trim())
      .filter(Boolean);

    let html = '<div class="sc-summary-head">What we covered</div><ul class="sc-bullets">';
    for (const b of bullets) html += `<li>${escapeHtml(b)}</li>`;
    html += '</ul>';
    summaryEl.innerHTML = html;

    if (row.action_committed && actionEl) {
      actionEl.innerHTML =
        '<span class="sc-action-label">Your next move</span>' + escapeHtml(row.action_committed);
      actionEl.style.display = 'block';
    }
    return true;
  }

  // Friendly fallback when the recap isn't ready yet (or we don't know the id).
  function showFallback() {
    if (done) return;
    done = true;
    summaryEl.innerHTML =
      '<div class="sc-fallback">Your recap is on its way to your inbox &mdash; ' +
      'it&rsquo;ll land in a minute or two. Open it for the full summary and your next steps.</div>';
  }

  // No session id (e.g. visited directly) → just show the email message.
  if (!sessionId) { showFallback(); return; }

  function cleanup(channel, poll) {
    sessionStorage.removeItem('gc_last_session');
    if (poll) clearInterval(poll);
    if (channel) { try { gcSupabase.removeChannel(channel); } catch (e) {} }
  }

  let channel = null;
  let poll = null;

  // 1) Immediate read — in case S3 already finished before this page loaded.
  try {
    const { data } = await gcSupabase
      .from('sessions')
      .select('summary, action_committed')
      .eq('id', sessionId)
      .single();
    if (renderSummary(data)) { cleanup(channel, poll); return; }
  } catch (e) { /* row not ready yet — fall through to subscribe/poll */ }

  // 2) Realtime subscribe — show the summary the moment S3 writes it.
  channel = gcSupabase
    .channel('session-recap-' + sessionId)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'sessions',
      filter: `id=eq.${sessionId}`
    }, (payload) => {
      if (renderSummary(payload.new)) cleanup(channel, poll);
    })
    .subscribe();

  // 3) Polling backup (in case realtime isn't enabled on the table).
  let tries = 0;
  poll = setInterval(async () => {
    if (done || tries++ >= 8) {        // ~8 × 4s ≈ 32s, then fall back
      clearInterval(poll);
      if (!done) { showFallback(); cleanup(channel, null); }
      return;
    }
    try {
      const { data } = await gcSupabase
        .from('sessions')
        .select('summary, action_committed')
        .eq('id', sessionId)
        .single();
      if (renderSummary(data)) cleanup(channel, poll);
    } catch (e) { /* keep waiting */ }
  }, 4000);
})();
