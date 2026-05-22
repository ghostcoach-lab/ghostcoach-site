// GhostCoach — Card capture page (Stripe Elements)
// Requires: config.js, supabase-client.js, auth.js, Stripe.js (loaded in HTML)

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  const PLAN_INFO = {
    builder:  { name: 'Builder',  price: '$79 / month after your 14-day trial',  stripeId: GC.STRIPE_PRICE_BUILDER  },
    operator: { name: 'Operator', price: '$149 / month after your 14-day trial', stripeId: GC.STRIPE_PRICE_OPERATOR },
    lifetime: { name: 'Lifetime', price: '$499 one-time — Operator features for life', stripeId: GC.STRIPE_PRICE_LIFETIME || null }
  };
  const planParam = new URLSearchParams(window.location.search).get('plan') || 'builder';
  const info = PLAN_INFO[planParam] || PLAN_INFO.builder;
  document.getElementById('gc-plan-name').textContent = info.name;
  document.getElementById('gc-plan-price').textContent = info.price;

  const stripe = Stripe(GC.STRIPE_KEY);
  const elements = stripe.elements();
  const cardElement = elements.create('card', {
    style: {
      base: {
        fontFamily: '"DM Sans", sans-serif',
        fontSize: '15px',
        color: '#0F1117',
        '::placeholder': { color: '#8B8A98' }
      },
      invalid: { color: '#E55353' }
    }
  });
  cardElement.mount('#gc-card-element');

  const form    = document.getElementById('gc-card-form');
  const btn     = document.getElementById('gc-submit-btn');
  const errorEl = document.getElementById('gc-card-error');

  cardElement.on('change', (event) => {
    errorEl.textContent = event.error ? event.error.message : '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Processing…';

    try {
      const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: { email: session.user.email }
      });
      if (pmError) {
        errorEl.textContent = pmError.message;
        btn.disabled = false;
        btn.textContent = 'Start free trial';
        return;
      }

      const res = await fetch(`${GC.N8N_BASE}/gc-s5-subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gc-secret': GC.WEBHOOK_SECRET
        },
        body: JSON.stringify({
          user_id: session.user.id,
          email: session.user.email,
          payment_method_id: paymentMethod.id,
          plan: planParam,
          stripe_price_id: info.stripeId
        })
      });
      if (!res.ok) throw new Error('Could not start trial. Please try again or contact support.');

      window.location.href = '/activating/';

    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong. Please try again.';
      btn.disabled = false;
      btn.textContent = 'Start free trial';
    }
  });
})();
