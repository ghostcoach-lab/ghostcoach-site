const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'analytics.js'), 'utf8');

// Minimal browser stand-in: window, sessionStorage, dataLayer, GCCookies, gcSupabase.
function load({ search = '', accepted = false, storage = {}, updateUser } = {}) {
  const store = { ...storage };
  const sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const updates = [];
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    setTimeout, URLSearchParams, Date,
    sessionStorage,
    location: { search },
    GCCookies: { isAccepted: () => accepted },
    gcSupabase: {
      auth: {
        updateUser: async (arg) => { updates.push(arg); return updateUser ? updateUser(arg) : { error: null }; }
      }
    }
  });
  ctx.window = ctx;
  ctx.window.sessionStorage = sessionStorage;
  ctx.window.location = ctx.location;
  vm.runInContext(SOURCE, ctx);
  return { ctx, T: ctx.GCTrack, store, updates, events: () => (ctx.dataLayer || []).slice() };
}

// ── src validation ───────────────────────────────────────────────────────
test('cleanSrc lowercases and accepts [a-z0-9-] up to 40 characters', () => {
  const { T } = load();
  assert.equal(T.cleanSrc('home-hero'), 'home-hero');
  assert.equal(T.cleanSrc('Vibe-Plan-Builder-Monthly'), 'vibe-plan-builder-monthly');
  assert.equal(T.cleanSrc('a'.repeat(40)), 'a'.repeat(40));
});

test('cleanSrc drops anything else whole, without repairing it', () => {
  const { T } = load();
  for (const bad of ['', 'a'.repeat(41), 'home hero', 'home_hero', 'home.hero', 'a@b.com', '<script>', 'café', null, undefined, 42]) {
    assert.equal(T.cleanSrc(bad), null, String(bad));
  }
});

test('captureSrcFromUrl stores a valid src and returns it', () => {
  const { T, store } = load({ search: '?plan=builder&src=Vibe-Home' });
  assert.equal(T.captureSrcFromUrl(), 'vibe-home');
  assert.equal(store.gc_src, 'vibe-home');
});

test('captureSrcFromUrl stores nothing for a missing or invalid src, and clears an older one', () => {
  for (const search of ['?plan=builder', '?src=bad_value', '?src=' + 'x'.repeat(41)]) {
    const { T, store } = load({ search, storage: { gc_src: 'old-value' } });
    assert.equal(T.captureSrcFromUrl(), null);
    assert.ok(!('gc_src' in store), search);
  }
});

test('getSrc prefers the saved value, falls back to account metadata, else null', () => {
  assert.equal(load({ storage: { gc_src: 'home-hero' } }).T.getSrc({ user_metadata: { src: 'frameworks' } }), 'home-hero');
  assert.equal(load().T.getSrc({ user_metadata: { src: 'frameworks' } }), 'frameworks');
  assert.equal(load().T.getSrc({ user_metadata: { src: 'Bad Value' } }), null);
  assert.equal(load().T.getSrc(null), null);
});

// ── sign_up ──────────────────────────────────────────────────────────────
test('sign_up carries method and src, and omits src when there is none', () => {
  const a = load(); a.T.trackSignUp('email', 'home-hero');
  assert.deepEqual({ ...a.events()[0] }, { event: 'sign_up', method: 'email', src: 'home-hero' });
  const b = load(); b.T.trackSignUp('google', null);
  assert.deepEqual({ ...b.events()[0] }, { event: 'sign_up', method: 'google' });
});

test('sign_up rejects an unknown method', () => {
  const a = load();
  assert.equal(a.T.trackSignUp('facebook', 'x'), false);
  assert.equal(a.events().length, 0);
});

// ── trial_started ────────────────────────────────────────────────────────
test('trial_started, not accepted: one push, no callback, resolves at once', async () => {
  const a = load();
  await a.T.trackTrialStarted('builder', 'vibe-home');
  const ev = a.events();
  assert.equal(ev.length, 1);
  assert.deepEqual({ ...ev[0] }, { event: 'trial_started', plan: 'builder', src: 'vibe-home' });
});

test('trial_started, accepted: waits for eventCallback', async () => {
  const a = load({ accepted: true });
  let resolved = false;
  const p = a.T.trackTrialStarted('operator', null).then(() => { resolved = true; });
  const ev = a.events()[0];
  assert.equal(ev.event, 'trial_started');
  assert.equal(ev.plan, 'operator');
  assert.ok(!('src' in ev));
  assert.equal(typeof ev.eventCallback, 'function');
  assert.equal(ev.eventTimeout, 300);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false, 'must not resolve before GTM confirms');
  ev.eventCallback();
  await p;
  assert.equal(resolved, true);
});

