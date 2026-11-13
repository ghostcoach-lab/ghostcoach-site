// GhostCoach — GA4 events (via dataLayer) and `src` capture
// Load AFTER config.js, supabase-client.js, auth.js and webhooks.js, and BEFORE
// the page script. cookie-banner.js stays last. Exposes window.GCTrack.
//
// Rules this file follows:
//  - Events go to window.dataLayer only. GTM loads after the visitor clicks
//    Accept (cookie-banner.js), so a push is harmless when GTM is not loaded.
//  - No personal data in events: no email, name, user id or session content.
//  - sessionStorage only. No localStorage keys.
//  - Analytics must never break the funnel: every function swallows its errors.

(function () {
  'use strict';

  var SRC_KEY = 'gc_src';                       // validated src, set on /signup/
  var FLAG_SIGNUP_GOOGLE = 'gc_ga_signup_google';
  var FLAG_TRIAL = 'gc_ga_trial_started';
  var FLAG_FIRST_SESSION = 'gc_ga_first_session';
  var SRC_PATTERN = /^[a-z0-9-]{1,40}$/;        // lowercase letters, digits, hyphens; max 40
  var NEW_ACCOUNT_WINDOW_MS = 60 * 1000;        // Google: created_at vs last_sign_in_at

  // ── sessionStorage, wrapped (can throw in private mode / blocked storage) ──
  function ssGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function ssSet(key, value) {
    try { window.sessionStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function ssRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // Returns a valid src or null. An invalid value is dropped whole, never
  // "repaired", so a mangled spelling cannot pollute the reports.
  function cleanSrc(value) {
    if (typeof value !== 'string') return null;
    var v = value.toLowerCase();
    return SRC_PATTERN.test(v) ? v : null;
  }

  // /signup/ only. Reads ?src=, stores it for the Google round trip, and clears
  // any older value when the URL has none, so a stale src is never reused.
  function captureSrcFromUrl() {
    var src = null;
    try { src = cleanSrc(new URLSearchParams(window.location.search).get('src')); } catch (e) { src = null; }
    if (src) ssSet(SRC_KEY, src); else ssRemove(SRC_KEY);
    return src;
  }

  // src for an event: the value saved on /signup/ (Google flow), else the one
  // stored on the account at signup (email flow, survives the confirmation email).
  function getSrc(user) {
    var stored = cleanSrc(ssGet(SRC_KEY));
    if (stored) return stored;
    var meta = user && user.user_metadata;
    return cleanSrc(meta && meta.src);
  }

  // Build the dataLayer object. Empty values are left out ("no src" means no key).
  function buildEvent(name, params, extra) {
    var obj = { event: name };
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== null && v !== undefined && v !== '') obj[k] = v;
    });
    Object.keys(extra || {}).forEach(function (k) { obj[k] = extra[k]; });
    return obj;
  }

  function push(name, params, extra) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(buildEvent(name, params, extra));
      return true;
    } catch (e) {
      return false;
    }
  }

  function analyticsAccepted() {
    try { return !!(window.GCCookies && window.GCCookies.isAccepted && window.GCCookies.isAccepted()); }
    catch (e) { return false; }
  }

  // Runs fn once per tab session. If sessionStorage is unavailable we cannot
  // guard, so we run it (a rare duplicate is better than losing the event).
  function once(flag, fn) {
    if (ssGet(flag)) return false;
    ssSet(flag, '1');
    fn();
    return true;
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  // sign_up: method = "email" | "google"
  function trackSignUp(method, src) {
    if (method !== 'email' && method !== 'google') return false;
    return push('sign_up', { method: method, src: cleanSrc(src) });
  }

  // trial_started: plan = "builder" | "operator" (never lifetime).
  // Pushes first. If analytics is accepted, waits for GTM's eventCallback with a
  // 300 ms cap before resolving, so the redirect does not cut the hit off.
  // If not accepted, resolves immediately. Always resolves, never rejects.
  function trackTrialStarted(plan, src, maxMs) {
    return new Promise(function (resolve) {
      var finished = false;
      function finish() { if (!finished) { finished = true; resolve(); } }
      if (plan !== 'builder' && plan !== 'operator') { finish(); return; }
      var cap = typeof maxMs === 'number' ? maxMs : 300;
      var accepted = analyticsAccepted();
      var fired = once(FLAG_TRIAL, function () {
        push('trial_started', { plan: plan, src: cleanSrc(src) },
          accepted ? { eventCallback: finish, eventTimeout: cap } : null);
      });
      if (!fired || !accepted) { finish(); return; }
      setTimeout(finish, cap);
    });
  }

  // first_session_started: the user's first entry to /chat/. Once per user (the
  // caller checks there are no earlier sessions); the flag stops a repeat in one tab.
  function trackFirstSession(src, plan) {
    var p = (plan === 'builder' || plan === 'operator') ? plan : null;
    return once(FLAG_FIRST_SESSION, function () {
      push('first_session_started', { plan: p, src: cleanSrc(src) });
    });
  }

  // ── Google signups: /payment/ is where the OAuth round trip lands ──────────

  function isGoogleUser(user) {
    if (!user) return false;
    if (user.app_metadata && user.app_metadata.provider === 'google') return true;
    var ids = user.identities || [];
    for (var i = 0; i < ids.length; i++) { if (ids[i] && ids[i].provider === 'google') return true; }
    return false;
  }

  // A Google account is "newly created" when its first sign-in is the creation.
  // A returning login moves last_sign_in_at well past created_at.
  function isNewGoogleUser(user) {
    if (!isGoogleUser(user) || !user.created_at || !user.last_sign_in_at) return false;
    var gap = Math.abs(new Date(user.last_sign_in_at).getTime() - new Date(user.created_at).getTime());
    return isFinite(gap) && gap <= NEW_ACCOUNT_WINDOW_MS;
  }

  // Call on /payment/ with the signed-in user. Two jobs:
  //  1. Save the src captured on /signup/ to the account (Google flow only needs
  //     this; email signups already carry it in their metadata).
  //  2. Fire sign_up (method google) once, only for a newly created account.
  async function onPaymentLanding(user) {
    try {
      if (!user) return;
      var stored = cleanSrc(ssGet(SRC_KEY));
      var existing = cleanSrc(user.user_metadata && user.user_metadata.src);
      if (stored && !existing && window.gcSupabase && window.gcSupabase.auth) {
        var res = await window.gcSupabase.auth.updateUser({ data: { src: stored } });
        if (res && res.error) console.warn('src: could not save to account:', res.error.message);
      }
      if (isNewGoogleUser(user)) {
        once(FLAG_SIGNUP_GOOGLE, function () { trackSignUp('google', stored || existing); });
      }
    } catch (e) {
      console.warn('analytics: payment landing step failed:', (e && e.message) || e);
    }
  }

  window.GCTrack = {
    cleanSrc: cleanSrc,
    captureSrcFromUrl: captureSrcFromUrl,
    getSrc: getSrc,
    trackSignUp: trackSignUp,
    trackTrialStarted: trackTrialStarted,
    trackFirstSession: trackFirstSession,
    isNewGoogleUser: isNewGoogleUser,
    onPaymentLanding: onPaymentLanding
  };
})();
