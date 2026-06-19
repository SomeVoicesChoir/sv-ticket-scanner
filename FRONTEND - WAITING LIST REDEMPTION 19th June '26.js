// Squarespace embed for /ticket-waiting-list
//
// Page lifecycle:
//   1. Reads ?token=xxx from the URL
//   2. GET /api/waiting-list/lookup/{token}
//        → 200 with event + customer details (prefill)
//        → 404 / 410 with a user-facing reason message
//   3. Renders a tidy "claim your ticket" card with the event details and
//      a prefilled form (first name, surname, email, phone, postcode,
//      mailing list opt-in)
//   4. On submit, POST /api/waiting-list/redeem-checkout
//        → returns { sessionId } from Stripe Checkout
//   5. stripe.redirectToCheckout({ sessionId })
//
// ─────────────────────────────────────────────────────────────────────
// HOW TO DEPLOY:
//   1. In Squarespace, open the /ticket-waiting-list page → Edit
//   2. Open the Code Block → DELETE everything currently inside it
//   3. Copy EVERYTHING below the "PASTE FROM HERE" line below
//      (do NOT include these // comment lines — Squarespace renders
//       them as visible text on the page because they're outside any
//       <script> tag)
//   4. Paste into the Code Block, Save, then test by hitting the page
//      with a real ?token=... in the URL
//
// Squarespace re-renders code blocks independently, so keep style + script
// in this ONE block — don't split across multiple Code Blocks.
// ─────────────────────────────────────────────────────────────────────
//
// ═════════════════════════════════════════════════════════════════════
// ▼▼▼ PASTE FROM HERE — everything below goes into Squarespace ▼▼▼
// ═════════════════════════════════════════════════════════════════════

<style>
  #wl-redeem-wrap {
    max-width: 640px;
    margin: 40px auto;
    padding: 32px 28px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1a1a1a;
    transform: translateX(30px);   /* nudges the card right to feel
                                      visually centred against the
                                      Squarespace page chrome. Increase
                                      or decrease to taste. */
  }
  /* On narrow screens, reset the nudge so we don't push off the right edge. */
  @media (max-width: 700px) {
    #wl-redeem-wrap { transform: none; }
  }
  #wl-redeem-wrap .wl-greeting {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 20px 0;
    line-height: 1.3;
  }
  #wl-redeem-wrap .wl-event-details {
    background: #faf6ee;
    border: 1px solid #f0e4cc;
    border-radius: 8px;
    padding: 20px 22px;
    margin: 20px 0 24px 0;
    font-size: 18px;            /* bumped +1 step (was 16px) */
    line-height: 1.55;
  }
  #wl-redeem-wrap .wl-event-name {
    font-size: 22px;            /* bumped +1 step (was 20px) */
    font-weight: 700;
    display: block;
    margin-bottom: 6px;
  }
  #wl-redeem-wrap .wl-event-meta {
    color: #444;
  }
  #wl-redeem-wrap .wl-expires {
    font-size: 18px;            /* bumped +2 steps (was 14px) */
    color: #444;
    text-align: center;
    margin: 20px 0;
    line-height: 1.5;
  }
  #wl-redeem-wrap .wl-form { margin-top: 24px; }
  #wl-redeem-wrap .wl-form label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #555;
    margin: 14px 0 6px 0;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  #wl-redeem-wrap .wl-form input[type="text"],
  #wl-redeem-wrap .wl-form input[type="email"],
  #wl-redeem-wrap .wl-form input[type="tel"] {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    border: 1px solid #d8d8d8;
    border-radius: 6px;
    font-size: 16px;
    font-family: inherit;
    background: #fff;
    color: #1a1a1a;
  }
  #wl-redeem-wrap .wl-form input:focus {
    outline: none;
    border-color: #f4dbc0;
    box-shadow: 0 0 0 3px rgba(244, 219, 192, 0.4);
  }
  #wl-redeem-wrap .wl-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  #wl-redeem-wrap .wl-optin {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 18px 0;
    padding: 12px;
    background: #fafafa;
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.4;
    cursor: pointer;
  }
  #wl-redeem-wrap .wl-optin input { margin-top: 3px; }
  #wl-redeem-wrap .wl-submit {
    display: block;
    width: 100%;
    padding: 18px 28px;
    margin-top: 12px;
    background: #f4dbc0;
    color: #000 !important;
    border: none;
    border-radius: 8px;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    cursor: pointer;
    font-family: inherit;
  }
  #wl-redeem-wrap .wl-submit:hover { background: #ecd0b0; }
  #wl-redeem-wrap .wl-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  #wl-redeem-wrap .wl-error {
    padding: 20px;
    background: #fff4f3;
    border: 1px solid #ea3e28;
    border-radius: 8px;
    color: #b13020;
    text-align: center;
    font-size: 16px;
    line-height: 1.5;
  }
  #wl-redeem-wrap .wl-loading {
    text-align: center;
    color: #666;
    font-size: 15px;
    padding: 40px 0;
  }
  #wl-redeem-wrap .wl-form-error {
    margin-top: 12px;
    color: #b13020;
    text-align: center;
    font-size: 14px;
  }
