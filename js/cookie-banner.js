// GhostCoach — Cookie consent (banner + Google Consent Mode v2 signals)
// ─────────────────────────────────────────────────────────────────────────────
// This is the ONLY code in this file that must run before anything else: it
// defines the dataLayer + gtag() and sets Consent Mode v2 to "denied" by
// default. Google Tag Manager is NOT loaded here at start-up: it is loaded
// only after the visitor has accepted (see loadGtm below), so a visitor who
// rejects, or has not chosen yet, never contacts Google.
//
// gtag() must push the `arguments` object (not an array) — Google's scripts
// ignore array entries.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500
});

// Behaviour
//   • Two equal choices: Accept / Reject. Same size, weight and colour.
//   • Choice stored in localStorage:
//       gc_cookie_consent     'accepted' | 'rejected'
//       gc_cookie_consent_ts  epoch milliseconds when the choice was made
//   • A choice older than 12 months, one with a missing/invalid timestamp,
//     and the legacy value 'acknowledged' are all treated as "not chosen"
//     and the banner is shown again.
//   • Accepted (on load, or on click) -> gtag('consent','update',
//     { analytics_storage: 'granted' }) and then Google Tag Manager is
//     loaded once. The three ad signals are never granted. Rejecting leaves
//     the denied defaults in place and GTM is not loaded.
//
// Public API (window.GCCookies):
//   getConsent()  -> 'accepted' | 'rejected' | null   (null = no valid choice)
//   isAccepted()  -> true only if a valid choice is 'accepted'
//   isRejected()  -> true only if a valid choice is 'rejected'
//   open()        -> re-display the banner so the visitor can change their
//                    choice. The current choice stays in force until they
//                    pick again.

