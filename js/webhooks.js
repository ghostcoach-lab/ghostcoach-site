// GhostCoach — n8n webhook helper
// Requires: config.js

const GCWebhook = {

  // Internal: POST to an n8n webhook endpoint.
  // `keepalive:true` guarantees the request completes even if the page navigates
  // away mid-flight — critical for /chat/ endSession which fires the webhook
  // then immediately redirects to /session-complete/. Body limit for keepalive
  // is 64KB; all GC webhook payloads are well under that.
  async _post(path, body) {
    const url = GC.N8N_BASE + path;
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gc-secret':  GC.WEBHOOK_SECRET
      },
      body: JSON.stringify(body),
      keepalive: true
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webhook ${path} failed (${res.status}): ${text}`);
    }
    return res.json().catch(() => ({ ok: true }));
  },

  // S2 — Submit onboarding form (called after the user fills the onboarding questionnaire)
  // fields: { firstname, lastname, phone, country, product, stage, tools,
  //           business_model, bottleneck, tried, goal_90_day }
  async submitOnboarding(userId, fields) {
    return this._post(GC.WEBHOOK.ONBOARDING, { user_id: userId, ...fields });
  },

  // S3 — End coaching session (called when user clicks "End session")
  // transcript: full conversation as a string or array of { role, content } messages
  async endSession(sessionId, userId, transcript) {
    return this._post(GC.WEBHOOK.SESSION_END, {
      session_id:  sessionId,
      user_id:     userId,
      transcript:  typeof transcript === 'string' ? transcript : JSON.stringify(transcript)
    });
  },

  // S7 — Contact form submission
  // fields: { name, email, category, subject, message, user_id? }
  async submitContact(fields) {
    return this._post(GC.WEBHOOK.CONTACT, fields);
  },

  // S8 — Newsletter signup (footer form)
  // source: where the signup came from, e.g. 'footer_signup', 'pricing_page'
  async newsletterSignup(email, source = 'footer_signup') {
    return this._post(GC.WEBHOOK.NEWSLETTER, { email, source });
  }
};
