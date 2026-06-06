// GhostCoach — Signup page logic
// Requires: config.js, supabase-client.js, auth.js
// Reads ?plan=builder|operator|lifetime from the URL, renders the matching plan,
// records the chosen plan on the new account, and wires the form interactions.

// ── Plan definitions ───────────────────────────────────────────────
const GC_PLANS = {
  builder:  { label: 'Builder — $79/mo',   title: "What's in Builder",  operatorFeatures: false, price: '$79/month',   trial: true  },
  operator: { label: 'Operator — $149/mo', title: "What's in Operator", operatorFeatures: true,  price: '$149/month',  trial: true  },
  lifetime: { label: 'Lifetime — $499 once', title: "What's in Lifetime", operatorFeatures: true, price: '$499 one-time', trial: false }
};

function gcGetPlan() {
  const p = new URLSearchParams(window.location.search).get('plan');
  return (p && GC_PLANS[p]) ? p : 'builder';
}

const GC_SELECTED_PLAN = gcGetPlan();

// ── Render the chosen plan into the left column + step indicator ────
function gcApplyPlan(plan) {
  const cfg = GC_PLANS[plan];
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setShow = (id, on)  => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };

  setText('plan-label', cfg.label);
  setText('plan-title-label', cfg.title);
  setShow('operator-feature', cfg.operatorFeatures);
  setShow('operator-pricing-audit', cfg.operatorFeatures);

  if (cfg.trial) {
    // Builder + Operator — 14-day trial. Only the price number differs from the default markup.
    setText('plan-price', cfg.price);
    setShow('trial-no-charge', true);
    setText('step3-label', 'Start trial');
  } else {
    // Lifetime — one-time payment, no trial. Replace the trial-specific copy.
    const h = document.getElementById('left-headline');
    if (h) h.innerHTML = '$499 once.<br><em>Operator, for life.</em>';
    setText('left-sub', 'A one-time founding-member payment — one of only 50 lifetime spots. No subscription, no recurring charge. You get every Operator feature, for life.');
    setShow('trial-no-charge', false);
    const note = document.getElementById('price-note');
    if (note) note.innerHTML = 'One-time payment of <strong>$499</strong>. No subscription and no recurring charge — Operator features for life.';
    setText('step3-label', 'Get access');
  }
}

// ── Inline-handler helpers referenced from the HTML ─────────────────
function clearErr(field) {
  const el = document.getElementById(field + '-err');
  if (el) el.style.display = 'none';
  const ge = document.getElementById('gc-error');
  if (ge) ge.textContent = '';
}

function togglePw() {
  const input = document.getElementById('gc-password');
  const btn   = document.getElementById('pw-btn');
  if (!input) return;
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  if (btn) btn.textContent = reveal ? 'Hide' : 'Show';
}

async function handleSocial(provider) {
  // OAuth sign-up/in. The Google provider must be enabled in the Supabase
  // dashboard (Authentication -> Providers) for this to complete successfully.
  const ge = document.getElementById('gc-error');
  if (ge) ge.textContent = '';
  try {
    const { error } = await gcSupabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/payment/?plan=' + GC_SELECTED_PLAN }
    });
    if (error) throw error;
  } catch (err) {
    if (ge) ge.textContent = 'Could not start ' + provider + ' sign-in. Please sign up with email instead.';
  }
}

// ── Init ────────────────────────────────────────────────────────────
(async () => {
  gcApplyPlan(GC_SELECTED_PLAN);

  // Don't show the signup form to already-logged-in users
  await GCAuth.redirectIfLoggedIn('/payment/');

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
      await GCAuth.signUp(emailEl.value.trim(), passEl.value, GC_SELECTED_PLAN);
      form.innerHTML =
        '<p style="color:#0F1117;text-align:center;line-height:1.6">' +
          '<strong style="color:#C8861E">Check your inbox.</strong><br>' +
          'We sent a confirmation link to <strong>' + emailEl.value.trim() + '</strong>.<br>' +
          'Click it to create your account.' +
        '</p>';
    } catch (err) {
      errorEl.textContent = (err && err.message) || 'Something went wrong. Please try again.';
      btnEl.disabled = false;
      btnEl.textContent = 'Create account →';
    }
  });
})();