</style>

<div id="wl-redeem-wrap">
  <div id="wl-state-loading" class="wl-loading">Loading your invitation…</div>
  <div id="wl-state-error" style="display:none;" class="wl-error"></div>
  <div id="wl-state-ready" style="display:none;">
    <p class="wl-greeting">Hi <span id="wl-first-name"></span> — a ticket has just become available.</p>

    <div class="wl-event-details">
      <span class="wl-event-name" id="wl-event-name"></span>
      <span class="wl-event-meta" id="wl-event-meta"></span>
    </div>

    <p class="wl-expires">
      This invitation expires <strong id="wl-expires-at"></strong>. After that, the ticket will be offered to the next person on the waiting list.
    </p>

    <form id="wl-form" class="wl-form" autocomplete="on">
      <div class="wl-row-2">
        <div>
          <label for="wl-fn">First Name</label>
          <input type="text" id="wl-fn" name="firstName" required autocomplete="given-name">
        </div>
        <div>
          <label for="wl-sn">Surname</label>
          <input type="text" id="wl-sn" name="surname" required autocomplete="family-name">
        </div>
      </div>

      <label for="wl-em">Email</label>
      <input type="email" id="wl-em" name="email" required autocomplete="email">

      <div class="wl-row-2">
        <div>
          <label for="wl-ph">Phone</label>
          <input type="tel" id="wl-ph" name="phone" required autocomplete="tel">
        </div>
        <div>
          <label for="wl-pc">Postcode</label>
          <input type="text" id="wl-pc" name="postcode" required autocomplete="postal-code">
        </div>
      </div>

      <label class="wl-optin">
        <input type="checkbox" id="wl-optin" name="mailingListOptIn">
        <span>Keep me up to date with Some Voices news and future events.</span>
      </label>

      <button type="button" class="wl-submit" id="wl-submit">Proceed to payment</button>
      <div id="wl-form-error" class="wl-form-error" style="display:none;"></div>
    </form>
  </div>
</div>

