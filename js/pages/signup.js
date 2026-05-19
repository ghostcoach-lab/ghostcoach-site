// GhostCoach — Signup page logic
// Requires: config.js, supabase-client.js, auth.js
// Attach to the signup/start-trial form on the pricing or signup page.

(async () => {
  // Don't show signup form to already-logged-in users
  await GCAuth.redirectIfLoggedIn('/dashboard/');

  const form    = document.getElementById('gc-signup-form');
  const emailEl = document.getElementById('gc-email');
  const passEl  = document.getElementById('gc-password');
  const errorEl = document.getElementById('gc-error');
  const btnEl   = document.getElementById('gc-submit-btn');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    btnEl.disabled = true;
    btnEl.textContent = 'Creating account…';

    try {
      await GCAuth.signUp(emailEl.value.trim(), passEl.value);
      // Show confirmation message — user must click the email link before they can log in
      form.innerHTML = `
        <p style="color:#f0f0f0;text-align:center;line-height:1.6">
          <strong style="color:#e88c14">Check your inbox.</strong><br>
          We sent a confirmation link to <strong>${emailEl.value.trim()}</strong>.<br>
          Click it to activate your 14-day free trial.
        </p>`;
    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong. Please try again.';
      btnEl.disabled = false;
      btnEl.textContent = 'Start my free trial';
    }
  });
})();
