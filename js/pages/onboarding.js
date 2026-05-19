// GhostCoach — Onboarding form page logic
// Requires: config.js, supabase-client.js, auth.js, webhooks.js
// Called after the user confirms their email and lands on /onboarding/

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  const userId = session.user.id;
  const form   = document.getElementById('gc-onboarding-form');
  const btnEl  = document.getElementById('gc-submit-btn');
  const errorEl = document.getElementById('gc-error');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    btnEl.disabled = true;
    btnEl.textContent = 'Saving…';

    const data = Object.fromEntries(new FormData(form));

    try {
      await GCWebhook.submitOnboarding(userId, {
        firstname:      data.firstname,
        lastname:       data.lastname,
        phone:          data.phone       || null,
        country:        data.country     || null,
        product:        data.product,
        stage:          data.stage,
        tools:          data.tools       || null,
        business_model: data.business_model || null,
        bottleneck:     data.bottleneck  || null,
        tried:          data.tried       || null,
        goal_90_day:    data.goal_90_day
      });
      window.location.href = '/dashboard/';
    } catch (err) {
      errorEl.textContent = err.message || 'Could not save. Please try again.';
      btnEl.disabled = false;
      btnEl.textContent = 'Continue';
    }
  });
})();
