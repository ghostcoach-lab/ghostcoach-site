// GhostCoach — Account page logic
// Requires: config.js, supabase-client.js, auth.js, webhooks.js
//
// Sections: personal info, business profile, 90-day goal, session history,
// plan & billing, email preferences, danger zone.

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  const userId = session.user.id;
  const email  = session.user.email;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function set(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
  function flash(msgId) {
    const el = document.getElementById(msgId);
    if (!el) return;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // v29 — feedback helpers
  function toast(msg) {
    let t = document.getElementById('gc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'gc-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0F1117;color:#F7F5F0;padding:12px 22px;border-radius:999px;font-size:14px;z-index:300;opacity:0;transition:opacity .2s;font-family:"DM Sans",sans-serif;box-shadow:0 4px 20px rgba(15,17,23,0.3);';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2400);
  }
  function fmtDate(iso) {
    if (!iso) return 'the end of your current period';
    try { return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' }); }
    catch (e) { return 'the end of your current period'; }
  }
  function showBanner(html, kind) {
    const b = document.getElementById('gc-billing-banner');
    if (!b) return;
    b.className = 'billing-banner ' + (kind || 'success');
    b.innerHTML = html;
    b.style.display = 'block';
  }

  // ── Load all data in parallel ────────────────────────────────────────────────
  let profile = {}, userRow = {}, sessions = [], subscription = {}, newsletterRow = null;

  set('ac-email', email);

  try {
    const [pRes, uRes, sRes, subRes, nRes] = await Promise.all([
      gcSupabase.from('profiles').select('*').eq('user_id', userId).single(),
      gcSupabase.from('users').select('plan, status, stripe_customer_id').eq('id', userId).single(),
      gcSupabase.from('sessions').select('session_number, created_at, summary, action_committed, goal_progress_score')
        .eq('user_id', userId).order('created_at', { ascending: true }),
      gcSupabase.from('subscriptions').select('plan, status, current_period_end, cancel_at_period_end')
        .eq('user_id', userId).order('current_period_end', { ascending: false }).limit(1).maybeSingle(),
      gcSupabase.from('newsletter').select('id, unsubscribed_at').eq('user_id', userId).maybeSingle()
    ]);
    profile      = pRes.data || {};
    userRow      = uRes.data || {};
    sessions     = sRes.data || [];
    subscription = subRes.data || {};
    newsletterRow = nRes.data || null;
  } catch (e) {
    console.warn('Account data load issue:', e?.message || e);
  }

  // ── 1. Personal info ──────────────────────────────────────────────────────────
  set('ac-firstname', profile.firstname);
  set('ac-lastname',  profile.lastname);
  set('ac-phone',     profile.phone);
  set('ac-country',   profile.country);

  document.getElementById('gc-personal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('gc-personal-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await gcSupabase.from('profiles').upsert({
        user_id: userId,
        firstname: val('ac-firstname'),
        lastname:  val('ac-lastname'),
        phone:     val('ac-phone'),
        country:   val('ac-country'),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      flash('gc-personal-msg');
      toast('Saved ✓');
    } catch (err) {
      alert('Could not save personal info: ' + (err?.message || err));
    } finally {
      btn.disabled = false; btn.textContent = 'Save changes';
    }
  });

  // ── 2. Business profile ─────────────────────────────────────────────────────
  set('ac-product',        profile.product);
  set('ac-stage',          profile.stage);
  set('ac-business-model', profile.business_model);
  set('ac-tools',          profile.tools);
  set('ac-bottleneck',     profile.bottleneck);
  set('ac-tried',          profile.tried);
  set('ac-replaces',       profile.replaces);
  set('ac-additional',     profile.additional_context);

  document.getElementById('gc-business-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('gc-business-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await gcSupabase.from('profiles').upsert({
        user_id: userId,
        product:            val('ac-product'),
        stage:              val('ac-stage'),
        business_model:     val('ac-business-model'),
        tools:              val('ac-tools'),
        bottleneck:         val('ac-bottleneck'),
        tried:              val('ac-tried'),
        replaces:           val('ac-replaces'),
        additional_context: val('ac-additional'),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      flash('gc-business-msg');
      toast('Saved ✓');
    } catch (err) {
      alert('Could not save business profile: ' + (err?.message || err));
    } finally {
      btn.disabled = false; btn.textContent = 'Save changes';
    }
  });

  // ── 3. 90-day goal ──────────────────────────────────────────────────────────
  set('ac-goal', profile.goal_90_day);
  const goalPct = Math.max(0, Math.min(100, profile.goal_progress ?? 0));
  document.getElementById('ac-goal-pct').textContent = goalPct + '%';
  document.getElementById('ac-goal-fill').style.width = goalPct + '%';

  document.getElementById('gc-goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('gc-goal-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await gcSupabase.from('profiles').upsert({
        user_id: userId,
        goal_90_day: val('ac-goal'),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      flash('gc-goal-msg');
      toast('Goal updated ✓');
    } catch (err) {
      alert('Could not save goal: ' + (err?.message || err));
    } finally {
      btn.disabled = false; btn.textContent = 'Save goal';
    }
  });

  document.getElementById('gc-goal-reset').addEventListener('click', async () => {
    if (!confirm('Reset your 90-day goal? This sets progress back to 0% and starts a fresh 90-day window.')) return;
    try {
      await gcSupabase.from('profiles').upsert({
        user_id: userId,
        goal_90_day: val('ac-goal'),
        goal_progress: 0,
        goal_start_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      document.getElementById('ac-goal-pct').textContent = '0%';
      document.getElementById('ac-goal-fill').style.width = '0%';
      flash('gc-goal-msg');
    } catch (err) {
      alert('Could not reset goal: ' + (err?.message || err));
    }
  });

  // ── 4. Session history + chart ──────────────────────────────────────────────
  renderSessions(sessions);

  function renderSessions(rows) {
    const listEl  = document.getElementById('gc-session-list');
    const chartEl = document.getElementById('gc-chart-wrap');

    if (!rows || rows.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No sessions yet. Your first session with Marcus will appear here.</div>';
      chartEl.innerHTML = '';
      return;
    }

    // Chart: goal_progress_score over sessions (simple SVG line)
    const scores = rows.map(r => (r.goal_progress_score ?? null)).filter(s => s !== null);
    if (scores.length >= 2) {
      chartEl.innerHTML = buildChart(rows);
    } else {
      chartEl.innerHTML = '';
    }

    // List (most recent first)
    const ordered = [...rows].reverse();
    listEl.innerHTML = ordered.map(r => {
      const d = r.created_at ? new Date(r.created_at).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) : '';
      const num = r.session_number != null ? ('Session ' + r.session_number) : 'Session';
      const score = (r.goal_progress_score != null)
        ? `<span class="session-score">Goal progress: ${r.goal_progress_score}%</span>` : '';
      const action = r.action_committed
        ? `<div class="session-action"><strong>Committed:</strong> ${esc(r.action_committed)}</div>` : '';
      const summary = r.summary
        ? `<p class="session-summary">${esc(r.summary)}</p>` : '<p class="session-summary" style="color:rgba(15,17,23,0.4);">No summary recorded.</p>';
      return `<div class="session-item">
        <div class="session-head"><span class="session-num">${esc(num)}</span><span class="session-date">${esc(d)}</span></div>
        ${summary}${action}${score}
      </div>`;
    }).join('');
  }

  function buildChart(rows) {
    const W = 680, H = 160, PAD = 28;
    const pts = rows
      .map((r, i) => ({ i, score: r.goal_progress_score }))
      .filter(p => p.score != null);
    if (pts.length < 2) return '';

    const n = pts.length;
    const xStep = (W - PAD * 2) / (n - 1);
    const coords = pts.map((p, idx) => {
      const x = PAD + idx * xStep;
      const y = H - PAD - (p.score / 100) * (H - PAD * 2);
      return { x, y, score: p.score };
    });
    const path = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ',' + c.y.toFixed(1)).join(' ');
    const dots = coords.map(c =>
      `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="#C8861E"/>`).join('');
    // gridlines at 0/50/100
    const grid = [0, 50, 100].map(v => {
      const y = H - PAD - (v / 100) * (H - PAD * 2);
      return `<line x1="${PAD}" y1="${y}" x2="${W-PAD}" y2="${y}" stroke="rgba(15,17,23,0.07)" stroke-width="1"/>` +
             `<text x="${PAD-8}" y="${y+3}" text-anchor="end" font-size="10" fill="rgba(15,17,23,0.4)" font-family="DM Sans,sans-serif">${v}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Goal progress over sessions">
      ${grid}
      <path d="${path}" fill="none" stroke="#C8861E" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
  }

  // ── 5. Plan & billing ──────────────────────────────────────────────────────
  const plan = (userRow.plan || subscription.plan || 'builder').toLowerCase();
  const status = userRow.status || subscription.status || 'trial';
  const PLAN_LABELS = { builder:'Builder', operator:'Operator', lifetime:'Lifetime' };
  document.getElementById('gc-plan-pill').textContent = PLAN_LABELS[plan] || 'Builder';
  let statusText = status;
  if (subscription.cancel_at_period_end) statusText = 'Cancels at period end';
  else if (status === 'trialing' || status === 'trial') statusText = '14-day trial';
  else if (status === 'active') statusText = 'Active';
  else if (status === 'past_due') statusText = 'Payment past due';
  document.getElementById('gc-plan-status').textContent = statusText;

  // Buttons
  const upBtn      = document.getElementById('gc-upgrade');
  const lifeBtn    = document.getElementById('gc-lifetime');
  const downBtn    = document.getElementById('gc-downgrade');
  const cancelBtn  = document.getElementById('gc-cancel');
  const manageBtn  = document.getElementById('gc-manage-billing');
  const periodEnd  = subscription.current_period_end || null;

  function showOnly(buttons) {
    [upBtn, lifeBtn, downBtn, cancelBtn].forEach(b => { if (b) b.style.display = 'none'; });
    buttons.forEach(b => { if (b) b.style.display = ''; });
  }

  // Decide which actions are relevant for the current plan
  if (plan === 'lifetime') {
    showOnly([]);  // lifetime is permanent — no plan changes
    const pm = document.getElementById('gc-payment-method');
    if (pm) pm.textContent = 'Lifetime access — no recurring billing.';
  } else if (plan === 'operator') {
    showOnly([lifeBtn, downBtn, cancelBtn]);
  } else { // builder
    showOnly([upBtn, lifeBtn, cancelBtn]);
  }

  // If a downgrade is already scheduled, surface the persistent notice
  if (subscription.cancel_at_period_end) {
    const note = document.getElementById('gc-scheduled-notice');
    if (note) {
      note.textContent = 'Your subscription ends ' + fmtDate(periodEnd) + '. Access continues until then.';
      note.style.display = 'block';
    }
  }

  async function postPlan(type, extra) {
    const res = await fetch(`${GC.N8N_BASE}/gc-s6-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gc-secret': GC.WEBHOOK_SECRET },
      body: JSON.stringify(Object.assign({ type, user_id: userId, email }, extra || {}))
    });
    return res;
  }

  // ── Upgrade (Builder → Operator): immediate effect, optimistic UI ──
  if (upBtn) upBtn.addEventListener('click', async () => {
    if (!confirm('Upgrade to Operator ($149/mo)? This takes effect immediately.')) return;
    upBtn.disabled = true;
    try {
      const res = await postPlan('upgrade');
      if (!res.ok) throw new Error();
      document.getElementById('gc-plan-pill').textContent = 'Operator';
      document.getElementById('gc-plan-status').textContent = 'Active';
      showOnly([downBtn, cancelBtn]);
      showBanner("You're now on Operator — weekly digest and pricing audit unlocked.", 'success');
    } catch (e) {
      upBtn.disabled = false;
      showBanner('Could not upgrade right now. Please try again or contact support.', 'error');
    }
  });

  // ── Downgrade (Operator → Builder): scheduled for period end ──
  if (downBtn) downBtn.addEventListener('click', async () => {
    if (!confirm('Downgrade to Builder at the end of your current period?')) return;
    downBtn.disabled = true;
    try {
      const res = await postPlan('downgrade');
      if (!res.ok) throw new Error();
      const dateStr = fmtDate(periodEnd);
      showBanner('Your plan changes to Builder on ' + dateStr + '. You keep Operator access until then.', 'success');
      const note = document.getElementById('gc-scheduled-notice');
      if (note) {
        note.textContent = 'Scheduled: downgrade to Builder on ' + dateStr + '. You keep Operator access until then.';
        note.style.display = 'block';
      }
    } catch (e) {
      downBtn.disabled = false;
      showBanner('Could not schedule the downgrade right now. Please try again.', 'error');
    }
  });

  // ── Lifetime upgrade: celebratory; handle cap-full failure ──
  if (lifeBtn) lifeBtn.addEventListener('click', async () => {
    if (!confirm('Get Lifetime access for $499 (one-time)? Operator features, for life.')) return;
    lifeBtn.disabled = true;
    try {
      const res = await postPlan('lifetime');
      if (res.status === 409) {
        // Founding-member cap reached
        showBanner('All 50 founding-member spots are taken. Lifetime is no longer available.', 'error');
        lifeBtn.disabled = false;
        return;
      }
      if (!res.ok) throw new Error();
      document.getElementById('gc-plan-pill').textContent = 'Lifetime';
      document.getElementById('gc-plan-status').textContent = 'Founding member';
      showOnly([]);
      showBanner("You're a founding member — Operator features, for life.", 'celebrate');
    } catch (e) {
      lifeBtn.disabled = false;
      showBanner('Could not complete the Lifetime upgrade right now. Please try again.', 'error');
    }
  });

  // ── Cancel: ends at period end + win-back ──
  if (cancelBtn) cancelBtn.addEventListener('click', async () => {
    if (!confirm('Cancel your subscription? You keep access until the end of your current period.')) return;
    cancelBtn.disabled = true;
    try {
      const res = await postPlan('cancel');
      if (!res.ok) throw new Error();
      const dateStr = fmtDate(periodEnd);
      showBanner('Your subscription ends ' + dateStr + '. Access continues until then.', 'success');
      document.getElementById('gc-plan-status').textContent = 'Cancels at period end';
      const wb = document.getElementById('gc-winback');
      if (wb) {
        wb.innerHTML = 'Changed your mind? You can keep your subscription and nothing will change. ' +
          '<button type="button" class="btn btn-primary" id="gc-resume">Keep my subscription</button>';
        wb.style.display = 'block';
        const resumeBtn = document.getElementById('gc-resume');
        if (resumeBtn) resumeBtn.addEventListener('click', async () => {
          resumeBtn.disabled = true;
          try {
            const r2 = await postPlan('resume');
            if (!r2.ok) throw new Error();
            wb.style.display = 'none';
            document.getElementById('gc-plan-status').textContent = 'Active';
            showBanner('Welcome back — your subscription will continue as normal.', 'success');
          } catch (e2) {
            resumeBtn.disabled = false;
            showBanner('Could not resume right now. Please try again.', 'error');
          }
        });
      }
    } catch (e) {
      cancelBtn.disabled = false;
      showBanner('Could not cancel right now. Please try again or contact support.', 'error');
    }
  });

  // ── Manage billing & invoices → Stripe Customer Portal ──
  if (manageBtn) manageBtn.addEventListener('click', async () => {
    manageBtn.disabled = true;
    const orig = manageBtn.textContent;
    manageBtn.textContent = 'Opening…';
    try {
      const res = await fetch(`${GC.N8N_BASE}/gc-s6-portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gc-secret': GC.WEBHOOK_SECRET },
        body: JSON.stringify({ user_id: userId, email, return_url: window.location.href })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data && data.url) {
        window.location.href = data.url;  // Stripe-hosted Customer Portal
      } else {
        throw new Error('No portal URL returned');
      }
    } catch (e) {
      manageBtn.disabled = false;
      manageBtn.textContent = orig;
      showBanner('Could not open the billing portal right now. Please try again or contact support.', 'error');
    }
  });

  // ── 6. Email preferences ─────────────────────────────────────────────────────
  const nlToggle = document.getElementById('gc-newsletter-toggle');
  const subscribed = newsletterRow && !newsletterRow.unsubscribed_at;
  nlToggle.checked = !!subscribed;
  nlToggle.addEventListener('change', () => {
    const wantOn = nlToggle.checked;
    // Optimistic: flip instantly + toast. Beehiiv sync is fire-and-forget (don't block).
    toast('Updated ✓');
    const url = wantOn ? `${GC.N8N_BASE}/gc-s8-signup` : `${GC.N8N_BASE}/gc-s8-unsubscribe`;
    const body = wantOn ? { email, user_id: userId, source: 'account_prefs' } : { email, user_id: userId };
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gc-secret': GC.WEBHOOK_SECRET },
      body: JSON.stringify(body)
    }).catch(err => console.warn('Newsletter pref sync failed (non-blocking):', err?.message || err));
  });

  // ── 7. Danger zone ──────────────────────────────────────────────────────────
  const deleteModal   = document.getElementById('gc-delete-modal');
  const deleteInput   = document.getElementById('gc-delete-confirm');
  const deleteConfirm = document.getElementById('gc-delete-confirm-btn');
  const deleteCancel  = document.getElementById('gc-delete-cancel');

  document.getElementById('gc-delete-account').addEventListener('click', () => {
    deleteInput.value = '';
    deleteConfirm.disabled = true;
    deleteModal.style.display = 'flex';
    deleteInput.focus();
  });
  deleteCancel.addEventListener('click', () => { deleteModal.style.display = 'none'; });
  deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) deleteModal.style.display = 'none'; });
  deleteInput.addEventListener('input', () => {
    deleteConfirm.disabled = (deleteInput.value.trim().toUpperCase() !== 'DELETE');
  });
  deleteConfirm.addEventListener('click', async () => {
    deleteConfirm.disabled = true;
    deleteConfirm.textContent = 'Deleting…';
    try {
      const res = await fetch(`${GC.N8N_BASE}/gc-s6-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gc-secret': GC.WEBHOOK_SECRET },
        body: JSON.stringify({ type: 'delete', user_id: userId, email })
      });
      if (!res.ok) throw new Error('Request failed');
      // Show the "deleted" confirmation, then sign out
      const ov = document.createElement('div');
      ov.className = 'deleted-overlay';
      ov.innerHTML = '<h2>Your account has been deleted.</h2>';
      document.body.appendChild(ov);
      setTimeout(() => { GCAuth.signOut(); }, 2200);
    } catch (err) {
      deleteConfirm.disabled = false;
      deleteConfirm.textContent = 'Delete my account';
      deleteModal.style.display = 'none';
      alert('Could not delete account right now. Please contact support.');
    }
  });

  // ── Log out ────────────────────────────────────────────────────────────────
  document.getElementById('gc-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await GCAuth.signOut();
  });
})();
