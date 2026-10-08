const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'cookie-banner.js'), 'utf8');
const DAY = 24 * 60 * 60 * 1000;

// Minimal browser stand-in: just enough for cookie-banner.js to run.
function load({ stored = {}, now = Date.now() } = {}) {
  const store = { ...stored };
  const listeners = {};
  const injected = [];
  const buttons = {};
  const firstScript = { parentNode: { insertBefore: (tag) => injected.push(tag) } };
  const el = (tag) => ({
    tag, style: {}, classList: { add() {}, remove() {} }, setAttribute() {},
    addEventListener(type, fn) { this.handlers = this.handlers || {}; this.handlers[type] = fn; },
    appendChild() {}, focus() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; }
  });
  const body = { firstChild: null, insertBefore(node) { this.banner = node; }, appendChild() {} };
  const document = {
    readyState: 'complete', body, head: { appendChild() {} }, documentElement: { appendChild() {} },
    createElement: (tag) => el(tag),
    getElementById: (id) => {
      if (id === 'gc-cookie-accept' || id === 'gc-cookie-reject') {
        buttons[id] = buttons[id] || el('button');
        return body.banner ? buttons[id] : null;
      }
      return null;
    },
    getElementsByTagName: () => [firstScript],
    addEventListener(type, fn) { listeners[type] = fn; },
    contains: () => false, activeElement: null
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const DateStub = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  const ctx = vm.createContext({ document, localStorage, requestAnimationFrame: (f) => f(), Date: DateStub, console });
  ctx.window = ctx; // in a browser the global object is window
  vm.runInContext(SOURCE, ctx);
  return { ctx, store, injected, buttons, body };
}

const dl = (ctx) => Array.from(ctx.dataLayer, (a) => Array.from(a));
const gtmTags = (r) => r.injected.filter((t) => String(t.src).includes('googletagmanager.com'));

test('first visit: consent defaults are denied, banner shown, no Google script', () => {
  const r = load();
  const first = dl(r.ctx)[0];
  assert.deepEqual(first.slice(0, 2), ['consent', 'default']);
  assert.equal(first[2].analytics_storage, 'denied');
  assert.equal(first[2].ad_storage, 'denied');
  assert.equal(first[2].ad_user_data, 'denied');
  assert.equal(first[2].ad_personalization, 'denied');
  assert.ok(r.body.banner, 'banner is shown');
  assert.equal(gtmTags(r).length, 0);
  assert.equal(dl(r.ctx).some((e) => e[1] === 'update'), false);
});

test('Accept: grants analytics only, then loads GTM once with the right ID', () => {
  const r = load();
  r.ctx.document.getElementById('gc-cookie-accept').handlers.click();
  const updates = dl(r.ctx).filter((e) => e[0] === 'consent' && e[1] === 'update');
  assert.equal(updates.length, 1);
  assert.deepEqual({ ...updates[0][2] }, { analytics_storage: 'granted' });
  const tags = gtmTags(r);
  assert.equal(tags.length, 1);
  assert.equal(tags[0].src, 'https://www.googletagmanager.com/gtm.js?id=GTM-M2CWLCV6');
  assert.equal(tags[0].async, true);
  assert.equal(r.store.gc_cookie_consent, 'accepted');
  const idxUpdate = dl(r.ctx).findIndex((e) => e[1] === 'update');
  const idxStart = r.ctx.dataLayer.findIndex((e) => e && e.event === 'gtm.js');
  assert.ok(idxUpdate < idxStart, 'consent update is pushed before gtm.js start');
});

test('Reject: nothing granted, GTM never loaded', () => {
  const r = load();
  r.ctx.document.getElementById('gc-cookie-reject').handlers.click();
  assert.equal(dl(r.ctx).some((e) => e[1] === 'update'), false);
  assert.equal(gtmTags(r).length, 0);
  assert.equal(r.store.gc_cookie_consent, 'rejected');
});

test('returning visitor who accepted: granted and GTM loaded straight away, no banner', () => {
  const now = Date.now();
  const r = load({ now, stored: { gc_cookie_consent: 'accepted', gc_cookie_consent_ts: String(now - 5 * DAY) } });
  assert.equal(dl(r.ctx).filter((e) => e[1] === 'update').length, 1);
  assert.equal(gtmTags(r).length, 1);
  assert.equal(r.body.banner, undefined);
});

test('returning visitor who rejected: nothing loads, no banner', () => {
  const now = Date.now();
  const r = load({ now, stored: { gc_cookie_consent: 'rejected', gc_cookie_consent_ts: String(now - 5 * DAY) } });
  assert.equal(gtmTags(r).length, 0);
  assert.equal(r.body.banner, undefined);
});

test('expired (13 months) and legacy "acknowledged" choices are asked again, nothing loads', () => {
  const now = Date.now();
  const old = load({ now, stored: { gc_cookie_consent: 'accepted', gc_cookie_consent_ts: String(now - 400 * DAY) } });
  assert.ok(old.body.banner);
  assert.equal(gtmTags(old).length, 0);
  const legacy = load({ now, stored: { gc_cookie_consent: 'acknowledged' } });
  assert.ok(legacy.body.banner);
  assert.equal(gtmTags(legacy).length, 0);
});

test('only one GTM container ID is in the file, and no noscript iframe', () => {
  assert.equal((SOURCE.match(/GTM-[A-Z0-9]+/g) || []).length, 1);
  assert.equal(/ns\.html/.test(SOURCE), false);
});