(function () {
  'use strict';

  const KEY = 'gc_cookie_consent';
  const TS_KEY = 'gc_cookie_consent_ts';
  const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 12 months
  const GTM_ID = 'GTM-M2CWLCV6';
  let gtmLoaded = false;    // GTM is injected at most once per page view

  let granted = false;      // has analytics_storage been granted this page view?
  let memChoice = null;     // fallback if localStorage is unavailable
  let lastFocus = null;     // element to hand focus back to after open()

  function clearStored() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(TS_KEY); } catch (e) {}
  }

  // Returns 'accepted' | 'rejected' | null. Anything else (legacy
  // 'acknowledged', expired, missing/invalid timestamp) counts as null.
  function readChoice() {
    let value = null, ts = NaN;
    try {
      value = localStorage.getItem(KEY);
      ts = parseInt(localStorage.getItem(TS_KEY), 10);
    } catch (e) {
      return memChoice;
    }
    if (value !== 'accepted' && value !== 'rejected') return null;
    const age = Date.now() - ts;
    if (!isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
    return value;
  }

  function getConsent() { return readChoice(); }

  function saveChoice(value) {
    memChoice = value;
    try {
      localStorage.setItem(KEY, value);
      localStorage.setItem(TS_KEY, String(Date.now()));
    } catch (e) {}
  }

  // Google's standard GTM loader, run only after consent. The consent
  // update is pushed first, so GTM starts with analytics_storage 'granted'.
  function loadGtm() {
    if (gtmLoaded) return;
    gtmLoaded = true;
    dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    const first = document.getElementsByTagName('script')[0];
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    if (first && first.parentNode) first.parentNode.insertBefore(tag, first);
    else (document.head || document.documentElement).appendChild(tag);
  }

  function grantAnalytics() {
    if (granted) return;
    granted = true;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    loadGtm();
  }

  // Only ever needed if the visitor accepted and then, in the same page view,
  // used Cookie Preferences to reject. On a normal Reject the denied default
  // is already in force and nothing is sent.
  function revokeAnalytics() {
    if (!granted) return;
    granted = false;
    gtag('consent', 'update', { analytics_storage: 'denied' });
  }

  function ensureStyles() {
    if (document.getElementById('gc-cookie-styles')) return;
    const style = document.createElement('style');
    style.id = 'gc-cookie-styles';
    style.textContent = `
      #gc-cookie-banner {
        position: fixed;
        left: 16px; right: 16px; bottom: 16px;
        max-width: 720px;
        margin: 0 auto;
        background: #1A1D27;
        color: #F7F5F0;
        font-family: 'DM Sans', sans-serif;
        padding: 18px 22px;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.35), inset 0 0 0 0.5px rgba(247,245,240,0.08);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 18px;
        flex-wrap: wrap;
        transform: translateY(140%);
        opacity: 0;
        transition: transform .35s ease, opacity .35s ease;
      }
      #gc-cookie-banner:focus { outline: none; }
      #gc-cookie-banner.gc-visible { transform: translateY(0); opacity: 1; }
      #gc-cookie-banner .gc-cookie-text {
        flex: 1 1 280px;
        font-size: 13.5px;
        line-height: 1.55;
        color: rgba(247,245,240,0.85);
      }
      #gc-cookie-banner .gc-cookie-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
      }
      #gc-cookie-banner .gc-cookie-link {
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        color: #E8A832;
        text-decoration: none;
        border-bottom: 1px solid rgba(232,168,50,0.35);
        transition: color .15s, border-color .15s;
      }
      #gc-cookie-banner .gc-cookie-link:hover {
        color: #F7F5F0;
        border-bottom-color: #F7F5F0;
      }
      /* Accept and Reject share ONE rule: identical size, weight, colour and
         prominence. Do not give either its own colour or emphasis. */
      #gc-cookie-banner button.gc-cookie-btn {
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
        min-width: 96px;
        padding: 9px 22px;
        border-radius: 999px;
        cursor: pointer;
        border: 1px solid #C8861E;
        background: #C8861E;
        color: #0F1117;
        transition: background .15s, border-color .15s;
        white-space: nowrap;
      }
      #gc-cookie-banner button.gc-cookie-btn:hover { background: #E8A832; border-color: #E8A832; }
      #gc-cookie-banner button.gc-cookie-btn:focus-visible,
      #gc-cookie-banner .gc-cookie-link:focus-visible {
        outline: 2px solid #F7F5F0;
        outline-offset: 3px;
      }
      @media (max-width: 520px) {
        #gc-cookie-banner { left: 12px; right: 12px; bottom: 12px; padding: 16px; gap: 12px; }
        #gc-cookie-banner .gc-cookie-actions {
          width: 100%;
          flex-wrap: wrap;
          justify-content: space-between;
        }
        #gc-cookie-banner .gc-cookie-link {
          flex: 1 0 100%;
          border-bottom: none;
          text-decoration: underline;
          text-decoration-color: rgba(232,168,50,0.35);
          text-underline-offset: 3px;
        }
        #gc-cookie-banner button.gc-cookie-btn { flex: 1 1 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        #gc-cookie-banner { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function hide() {
    const b = document.getElementById('gc-cookie-banner');
    if (!b) return;
    b.classList.remove('gc-visible');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
    // If the visitor got here via Cookie Preferences, hand focus back to it.
    if (lastFocus && document.body.contains(lastFocus) && lastFocus.focus) {
      try { lastFocus.focus(); } catch (e) {}
    }
    lastFocus = null;
  }

  function choose(value) {
    saveChoice(value);
    if (value === 'accepted') grantAnalytics();
    else revokeAnalytics();
    hide();
  }

  function injectBanner(takeFocus) {
    if (document.getElementById('gc-cookie-banner')) return;
    if (!document.body) return;
    ensureStyles();

    const banner = document.createElement('div');
    banner.id = 'gc-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie choices');
    banner.setAttribute('aria-describedby', 'gc-cookie-text');
    banner.tabIndex = -1;
    banner.innerHTML =
      '<div class="gc-cookie-text" id="gc-cookie-text">' +
        // PROPOSED WORDING — pending founder approval.
        'GhostCoach uses essential cookies to sign you in and process payments. ' +
        'We&rsquo;d also like to use optional analytics cookies to understand how the site is used &mdash; ' +
        'only if you say yes.' +
      '</div>' +
      '<div class="gc-cookie-actions">' +
        '<a href="/cookies/" class="gc-cookie-link">Learn more</a>' +
        '<button id="gc-cookie-accept" class="gc-cookie-btn" type="button">Accept</button>' +
        '<button id="gc-cookie-reject" class="gc-cookie-btn" type="button">Reject</button>' +
      '</div>';

    // First child of <body> so keyboard users reach it first, rather than
    // after the whole page. It is position:fixed, so layout is unaffected.
    document.body.insertBefore(banner, document.body.firstChild);
    requestAnimationFrame(function () { banner.classList.add('gc-visible'); });

    document.getElementById('gc-cookie-accept').addEventListener('click', function () { choose('accepted'); });
    document.getElementById('gc-cookie-reject').addEventListener('click', function () { choose('rejected'); });

    if (takeFocus) banner.focus();
  }

  function openPrefs() {
    lastFocus = document.activeElement;
    const existing = document.getElementById('gc-cookie-banner');
    if (existing) existing.parentNode.removeChild(existing);
    injectBanner(true);
  }

  // ── Runs immediately (before DOM ready) so a returning visitor's "accepted"
  //    is in the dataLayer straight after the denied default. ────────────────
  const initial = readChoice();
  if (initial === 'accepted') grantAnalytics();
  if (!initial) clearStored(); // drop legacy 'acknowledged' / expired values

  function init() {
    if (!readChoice()) injectBanner(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GCCookies = {
    getConsent: getConsent,
    isAccepted: function () { return readChoice() === 'accepted'; },
    isRejected: function () { return readChoice() === 'rejected'; },
    open: openPrefs
  };
})();