test('trial_started, accepted but GTM never answers: resolves at the cap', async () => {
  const a = load({ accepted: true });
  const t0 = Date.now();
  await a.T.trackTrialStarted('builder', null, 40);
  const waited = Date.now() - t0;
  assert.ok(waited >= 30 && waited < 400, 'waited ' + waited);
});

test('trial_started fires once per trial and never for lifetime or unknown plans', async () => {
  const a = load();
  await a.T.trackTrialStarted('builder', null);
  await a.T.trackTrialStarted('builder', null);
  assert.equal(a.events().length, 1);
  const b = load();
  await b.T.trackTrialStarted('lifetime', null);
  await b.T.trackTrialStarted('whatever', null);
  assert.equal(b.events().length, 0);
});

// ── first_session_started ────────────────────────────────────────────────
test('first_session_started fires once and omits plan unless builder/operator', () => {
  const a = load();
  assert.equal(a.T.trackFirstSession('home-hero'), true);
  assert.equal(a.T.trackFirstSession('home-hero'), false);
  assert.deepEqual({ ...a.events()[0] }, { event: 'first_session_started', src: 'home-hero' });
  const b = load(); b.T.trackFirstSession(null, 'operator');
  assert.deepEqual({ ...b.events()[0] }, { event: 'first_session_started', plan: 'operator' });
});

// ── Google: new account detection and landing step ──────────────────────
const googleUser = (over = {}) => ({
  app_metadata: { provider: 'google' },
  created_at: '2026-11-13T10:00:00.000Z',
  last_sign_in_at: '2026-11-13T10:00:01.000Z',
  user_metadata: {},
  ...over
});

test('isNewGoogleUser: new Google account yes; returning login, email account, missing dates no', () => {
  const { T } = load();
  assert.equal(T.isNewGoogleUser(googleUser()), true);
  assert.equal(T.isNewGoogleUser(googleUser({ last_sign_in_at: '2026-11-20T09:00:00.000Z' })), false);
  assert.equal(T.isNewGoogleUser(googleUser({ app_metadata: { provider: 'email' } })), false);
  assert.equal(T.isNewGoogleUser(googleUser({ last_sign_in_at: undefined })), false);
  assert.equal(T.isNewGoogleUser(null), false);
});

test('payment landing, new Google user: saves src to the account and fires sign_up once', async () => {
  const a = load({ storage: { gc_src: 'claude-self-coaching' } });
  await a.T.onPaymentLanding(googleUser());
  // Reload: by now the account carries the src, so nothing is written again.
  await a.T.onPaymentLanding(googleUser({ user_metadata: { src: 'claude-self-coaching' } }));
  assert.equal(a.updates.length, 1);
  assert.equal(a.updates[0].data.src, 'claude-self-coaching');
  const signups = a.events().filter((e) => e.event === 'sign_up');
  assert.equal(signups.length, 1);
  assert.deepEqual({ ...signups[0] }, { event: 'sign_up', method: 'google', src: 'claude-self-coaching' });
});

test('payment landing: no src saved when the account already has one or nothing was captured', async () => {
  const a = load({ storage: { gc_src: 'frameworks' } });
  await a.T.onPaymentLanding(googleUser({ user_metadata: { src: 'home-hero' } }));
  assert.equal(a.updates.length, 0);
  const b = load();
  await b.T.onPaymentLanding(googleUser());
  assert.equal(b.updates.length, 0);
  assert.deepEqual({ ...b.events()[0] }, { event: 'sign_up', method: 'google' });
});

test('payment landing: returning Google login and email users fire no sign_up', async () => {
  const a = load();
  await a.T.onPaymentLanding(googleUser({ last_sign_in_at: '2026-12-01T09:00:00.000Z' }));
  await a.T.onPaymentLanding({ app_metadata: { provider: 'email' }, created_at: 'x', last_sign_in_at: 'x', user_metadata: {} });
  assert.equal(a.events().length, 0);
});

test('payment landing swallows errors from the account update', async () => {
  const a = load({ storage: { gc_src: 'frameworks' }, updateUser: async () => { throw new Error('network'); } });
  await a.T.onPaymentLanding(googleUser());
  assert.ok(true);
});

// ── no personal data, ever ───────────────────────────────────────────────
test('events only ever contain event, method, plan, src and GTM callback keys', async () => {
  const a = load({ accepted: true });
  a.T.trackSignUp('email', 'home-hero');
  a.T.trackFirstSession('home-hero', 'builder');
  const p = a.T.trackTrialStarted('builder', 'home-hero', 20);
  await p;
  const allowed = new Set(['event', 'method', 'plan', 'src', 'eventCallback', 'eventTimeout']);
  for (const ev of a.events()) for (const k of Object.keys(ev)) assert.ok(allowed.has(k), k);
});
