// GhostCoach — Cookie consent banner
//
// Informational notice shown on first visit. The site uses only strictly-
// necessary cookies (no analytics, no tracking), so the banner does not
// gate any optional behaviour today. It serves to inform users and link
// them to the Cookie Policy.
//
// The user's dismissal is persisted in localStorage under 'gc_cookie_consent'
// with value 'acknowledged'. This persistence is itself a strictly-necessary
// use of storage (otherwise the banner would re-appear every session).
//
// Future analytics integration:
//   When optional cookies (analytics, etc.) are added, this banner will be
//   updated to show Accept/Reject buttons, the stored value will become
//   'accepted' or 'rejected', and any optional script loading should be
//   gated on window.GCCookies.isAccepted().
//
// Public API (window.GCCookies):
//   getConsent()   -> 'accepted' | 'rejected' | 'acknowledged' | null
//   isAccepted()   -> true only if value === 'accepted' (false for the
//                     informational-only 'acknowledged' state)
//   open()         -> re-display the banner (clears the stored value)

(function () {
  'use strict';

  const KEY = 'gc_cookie_consent';

  function getConsent() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
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
      #gc-cookie-banner.gc-visible { transform: translateY(0); opacity: 1; }
      #gc-cookie-banner .gc-cookie-text {
        flex: 1 1 280px;
        font-size: 13.5px;
        line-height: 1.55;
        color: rgba(247,245,240,0.85);
      }
      #gc-cookie-banner .gc-cookie-text strong { color: #F7F5F0; font-weight: 600; }
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
      #gc-cookie-banner .gc-cookie-sep {
        color: rgba(247,245,240,0.3);
        font-size: 14px;
      }
      #gc-cookie-banner button#gc-cookie-accept {
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        font-weight: 600;
        padding: 9px 22px;
        border-radius: 999px;
        cursor: pointer;
        border: none;
        background: #C8861E;
        color: #0F1117;
        transition: background .15s;
        white-space: nowrap;
      }
      #gc-cookie-banner button#gc-cookie-accept:hover { background: #E8A832; }
      @media (max-width: 520px) {
        #gc-cookie-banner { left: 12px; right: 12px; bottom: 12px; padding: 16px; gap: 12px; }
        #gc-cookie-banner .gc-cookie-actions {
          width: 100%;
          justify-content: space-between;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function injectBanner() {
    if (document.getElementById('gc-cookie-banner')) return;
    if (!document.body) return;
    ensureStyles();

    const banner = document.createElement('div');
    banner.id = 'gc-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie notice');
    banner.innerHTML =
      '<div class="gc-cookie-text">' +
        'GhostCoach uses only essential cookies &mdash; to sign you in and process payments. No tracking, no analytics.' +
      '</div>' +
      '<div class="gc-cookie-actions">' +
        '<a href="/cookies/" class="gc-cookie-link">Learn more</a>' +
        '<span class="gc-cookie-sep" aria-hidden="true">&middot;</span>' +
        '<button id="gc-cookie-accept" type="button">Got it</button>' +
      '</div>';

    document.body.appendChild(banner);
    requestAnimationFrame(function () { banner.classList.add('gc-visible'); });

    document.getElementById('gc-cookie-accept').addEventListener('click', function () {
      setConsent('acknowledged');
      hide();
    });
  }

  function hide() {
    const b = document.getElementById('gc-cookie-banner');
    if (!b) return;
    b.classList.remove('gc-visible');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
  }

  function openPrefs() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    const existing = document.getElementById('gc-cookie-banner');
    if (existing) existing.parentNode.removeChild(existing);
    injectBanner();
  }

  function init() {
    if (!getConsent()) injectBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GCCookies = {
    getConsent: getConsent,
    isAccepted: function () { return getConsent() === 'accepted'; },
    open: openPrefs
  };
})();
