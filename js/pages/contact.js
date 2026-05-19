// GhostCoach — Contact form page logic
// Requires: config.js, supabase-client.js, auth.js, webhooks.js
//
// CUSTOMIZED from webarchitect's version to preserve v22 anti-bot defences:
//   - Honeypot field check (silent rejection)
//   - Time-trap (MIN_FILL_MS = 3000ms minimum fill time)
//   - Defensive .slice() length caps (in case maxlength was bypassed)
//   - Silent rejection pattern: bot trips show same success screen as humans
//
// Server-side enforcement (n8n S7) remains the real wall. See
// /backend-specs/S7-contact-form-spec.md for the full spec.

const MIN_FILL_MS = 3000;

(async () => {
  const form     = document.getElementById('gc-contact-form');
  const btnEl    = document.getElementById('gc-submit-btn');
  const errorEl  = document.getElementById('gc-error');
  const successEl = document.getElementById('gc-success');
  const honeypotEl = document.getElementById('gc-website');
  const loadTsEl   = document.getElementById('gc-load-ts');

  if (!form) return;

  // Stamp the load time (used by the time-trap)
  if (loadTsEl) loadTsEl.value = Date.now();

  // Pre-fill email if the user is logged in
  const session = await GCAuth.getSession();
  if (session) {
    const emailEl = document.getElementById('gc-email');
    if (emailEl && !emailEl.value) emailEl.value = session.user.email;
  }

  function showSuccess() {
    form.style.display = 'none';
    if (successEl) successEl.style.display = 'block';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = '';

    // ── Defence 1: honeypot — real users never see this field ──
    if (honeypotEl && honeypotEl.value) { showSuccess(); return; }

    // ── Defence 2: time-trap — reject submissions made too fast ──
    const loadTs  = parseInt(loadTsEl?.value || '0', 10);
    const elapsed = Date.now() - loadTs;
    if (!loadTs || elapsed < MIN_FILL_MS) { showSuccess(); return; }

    btnEl.disabled = true;
    btnEl.textContent = 'Sending…';

    // ── Defence 3: length caps via .slice() — belt-and-braces ──
    const data = Object.fromEntries(new FormData(form));
    const fields = {
      user_id:  session?.user?.id ?? null,
      name:     (data.name     || '').trim().slice(0, 80),
      email:    (data.email    || '').trim().slice(0, 254),
      category: (data.category || 'general').slice(0, 32),
      subject:  (data.subject  || '(no subject)').trim().slice(0, 120),
      message:  (data.message  || '').trim().slice(0, 5000)
    };

    try {
      await GCWebhook.submitContact(fields);
      showSuccess();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || 'Could not send. Please try again.';
      btnEl.disabled = false;
      btnEl.textContent = 'Send message';
    }
  });
})();
