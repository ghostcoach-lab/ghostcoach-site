// GhostCoach — Forgot Password page
// Requires: config.js, supabase-client.js, auth.js
//
// On submit: calls GCAuth.resetPassword(email), which asks Supabase to email
// a recovery link. The link sends the user to /reset-password/ where the
// session is established and they can set a new password.

(async () => {
  const form     = document.getElementById('gc-forgot-form');
  const emailEl  = document.getElementById('gc-email');
  const btnEl    = document.getElementById('gc-submit-btn');
  const errorEl  = document.getElementById('gc-error');
  const successEl = document.getElementById('gc-success');
  if (!form) return;

  // Pre-fill email if it was passed via ?email= or sessionStorage
  try {
    const urlEmail = new URLSearchParams(window.location.search).get('email');
    const saved    = JSON.parse(sessionStorage.getItem('gc_signup') || '{}');
    if (urlEmail)        emailEl.value = urlEmail;
    else if (saved.email) emailEl.value = saved.email;
  } catch (e) { /* ignore */ }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent  = '';
    successEl.style.display = 'none';
    btnEl.disabled = true;
    btnEl.textContent = 'Sending…';

    const email = (emailEl.value || '').trim();
    if (!email) {
      errorEl.textContent = 'Please enter your email address.';
      btnEl.disabled = false;
      btnEl.textContent = 'Send recovery link';
      return;
    }

    try {
      await GCAuth.resetPassword(email);
      // Always show success regardless — don't leak whether the email exists
      form.style.display = 'none';
      successEl.style.display = 'block';
      successEl.innerHTML = '<strong>Check your inbox.</strong><br>If an account exists for <strong>' +
                            email.replace(/[<>&]/g, '') +
                            '</strong>, we just sent a password-reset link. It may take a minute to arrive.';
    } catch (err) {
      // Still show the generic success message — masks whether email exists
      form.style.display = 'none';
      successEl.style.display = 'block';
      successEl.innerHTML = '<strong>Check your inbox.</strong><br>If an account exists for that email, we just sent a password-reset link. It may take a minute to arrive.';
      console.warn('Password reset request failed:', err && err.message || err);
    }
  });
})();
