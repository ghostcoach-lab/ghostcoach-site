// GhostCoach — Newsletter / footer signup widget
// Requires: config.js, webhooks.js
// Can be included on any page that has a newsletter signup form.

(async () => {
  const form    = document.getElementById('gc-newsletter-form');
  const emailEl = document.getElementById('gc-newsletter-email');
  const btnEl   = document.getElementById('gc-newsletter-btn');
  const msgEl   = document.getElementById('gc-newsletter-msg');

  if (!form) return;

  // Detect which page/section the signup came from
  const source = form.dataset.source || 'footer_signup';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    btnEl.disabled = true;
    btnEl.textContent = 'Subscribing…';

    try {
      await GCWebhook.newsletterSignup(emailEl.value.trim(), source);
      form.innerHTML = `<p style="color:#e88c14;font-weight:600">You're in. Check your inbox to confirm.</p>`;
    } catch (err) {
      msgEl.textContent = 'Something went wrong. Please try again.';
      btnEl.disabled = false;
      btnEl.textContent = 'Subscribe';
    }
  });
})();
