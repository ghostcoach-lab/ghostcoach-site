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
    const { data, error } = await supabase
      .from('profiles')
      .select('firstname, goal_90_day, goal_progress, stage')
      .eq('user_id', userId)
      .single();
    if (error) console.warn('Could not load profile:', error.message);
    return data ?? {};
  }

  // ── Create a new session row in Supabase ─────────────────────────────────────
  async function createSession() {
    const { data, error } = await supabase
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
    if (statusEl) statusEl.textContent = 'Processing your session…';

    try {
      const transcriptText = transcript
        .map(m => `${m.role === 'user' ? 'Founder' : 'Marcus'}: ${m.content}`)
        .join('\n\n');

      await GCWebhook.endSession(sessionId, userId, transcriptText);

      if (statusEl) statusEl.textContent = 'Session saved. Redirecting…';
      setTimeout(() => { window.location.href = '/dashboard/'; }, 1500);
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Could not save session. Your transcript is preserved.';
      endBtn.disabled = false;
      isEnding = false;
    }
  }

  // ── Real-time goal bar update ─────────────────────────────────────────────────
  function subscribeToGoalProgress() {
    if (!goalBar) return;
    supabase
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
  try {
    sessionId = await createSession();
    subscribeToGoalProgress();

    const profile = await loadProfile();
    const name = profile.firstname ?? 'there';
    appendMessage('assistant', `Hey ${name}. What's on your mind today?`);

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    endBtn.addEventListener('click', endSession);

  } catch (err) {
    if (statusEl) statusEl.textContent = err.message;
  }
})();