<script src="https://js.stripe.com/v3/"></script>
<script>
(function() {
  const API_BASE = 'https://sv-ticket-scanner.vercel.app/api';
  const STRIPE_PUBLIC_KEY = 'pk_live_e3BY9meg9xi16XR7UQ211bv6';
  const stripe = Stripe(STRIPE_PUBLIC_KEY);

  const $loading = document.getElementById('wl-state-loading');
  const $error   = document.getElementById('wl-state-error');
  const $ready   = document.getElementById('wl-state-ready');

  function showError(msg) {
    $loading.style.display = 'none';
    $ready.style.display = 'none';
    $error.style.display = 'block';
    $error.textContent = msg;
  }

  function getToken() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('token') || '';
    // Strip BOM + zero-width characters — Airtable's rich-text email editor
    // injects U+FEFF around dragged blue pills when they're placed inside an
    // <a href="..."> attribute, which URL-encodes to %EF%BB%BF and breaks the
    // strict token match on the server.
    return raw.replace(/[​-‍﻿]/g, '').trim();
  }

  const token = getToken();
  if (!token) {
    showError('This page can only be reached from a waiting-list email.');
    return;
  }

  // Step 1 — validate the token + fetch event/customer details
  fetch(API_BASE + '/waiting-list/lookup/' + encodeURIComponent(token))
    .then(r => r.json().then(body => ({ status: r.status, body })))
    .then(({ status, body }) => {
      if (status !== 200 || !body.ok) {
        showError(body.error || 'This link is no longer valid.');
        return;
      }

      // Populate event details
      document.getElementById('wl-first-name').textContent = (body.customer.firstName || 'there').trim();
      // Strip the trailing parenthetical like " (Wednesday 22nd Jul 2026, 8:00pm)"
      // — the dateTime + venue are rendered separately just below, so the bare
      // event name reads cleaner here. Airtable's "Event Name" field includes
      // the date for use in emails / receipts where this context is needed.
      const cleanEventName = (body.event.name || 'Some Voices Event').replace(/\s*\([^)]*\)\s*$/, '').trim();
      document.getElementById('wl-event-name').textContent = cleanEventName;

      const metaParts = [];
      if (body.event.ticketTypePrice) metaParts.push(body.event.ticketTypePrice);
      if (body.event.dateTime) metaParts.push(body.event.dateTime);
      if (body.event.venueAddress) metaParts.push(body.event.venueAddress);
      document.getElementById('wl-event-meta').innerHTML = metaParts.map(escapeHtml).join('<br>');

      // The expiresAt from the lookup endpoint is ISO — format for display.
      // (The Airtable email script formats this too, but the page reads the
      // raw ISO field directly, so we format it here for the same effect.)
      document.getElementById('wl-expires-at').textContent = formatExpiry(body.expiresAt);

      // Prefill form
      setVal('wl-fn', body.customer.firstName);
      setVal('wl-sn', body.customer.surname);
      setVal('wl-em', body.customer.email);
      setVal('wl-ph', body.customer.phone);

      $loading.style.display = 'none';
      $ready.style.display = 'block';
    })
    .catch(err => {
      console.error('Lookup error:', err);
      showError('Could not load your invitation. Please try again or contact sing@somevoices.co.uk.');
    });

  // Step 2 — submit handler
  // We bind to the button's click directly (the button is type="button", so
  // there's no native form submit). This sidesteps Squarespace's tendency to
  // hijack <form> submit events from Code Block embeds.
  document.getElementById('wl-submit').addEventListener('click', async function(e) {
    e.preventDefault();
    const $submit = document.getElementById('wl-submit');
    const $err = document.getElementById('wl-form-error');
    $err.style.display = 'none';

    const payload = {
      token: token,
      firstName: document.getElementById('wl-fn').value.trim(),
      surname: document.getElementById('wl-sn').value.trim(),
      email: document.getElementById('wl-em').value.trim(),
      phone: document.getElementById('wl-ph').value.trim(),
      postcode: document.getElementById('wl-pc').value.trim(),
      mailingListOptIn: document.getElementById('wl-optin').checked
    };

    // Manual validation — we lost native HTML5 validation by dropping
    // type="submit". Show the first missing field inline.
    const missing = [];
    if (!payload.firstName) missing.push('First Name');
    if (!payload.surname) missing.push('Surname');
    if (!payload.email) missing.push('Email');
    if (!payload.phone) missing.push('Phone');
    if (!payload.postcode) missing.push('Postcode');
    if (missing.length) {
      $err.textContent = 'Please fill in: ' + missing.join(', ');
      $err.style.display = 'block';
      return;
    }
    if (!payload.email.includes('@')) {
      $err.textContent = 'Please enter a valid email address.';
      $err.style.display = 'block';
      return;
    }

    $submit.disabled = true;
    $submit.textContent = 'Redirecting to checkout…';

    try {
      const resp = await fetch(API_BASE + '/waiting-list/redeem-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok || !data.sessionId) {
        throw new Error(data.error || 'Could not start checkout');
      }
      const result = await stripe.redirectToCheckout({ sessionId: data.sessionId });
      if (result && result.error) throw new Error(result.error.message);
    } catch (err) {
      $err.textContent = err.message || 'Something went wrong. Please try again.';
      $err.style.display = 'block';
      $submit.disabled = false;
      $submit.textContent = 'Proceed to payment';
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────
  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatExpiry(iso) {
    if (!iso) return 'soon';
    try {
      const d = new Date(iso);
      const parts = new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Europe/London'
      }).formatToParts(d);
      const obj = {};
      for (const p of parts) obj[p.type] = p.value;
      const period = (obj.dayPeriod || '').toUpperCase().replace(/\s/g, '');
      return obj.weekday + ' ' + obj.day + ' ' + obj.month + ' ' + obj.year +
             ' at ' + obj.hour + ':' + obj.minute + ' ' + period + ' (UK time)';
    } catch (e) {
      return iso;
    }
  }
})();
</script>
