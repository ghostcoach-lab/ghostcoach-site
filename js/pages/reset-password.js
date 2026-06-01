// GhostCoach — Reset Password page
// Requires: config.js, supabase-client.js, auth.js
//
// When the user clicks the recovery link in their email, they land here with
// a recovery token in the URL hash. Supabase JS picks that up automatically
// and emits a PASSWORD_RECOVERY auth event. We listen for it, then let the
// user set a new password via GCAuth.updatePassword().

(async () => {
  const form        = document.getElementById('gc-reset-form');
  const pwEl        = document.getElementById('gc-password');
  const pwConfEl    = document.getElementById('gc-password-confirm');
  const btnEl       = document.getElementById('gc-submit-btn');
  const errorEl     = document.getElementById('gc-error');
  const successEl   = document.getElementById('gc-success');
  const invalidEl   = document.getElementById('gc-invalid');
  const subtitleEl  = document.getElementById('gc-reset-subtitle');
  if (!form) return;

  let recoveryReady = false;

  // Show "invalid link" state if the user just lands here without a recovery token
  function showInvalid() {
    form.style.display = 'none';
    if (subtitleEl) subtitleEl.style.display = 'none';
    invalidEl.style.display = 'block';
    invalidEl.innerHTML = 'This password-reset link is invalid or has expired. Please <a href="/forgot-password/" style="color:var(--amber);">request a new one</a>.';
  }

  // PASSWORD_RECOVERY event fires when Supabase processes the recovery hash
  GCAuth.onAuthChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session && session.user)) {
      recoveryReady = true;
      form.style.display = 'block';
    }
  });

  // Fallback: after 1.5s, if no recovery event fired and there's no existing
  // session, treat the link as invalid.
  setTimeout(async () => {
    if (recoveryReady) return;
    const session = await GCAuth.getSession();
    if (session && session.user) {
      // Already-logged-in user manually visiting this page — let them set a new password anyway
      recoveryReady = true;
      form.style.display = 'block';
    } else {
      showInvalid();
    }
  }, 1500);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const pw     = pwEl.value || '';
    const pwConf = pwConfEl.value || '';

    if (pw.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      return;
    }
    if (pw !== pwConf) {
      errorEl.textContent = 'Passwords do not match.';
      return;
    }

    btnEl.disabled = true;
    btnEl.textContent = 'Updating…';

    try {
      await GCAuth.updatePassword(pw);
      // Signal complete — sign them out so the new password is what they log in with next
      form.style.display = 'none';
      if (subtitleEl) subtitleEl.style.display = 'none';
      successEl.style.display = 'block';
      successEl.innerHTML = '<strong>Password updated.</strong><br>Redirecting you to log in…';
      try { await GCAuth.signOut(); } catch (e) { /* ignore */ }
      setTimeout(() => { window.location.href = '/login/?reset=success'; }, 2000);
    } catch (err) {
      errorEl.textContent = (err && err.message) || 'Could not update password. Please try again.';
      btnEl.disabled = false;
      btnEl.textContent = 'Update password';
    }
  });
})();
