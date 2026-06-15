// GhostCoach — Chat / coaching session page
// Requires: config.js, supabase-client.js, auth.js, webhooks.js
//
// HTML elements expected on the page:
//   #gc-chat-messages   — container where messages are appended
//   #gc-chat-input      — textarea for user input
//   #gc-send-btn        — send button
//   #gc-end-btn         — "End session" button
//   #gc-session-status  — optional status text element
//   #gc-goal-bar        — optional <progress> or div for goal progress

(async () => {
  const session = await GCAuth.requireAuth('/login/');
  if (!session) return;

  const userId = session.user.id;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const messagesEl = document.getElementById('gc-chat-messages');
  const inputEl    = document.getElementById('gc-chat-input');
  const sendBtn    = document.getElementById('gc-send-btn');
  const endBtn     = document.getElementById('gc-end-btn');
  const statusEl   = document.getElementById('gc-session-status');
  const goalBar    = document.getElementById('gc-goal-bar');

  // ── Session state ────────────────────────────────────────────────────────────
  let sessionId   = null;
  let transcript  = [];   // [{ role: 'user'|'assistant', content: string }]
  let isEnding    = false;

  // ── Load user profile (for context: goal, stage, plan) ──────────────────────
  async function loadProfile() {
    const { data, error } = await gcSupabase
      .from('profiles')
      .select('firstname, product, stage, business_model, bottleneck, tried, goal_90_day, goal_progress, user_memory')
      .eq('user_id', userId)
      .single();
    if (error) console.warn('Could not load profile:', error.message);
    return data ?? {};
  }

  // ── Create a new session row in Supabase ─────────────────────────────────────
  async function createSession() {
    const { data, error } = await gcSupabase
      .from('sessions')
      .insert({ user_id: userId, processing_status: 'pending' })
      .select('id')
      .single();
    if (error) throw new Error('Could not start session: ' + error.message);
    return data.id;
  }

  // ── Render a chat bubble ──────────────────────────────────────────────────────
  function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `gc-message gc-message--${role}`;
    div.textContent = content;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Call Anthropic (Marcus) via Supabase Edge Function ───────────────────────
  // The Edge Function keeps the Anthropic API key server-side.
  // Deploy the function from /supabase/functions/marcus-chat/
  async function callMarcus(messages, profile) {
    const token = await GCAuth.getToken();
    const res = await fetch(`${GC.SUPABASE_URL}/functions/v1/marcus-chat`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ messages, profile, session_id: sessionId })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error('Marcus is unavailable right now. Try again in a moment.');
    }
    const data = await res.json();
    return data.reply;  // string
  }

  // ── Send a message ────────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isEnding) return;

    inputEl.value = '';
    sendBtn.disabled = true;
    appendMessage('user', text);
    transcript.push({ role: 'user', content: text });

    const profile = await loadProfile();
    const thinking = document.createElement('div');
    thinking.className = 'gc-message gc-message--assistant gc-message--thinking';
    thinking.textContent = '…';
    messagesEl.appendChild(thinking);

    try {
      const reply = await callMarcus(transcript, profile);
      thinking.remove();
      appendMessage('assistant', reply);
      transcript.push({ role: 'assistant', content: reply });
    } catch (err) {
      thinking.remove();
      appendMessage('assistant', err.message);
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  // ── End session ───────────────────────────────────────────────────────────────
  async function endSession() {
    if (isEnding || transcript.length === 0) return;
    isEnding = true;
    endBtn.disabled = true;
    sendBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Wrapping up your session…';

    const transcriptText = transcript
      .map(m => `${m.role === 'user' ? 'Founder' : 'Marcus'}: ${m.content}`)
      .join('\n\n');

    // Hand the session id to /session-complete/ BEFORE the webhook fires, so
    // the destination page always finds it — even if we navigate before the
    // webhook resolves.
    try { sessionStorage.setItem('gc_last_session', sessionId); } catch (e) {}

    // Race the webhook against a 2s timeout.
    //  - If n8n S3 acks quickly (recommended: webhook node set to "Respond
    //    immediately"), we navigate within a few hundred ms.
    //  - If S3 is set to "Respond when last node finishes" (full Anthropic
    //    summary + DB writes + email = 5-15s), we navigate after 2s. The
    //    request continues in the background — webhooks.js sets keepalive:true
    //    so the browser guarantees delivery even after navigation.
    //  - If the webhook FAST-FAILS within 2s (network down, 5xx, etc.), we
    //    catch the rejection and let the user retry — better than navigating
    //    to a dead-end /session-complete/ with no data.
    //
    // /session-complete/ handles all three cases: immediate read on load,
    // realtime subscribe for live updates, polling backup, "check your inbox"
    // fallback after ~32s if no summary lands.
    try {
      const webhookPromise = GCWebhook.endSession(sessionId, userId, transcriptText);
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
      await Promise.race([webhookPromise, timeoutPromise]);
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Could not save session. Your transcript is preserved.';
      endBtn.disabled = false;
      isEnding = false;
      return;
    }

    window.location.href = '/session-complete/';
  }

  // ── Real-time goal bar update ─────────────────────────────────────────────────
  function subscribeToGoalProgress() {
    if (!goalBar) return;
    gcSupabase
      .channel('profile-goal-' + userId)
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'profiles',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        const progress = payload.new.goal_progress ?? 0;
        if (goalBar.tagName === 'PROGRESS') {
          goalBar.value = progress;
        } else {
          goalBar.style.width = progress + '%';
        }
      })
      .subscribe();
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  // Clear the welcome card immediately so the chat area is visible.
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.remove();

  // Show inline "…" thinking bubble RIGHT AWAY so the user sees Marcus is
  // composing — without this, the page feels dead for the 3-8s it takes
  // Anthropic to generate the opener. Declared outside the try so the catch
  // block can clean it up if anything below fails.
  const thinking = document.createElement('div');
  thinking.className = 'gc-message gc-message--assistant gc-message--thinking';
  thinking.textContent = '…';
  messagesEl.appendChild(thinking);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    if (statusEl) statusEl.textContent = '';  // bubble is doing the talking now

    // createSession + loadProfile don't depend on each other — run in parallel
    // to save ~150-300ms. Realtime subscribe is fire-and-forget.
    const [sessionIdResult, profile] = await Promise.all([
      createSession(),
      loadProfile()
    ]);
    sessionId = sessionIdResult;
    subscribeToGoalProgress();

    // Ask the Edge Function for a context-aware opener (empty messages = opener).
    // First-timers: opener reflects onboarding. Regulars: opener reflects history.
    let opener;
    try {
      opener = await callMarcus([], profile);
    } catch (e) {
      const name = profile.firstname ?? 'there';
      opener = `Hey ${name}. What's on your mind today?`;
    }

    // Swap the thinking bubble for the real opener and add to transcript
    // so Marcus has context of his own opening line when the user replies.
    thinking.remove();
    appendMessage('assistant', opener);
    transcript.push({ role: 'assistant', content: opener });

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    endBtn.addEventListener('click', endSession);

  } catch (err) {
    thinking.remove();
    if (statusEl) statusEl.textContent = err.message;
  }
})();
