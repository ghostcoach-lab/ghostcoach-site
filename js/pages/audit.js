// GhostCoach — Quarterly pricing audit (/account/audit/)
// Requires: config.js, supabase-client.js, auth.js, webhooks.js
//
// Flow: auth gate -> eligibility check (pricing-audit-eligibility) ->
// intake form -> conversation (marcus-audit-chat) -> verdict
// (pricing-audit-complete). Eligibility is read from the server, never
// recomputed from raw table reads — see pricing-audit-eligibility.
//
// Completion-check strategy (confirmed by the web architect, 5 Oct): once
// the audit is underway, after each Marcus reply this page quietly asks
// pricing-audit-complete whether that reply was the Verdict. A no-Verdict
// answer (`extraction_incomplete`) is expected and
// silent — the docs for pricing-audit-complete explicitly anticipate the
// page doing this ("the page offers completion before Marcus gives his
// Verdict, so an early attempt costs one call"). This keeps the UI free
// of a manual "I'm done" button. Each check is a claude-opus-5-5
// extraction call, so checks are skipped for the first 3 Marcus turns
// (opener included) and run from turn 4 onward — see
// COMPLETION_CHECK_FROM_TURN.

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  // ── DOM refs ────────────────────────────────────────────────────────────
  const gateEl        = document.getElementById('gc-gate');
  const gateTitleEl    = document.getElementById('gc-gate-title');
  const gateDescEl     = document.getElementById('gc-gate-desc');
  const gateCtaEl      = document.getElementById('gc-gate-cta');
  const intakeWrapEl   = document.getElementById('gc-intake');
  const intakeFormEl   = document.getElementById('gc-intake-form');
  const intakeErrorEl  = document.getElementById('gc-intake-error');
  const intakeSubmitEl = document.getElementById('gc-intake-submit');
  const conversationEl = document.getElementById('gc-conversation');
  const messagesEl     = document.getElementById('gc-chat-messages');
  const inputEl        = document.getElementById('gc-audit-input');
  const sendBtn         = document.getElementById('gc-audit-send');
  const inputWrapEl    = document.getElementById('gc-input-wrap');

  // ── Session state ────────────────────────────────────────────────────────
  let sessionId   = null;
  let auditIntake = null;
  let transcript  = [];   // visible turns only: [{ role, content }]
  let isDone      = false;
  let isSending   = false;

  // Completion-check gating (web architect, 5 Oct): skip the check for the
  // first 3 Marcus turns, start from turn 4. A "turn" here is a Marcus
  // message, counting the opener as turn 1 — so the first check runs after
  // Marcus's third reply to the founder (4th Marcus message overall).
  const COMPLETION_CHECK_FROM_TURN = 4;
  function marcusTurnCount() {
    return transcript.filter(m => m.role === 'assistant').length;
  }

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for any browser without crypto.randomUUID (Safari < 15.4).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── Markdown rendering — identical to /chat/'s renderMarkdown(). Kept as
  // a literal copy rather than a shared module, matching how this repo has
  // no frontend build step to share code between pages. If this page and
  // /chat/ ever diverge here, that's a bug — keep them in sync by hand. ──
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderMarkdown(raw) {
    let s = escapeHtml(raw);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    const lines = s.split('\n');
    let out = [], buf = [];
    const flush = () => {
      if (buf.length) { out.push('<ul>' + buf.map(li => '<li>' + li + '</li>').join('') + '</ul>'); buf = []; }
    };
    for (const line of lines) {
      const m = line.match(/^\s*[-*]\s+(.*)$/);
      if (m) { buf.push(m[1]); } else { flush(); out.push(line); }
    }
    flush();
    s = out.join('\n');
    return s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(block => block
      .split(/(<ul>[\s\S]*?<\/ul>)/).filter(Boolean).map(part => {
        if (part.startsWith('<ul>')) return part;
        const text = part.replace(/^\n+|\n+$/g, '');
        return text ? '<p>' + text.replace(/\n/g, '<br>') + '</p>' : '';
      }).join('')
    ).join('');
  }

  function buildCopyButton(rawText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'COPY';
    btn.setAttribute('aria-label', 'Copy Marcus’s message to clipboard');
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(rawText); } catch (e) { return; }
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
    });
    return btn;
  }

  function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `gc-message gc-message--${role}`;
    if (role === 'assistant') {
      div.innerHTML = renderMarkdown(content);
      div.appendChild(buildCopyButton(content));
    } else {
      div.textContent = content;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function appendThinking() {
    const div = document.createElement('div');
    div.className = 'gc-message gc-message--assistant gc-message--thinking';
    div.textContent = '…';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  // ── Verdict card — deliberately not a chat bubble (see CSS .verdict-card).
  // Fields available from pricing-audit-complete: action, number, deadline,
  // reasoning. The briefing also asked for a separate falsifiable "how
  // you'll know it worked" note; the extraction schema doesn't carry that
  // as its own field, so it's folded into `reasoning` here as the prompt
  // writes it. Flagged for the architect — not something the frontend can
  // invent on its own. ──
  function headlineFor(verdict) {
    const action = verdict.action;
    if (action === 'raise') return 'Raise your pricing to ' + (verdict.number || '—');
    if (action === 'restructure') {
      return verdict.number ? 'Restructure pricing: ' + verdict.number : 'Restructure your pricing';
    }
    return 'Hold your current pricing';
  }

  function renderVerdict(verdict) {
    const card = document.createElement('div');
    card.className = 'verdict-card';
    const deadlineStr = verdict.deadline
      ? new Date(verdict.deadline + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : null;
    card.innerHTML =
      '<div class="verdict-eyebrow">Marcus’s verdict</div>' +
      '<div class="verdict-headline">' + escapeHtml(headlineFor(verdict)) + '</div>' +
      '<div class="verdict-reasoning">' + escapeHtml(verdict.reasoning || '') + '</div>' +
      (deadlineStr ? '<div class="verdict-deadline">Act by ' + escapeHtml(deadlineStr) + '</div>' : '') +
      '<div class="verdict-footer"><a class="verdict-done-btn" href="/account/">Done — back to account</a></div>';
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function lockConversation() {
    isDone = true;
    inputEl.disabled = true;
    sendBtn.disabled = true;
    inputWrapEl.style.display = 'none';
  }

  // ── Edge Function calls ──────────────────────────────────────────────────
  // Same shape as /chat/'s call to marcus-chat: raw fetch, Bearer token,
  // Supabase Edge Function URL. pricing-audit-eligibility is the exception
  // (uses supabase.functions.invoke, matching js/pricing-audit.js's existing
  // adapter) since that's the established pattern for that one function.
  async function checkEligibility() {
    const { data, error } = await gcSupabase.functions.invoke('pricing-audit-eligibility', { method: 'POST' });
    if (error) throw new Error('Could not check audit eligibility right now.');
    return data; // { state, is_welcome_audit, last_completed_at, next_eligible_date }
  }

  async function callAuditChat(messages) {
    const token = await GCAuth.getToken();
    const res = await fetch(`${GC.SUPABASE_URL}/functions/v1/marcus-audit-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId, audit_intake: auditIntake, messages })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error('marcus-audit-chat failed');
      err.reason = data.reason;
      err.nextEligibleDate = data.next_eligible_date;
      throw err;
    }
    return data.reply;
  }

  // ── Failure handling ──────────────────────────────────────────────────────
  // Reason codes come from supabase/functions/_shared/http.ts (9 of them).
  // The wording below is PROPOSED copy, not yet approved by Product. Any code
  // not listed (including a network failure, which has no code) falls back to
  // the generic message — never a blank or technical-looking one.
  // `terminal` means retrying cannot help, so the conversation is closed.
  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function describeFailure(reason, nextEligibleDate) {
    switch (reason) {
      case 'unauthorized':
        return { text: 'Your session has expired. Taking you back to sign in\u2026', terminal: true, login: true };
      case 'plan_lapsed':
        return { text: 'Your plan no longer includes the pricing audit.', terminal: true };
      case 'gated':
        return {
          text: nextEligibleDate
            ? 'Your next pricing audit will be available on ' + formatDate(nextEligibleDate) + '.'
            : 'Your next pricing audit isn\u2019t available yet.',
          terminal: true
        };
      case 'session_conflict':
        return { text: 'This audit session can\u2019t be continued. Start a new audit from your account page.', terminal: true };
      case 'audit_too_long':
        return { text: 'This audit has reached its length limit and can\u2019t continue.', terminal: true };
      case 'invalid_request':
        return { text: 'That message couldn\u2019t be processed. Please try sending it again.', terminal: false };
      case 'ai_unavailable':
        return { text: 'Marcus is unavailable right now. Try again in a moment.', terminal: false };
      case 'internal_error':
        return { text: 'Something went wrong on our side. Try again in a moment, and contact support if it keeps happening.', terminal: false };
      default:
        return { text: 'Something went wrong. Please try again in a moment.', terminal: false };
    }
  }

  function appendNotice(text, withBackLink) {
    const div = document.createElement('div');
    div.className = 'audit-notice';
    div.setAttribute('role', 'alert');
    div.appendChild(document.createTextNode(text));
    if (withBackLink) {
      const a = document.createElement('a');
      a.href = '/account/';
      a.textContent = 'Back to account';
      div.appendChild(document.createElement('br'));
      div.appendChild(a);
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  // Shows the failure. Returns true if the failure was terminal (conversation closed).
  function handleFailure(err) {
    const info = describeFailure(err && err.reason, err && err.nextEligibleDate);
    appendNotice(info.text, info.terminal);
    if (info.login) setTimeout(() => { window.location.href = '/login/'; }, 1500);
    if (info.terminal) lockConversation();
    return info.terminal;
  }

  // Returns { completed: true, verdict, nextEligibleDate } once Marcus has
  // actually delivered a Verdict, or { completed: false } for every other
  // outcome (no Verdict yet, or a transient failure) — callers treat both
  // the same way: keep going.
  async function tryComplete(messages) {
    try {
      const token = await GCAuth.getToken();
      const res = await fetch(`${GC.SUPABASE_URL}/functions/v1/pricing-audit-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ session_id: sessionId, audit_intake: auditIntake, messages })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.status === 'completed' || data.status === 'already_completed')) {
        return { completed: true, verdict: data.verdict, nextEligibleDate: data.next_eligible_date };
      }
      return { completed: false };
    } catch (e) {
      return { completed: false };
    }
  }

  // ── Intake form ───────────────────────────────────────────────────────────
  function readIntake() {
    const mrr = Number(document.getElementById('gc-in-mrr').value);
    const customer_count = Number(document.getElementById('gc-in-customers').value);
    const churn_rate = Number(document.getElementById('gc-in-churn').value);
    const current_pricing = document.getElementById('gc-in-pricing').value.trim();
    const last_pricing_change = document.getElementById('gc-in-lastchange').value.trim();

    if (!Number.isFinite(mrr) || mrr < 0) return { error: 'Monthly revenue must be a number of 0 or more.' };
    if (!Number.isInteger(customer_count) || customer_count < 0) return { error: 'Customers must be a whole number of 0 or more.' };
    if (!Number.isFinite(churn_rate) || churn_rate < 0) return { error: 'Monthly churn must be a number of 0 or more.' };
    if (!current_pricing) return { error: 'Tell Marcus your current pricing.' };
    if (!last_pricing_change) return { error: 'Tell Marcus when you last changed pricing (or "Never").' };

    return { value: { mrr, customer_count, churn_rate, current_pricing, last_pricing_change } };
  }

  intakeFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = readIntake();
    if (result.error) {
      intakeErrorEl.textContent = result.error;
      intakeErrorEl.style.display = 'block';
      return;
    }
    intakeErrorEl.style.display = 'none';
    intakeSubmitEl.disabled = true;
    auditIntake = result.value;
    sessionId = uuid();

    intakeWrapEl.style.display = 'none';
    conversationEl.style.display = 'flex';

    startOpener();
  });

  // Asks Marcus for the opener. On a retryable failure, offers a retry button
  // so the founder is never left with a dead input box.
  async function startOpener() {
    const thinking = appendThinking();
    try {
      const opener = await callAuditChat([]); // empty messages = opener, same convention as /chat/
      thinking.remove();
      appendMessage('assistant', opener);
      transcript.push({ role: 'assistant', content: opener });
      // No completion attempt after the opener — see COMPLETION_CHECK_FROM_TURN.
      wireInput();
    } catch (err) {
      thinking.remove();
      if (handleFailure(err)) return;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'audit-retry';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => {
        retry.previousSibling && retry.previousSibling.remove();
        retry.remove();
        startOpener();
      });
      messagesEl.appendChild(retry);
    }
  }

  // ── Conversation ──────────────────────────────────────────────────────────
  let inputWired = false;
  function wireInput() {
    if (inputWired) return;
    inputWired = true;
    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    inputEl.focus();
  }

  async function sendMessage() {
    if (isDone || isSending) return;
    const text = inputEl.value.trim();
    if (!text) return;

    isSending = true;
    inputEl.value = '';
    sendBtn.disabled = true;
    const userBubble = appendMessage('user', text);
    transcript.push({ role: 'user', content: text });

    const thinking = appendThinking();
    let reply;
    try {
      reply = await callAuditChat(transcript);
    } catch (err) {
      // Roll back the unanswered turn. The server requires strict
      // user/assistant alternation, so leaving it in would make every later
      // message fail as invalid_request. The text goes back in the box.
      thinking.remove();
      userBubble.remove();
      transcript.pop();
      inputEl.value = text;
      handleFailure(err);
      isSending = false;
      if (!isDone) { sendBtn.disabled = false; inputEl.focus(); }
      return;
    }

    thinking.remove();
    appendMessage('assistant', reply);
    transcript.push({ role: 'assistant', content: reply });

    // Quietly check whether that reply was the Verdict (see file header) —
    // but only once the audit is far enough along for a Verdict to be
    // plausible. Each check is a full claude-opus-5-5 extraction call.
    try {
      if (marcusTurnCount() >= COMPLETION_CHECK_FROM_TURN) {
        const result = await tryComplete(transcript);
        if (result.completed) {
          renderVerdict(result.verdict);
          lockConversation();
        }
      }
    } finally {
      isSending = false;
      if (!isDone) { sendBtn.disabled = false; inputEl.focus(); }
    }
  }

  // ── Init: auth is already confirmed above. Gate on eligibility next. ────
  try {
    const elig = await checkEligibility();

    if (elig.state === 'not_entitled') {
      gateTitleEl.textContent = 'The pricing audit isn’t on your plan';
      gateDescEl.textContent = 'This is an Operator and Lifetime feature. Upgrade from your account page to unlock it.';
      gateCtaEl.style.display = 'inline-block';
      return;
    }
    if (elig.state === 'gated') {
      const next = formatDate(elig.next_eligible_date);
      gateTitleEl.textContent = 'Your next audit isn’t available yet';
      gateDescEl.textContent = 'Audits run once per quarter. Yours will be available on ' + next + '.';
      gateCtaEl.style.display = 'inline-block';
      return;
    }

    // elig.state === 'eligible'
    gateEl.style.display = 'none';
    intakeWrapEl.style.display = 'block';
  } catch (err) {
    gateTitleEl.textContent = 'Something went wrong';
    gateDescEl.textContent = err.message || 'Could not check your eligibility right now. Please try again from your account page.';
    gateCtaEl.style.display = 'inline-block';
  }
})();
