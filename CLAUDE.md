# SV Ticket Scanner - Claude Context

## Project Overview
Vercel-deployed ticketing system for Some Voices choir events. Handles ticket purchasing, Stripe payments, PDF ticket generation, and QR code check-in scanning.

**Vercel Project:** sv-ticket-scanner
**Airtable Base:** SV Ticketing Base

---

## Tech Stack
- **Backend:** Node.js serverless functions on Vercel
- **Frontend:** Vanilla HTML/JS (embedded on Squarespace)
- **Database:** Airtable (REST API)
- **Payments:** Stripe Checkout
- **PDF Generation:** jsPDF
- **QR Scanning:** html5-qrcode library

---

## File Structure

### API Routes (Vercel Serverless Functions)

| File | Purpose | Method | Timeout |
|------|---------|--------|---------|
| `get-events.js` | Fetch events from Airtable "Currently onsale" view | GET | 10s |
| `create-ticket-checkout.js` | Reserve tickets + create Stripe checkout session | POST | 15s |
| `stripe-ticket-webhook.js` | Handle Stripe webhook: create tickets on payment, release on expiry | POST | 15s |
| `generate-ticket.js` | Generate PDF ticket with QR code | POST | 30s |
| `serve-pdf.js` | Store + serve PDFs temporarily in memory | POST/GET | 10s |
| `check-ticket.js` | Validate ticket for scanning | POST | 10s |
| `checkin-ticket.js` | Mark ticket as checked in | POST | 10s |
| `tickets-by-session/[sessionId].js` | List ticket record IDs for a Stripe session (drives post-purchase success page) | GET | 10s |
| `wallet/apple/[ticketId].js` | Generate single-ticket Apple Wallet `.pkpass` | GET | 15s |
| `wallet/apple/all-by-session/[sessionId].js` | Generate `.pkpasses` bundle (all tickets for a session, one tap to add) | GET | 30s |
| `wallet/google/[ticketId].js` | Single-ticket Google Wallet — signs JWT, 302 redirects to Google save URL | GET | 15s |
| `wallet/google/all-by-session/[sessionId].js` | Bundle JWT containing all tickets for a session | GET | 15s |
| `waiting-list/join.js` | Add a customer to the per-event Waiting List (sold-out path) | POST | 10s |
| `waiting-list/lookup/[token].js` | Validate a redemption token + return event/customer details for the claim page | GET | 10s |
| `waiting-list/redeem-checkout.js` | Create Stripe Checkout reusing the held Reservation token (marks Waiting List `Converted` via webhook) | POST | 15s |

### Scripts (local-only, not deployed)

- `scripts/setup-google-pass-class.js` — one-time idempotent script that creates the Google Wallet Pass Class via the Wallet REST API. Run with the service account JSON file path as argument. Re-running prints "already exists".

### Frontend Files (Copy-paste into Squarespace)
- `FRONTEND - PUBLIC Event Selector 9th Feb '26.js` — Public ticket purchasing
- `FRONTEND - MEMBER Event Selector 9th Feb '26.js` — Member event selector
- `FRONTEND - PUBLIC Event Selector 9th June '26.js` — Public selector with sold-out "Join Waiting List" button (Phase 1)
- `FRONTEND - MEMBER Event Selector 9th June '26.js` — Member selector with sold-out "Join Waiting List" button (Phase 1)
- `FRONTEND - WAITING LIST REDEMPTION 19th June '26.js` — `/ticket-waiting-list?token=...` redemption claim page. **Files include a "PASTE FROM HERE" banner near the top** — copy from there down (the leading `//` doc comments are for the repo only; Squarespace renders them as visible text on the page).

### Scanner App
- `/index.html` — QR code scanning interface for door staff

---

## Environment Variables

```
AIRTABLE_BASE_ID                       # Ticketing base ID
AIRTABLE_API_KEY                       # Airtable personal access token
AIRTABLE_EVENT_TABLE_ID                # Event table ID
AIRTABLE_TABLE_ID                      # Tickets table ID
AIRTABLE_SEND_TICKETS_TABLE_ID         # Send Tickets automation table ID
STRIPE_TICKET_SECRET_KEY               # Stripe secret key (ticketing account — distinct from shared STRIPE_SECRET_KEY)
STRIPE_TICKET_WEBHOOK_SECRET           # Stripe webhook signing secret

# Apple Wallet
APPLE_PASS_CERT_PEM                    # Pass Type ID certificate (full PEM contents including bag attributes — leave as-is)
APPLE_PASS_KEY_PEM                     # Encrypted private key for the cert (PEM contents, SENSITIVE)
APPLE_PASS_WWDR_PEM                    # Apple WWDR intermediate cert (G4 version, public)
APPLE_PASS_KEY_PASSPHRASE              # Passphrase that decrypts APPLE_PASS_KEY_PEM (SENSITIVE)

# Google Wallet
GOOGLE_WALLET_ISSUER_ID                # Public issuer ID (19-digit number)
GOOGLE_WALLET_PASS_CLASS_ID            # <issuerId>.<class-suffix> (e.g. 3388…852.sv-event-ticket-v1)
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON     # Full contents of service-account.json (SENSITIVE — contains private key)
```

---

## Airtable Structure

### Event Table
**Key Fields:**
- `Event Name` — Primary identifier
- `Display Name` — Customer-facing name
- `Ticket Price` — Base price in GBP
- `Booking Fee` — Fixed fee per ticket
- `Stripe Price ID` — Stripe product price ID
- `Allocation` — Total tickets available
- `Tickets Sold` — Count of completed purchases
- `Reserved` — **Rollup:** SUM of `Quantity` from linked `Reservations` records where `Status = 'Active'`. Drives `Tickets Remaining`. (Originally created as `Reserved (live)` during the Reservations migration; renamed after the legacy integer field was deleted.)
- `Tickets Remaining` — **Formula:** `Allocation - {Tickets Sold} - Reserved`
- `Reservations` — Reverse-linked to Reservations table
- `Resv: Started` / `Resv: Completed` / `Resv: Abandoned` / `Resv: Failed` — Rollups (`COUNTA(values)`) filtered by Reservation Status. Used for funnel analytics.
- `Abandon Rate` — Formula: `IF({Resv: Started} = 0, BLANK(), {Resv: Abandoned} / {Resv: Started})`. Sortable column for spotting events with checkout friction.
- `Max Tickets Per Purchase` — Limit per checkout (typically 4-6)
- `Date + Time Friendly` — Formatted date/time
- `Venue Address` — Event location
- `Public or Member Event` — "Public" or "Member"
- `Free / Paid` — "Free" or "Paid"
- `Attendance Count` — Linked record to Attendance table

**View:** `Currently onsale` — filters to events available for purchase

### Tickets Table
**Fields Created by Webhook:**
- `Event Name` — Linked record to Event table
- `First Name`, `Surname`, `Email`, `Mobile Phone Number`, `Post Code`
- `Stripe Session ID` — Groups tickets from same checkout
- `Amount Paid` — Total paid in GBP
- `Stripe Fees` — Calculated per-ticket Stripe fee
- `Ticket Number` — "1 of 3" format
- `Status` — "Valid" or "Used"
- `Checked In` — Boolean (set by scanner)
- `Check-in Time` — ISO timestamp
- `Check-in By` — Scanner name

**Lookup Fields (from linked Event):**
- `Date Friendly`, `Doors + Performance Time`, `Venue Address`
- `Ticket Type + Price`, `Total Cost Ticket PDF`, `Booking Fee Ticket Message`
- `QR Code Image` — Pre-generated by Airtable automation
- `PDF Ticket` — Attachment (populated by generate-ticket.js)

**Formula Fields (for email body):**
- `Apple Wallet Button HTML` — HTML `<a><img></a>` markup linking to `/api/wallet/apple/{RECORD_ID}` with the Apple Wallet badge
- `Google Wallet Button HTML` — Same shape but linking to `/api/wallet/google/{RECORD_ID}`

### Reservations Table
**Purpose:** One row per cart-line per checkout. Tracks in-flight tickets via the `Status` field. The `Reserved` rollup on the Event table sums Quantity from rows where Status='Active'.

**Fields:**
- `Reservation ID` — Autonumber (primary)
- `Event` — Linked record → Event
- `Quantity` — Number of tickets in this row
- `Status` — Single select: `Active` (in-flight), `Fulfilled` (paid), `Released` (expired/rolled back), `Failed` (system error)
- `Stripe Session ID` — Filled in after Stripe session creation (best-effort, may be null on early failures)
- `Reservation Token` — UUIDv4 per cart, included in Stripe metadata so the webhook can find rows by `filterByFormula`. **This is the primary linker** — Stripe Session ID is only audit.
- `Source` — Single select: `Public` / `Member` (from frontend `source` field)
- `Email` — Attendee email captured at checkout start (useful for customer service / abandon analysis)
- `Released At` — Date+time, populated when Status flips to terminal
- `Released Reason` — Single select: `Completed`, `Expired`, `Rolled back`, `Failed checkout`, `Manual cleanup`
- `Created` — Created time (auto)

**Lifecycle:**
- Row created `Active` by `/api/create-ticket-checkout` when customer starts checkout
- Flipped to `Fulfilled` on Stripe `checkout.session.completed` webhook
- Flipped to `Released` on Stripe `checkout.session.expired` (30 min after creation if unpaid), or by rollback paths in the checkout endpoint (sold-out caught mid-flow, Airtable error, etc.)
- Flipped to `Failed` if the checkout endpoint throws after rows were created (e.g. Stripe API down)

**Why this design:** Status flips are idempotent — webhook retries can't drift a counter because there's no shared counter cell to read-modify-write. Replaces a previous integer `Reserved` field that had a race-condition leak.

### Waiting List Table
**Purpose:** Customers who tried to buy a sold-out ticket type can join a per-event-record queue. When admin marks a Ticket `Cancelled`, the topmost queued waitlister gets emailed a 24h time-limited buy link. The held seat is reserved via a Reservations row with `Source = Waiting List` while they consider it.

**Fields:**
- `Waiting List ID` (autonumber, primary)
- `Email`, `First Name`, `Surname`, `Phone`
- `Event` — Linked record → Event (specific ticket type, not just event name)
- `Quantity Wanted` (number) — what the customer asked for on the join form. **Always 1** (form forces it via hidden input). Each waitlister can now claim up to 3 at the redemption page (June 20, 2026) — see "Multi-ticket redemption" below.
- `Status` — single select: `Waiting`, `Notified`, `Converted`, `Expired`, `Removed`
- `Joined At` (created time) — drives queue order (oldest first)
- `Notified At` — when the redemption email was sent
- `Redemption Token` (text) — UUID used as `?token=...` in the email link
- `Token Expires At` (date+time) — 24h after `Notified At`
- `Converted Session ID` — Stripe Session ID once the waitlister completes their purchase
- `Reservations` — reverse-link from Reservations.`Waiting List Entry`

**Related Event-table field (added June 20, 2026):**
- `Target Allocation` (number) — admin types the new desired total Allocation here. The "Apply Target Allocation" automation atomically holds a seat for the next waitlister, bumps Allocation, and clears this field. See "Target Allocation" below.

**Related Reservations-table Source option (added June 20, 2026):**
- `Waiting List Hold` — placeholder Reservations created by the "Apply Target Allocation" script that hold a seat for the next waitlister before the Allocation increase becomes visible. Promoted to `Waiting List` once linked to a Waiting List Entry by the per-row "Promote from Hold" automation.

**Architecture:**
1. **Join** — Squarespace form (sold-out tickets only) POSTs to `/api/waiting-list/join` → creates a `Waiting` row.
2. **Cancellation trigger** — Airtable automation watches Ticket `Status` → `Cancelled`. Runs `~/Documents/Vercel/airtable-scripts/SV-Ticketing-Base - waiting-list-on-cancellation.js`. The script finds the next eligible waitlister, generates a redemption token + a separate cart-reservation token, creates a Reservations row with `Source=Waiting List` to hold the seat for 24h, and flips the Waiting List row to `Notified`. Outputs include `claimUrl` — a pre-built `/ticket-waiting-list?token=...` URL the email template uses as the **entire** `href` value (single blue pill, no plain-text/pill boundary inside the attribute — see "Airtable rich-text editor BOM injection" learning).
3. **Redemption page** — Squarespace `/ticket-waiting-list?token=...`. Calls `/api/waiting-list/lookup/[token]` → renders event details + prefilled form. POST to `/api/waiting-list/redeem-checkout` → creates Stripe Checkout session that **reuses** the existing Reservation's token in metadata (no new reservation row, no double-counting).
4. **Webhook completion** — `stripe-ticket-webhook.js` `.completed` handler runs its existing `markReservationsByToken(...Fulfilled)` (works because the cart token matches). If `metadata.waitingListRedemption === 'true'`, it also flips the Waiting List row to `Status=Converted` + sets `Converted Session ID`.
5. **Hourly expiry sweep** — Scheduled Airtable automation (hourly). Runs `~/Documents/Vercel/airtable-scripts/SV-Ticketing-Base - waiting-list-hourly-expiry-sweep.js`. Walks every `Notified` row, flips any whose `Token Expires At < NOW()` to `Status=Expired`. No emails, no per-row logic — bulk-mark only.
6. **On-expired re-notify** — Per-record Airtable automation triggered by Waiting List `Status` becoming `Expired`. Runs `~/Documents/Vercel/airtable-scripts/SV-Ticketing-Base - waiting-list-on-expired.js`. Releases the linked Reservation (`Status=Released` → seat back to public pool if nobody else takes it), finds the next eligible `Waiting` row for the same Event, creates a fresh Reservation + token + 24h expiry, marks them `Notified`, and emits the same outputs as the cancellation script so the same email template body can be reused without re-mapping blue pills. Why two automations (sweep + per-row) rather than one: Airtable's Send-email step is one email per automation run, so a burst of N expiries needs to fan out into N independent runs — the cron does the bulk mark; each per-row trigger does its own email.
7. **Apply Target Allocation** — Per-record Airtable automation triggered by Event `Target Allocation` field being updated. Runs `~/Documents/Vercel/airtable-scripts/SV-Ticketing-Base - waiting-list-apply-target-allocation.js`. Computes `delta = Target - current Allocation`; if positive AND at least one waitlister is queued for the event, creates ONE `Source = Waiting List Hold` Reservation (Q=1) BEFORE bumping `Allocation` to the target (atomicity protects the held seat from public sniping during the brief window). Clears `Target Allocation` afterwards. If no waitlister exists, just bumps Allocation. The single Hold triggers the per-row "Promote from Hold" automation next.
8. **Promote from Hold** — Per-record Airtable automation triggered by Reservation matching `Source = Waiting List Hold` AND `Status = Active`. Runs `~/Documents/Vercel/airtable-scripts/SV-Ticketing-Base - waiting-list-promote-from-hold.js`. Finds the next eligible `Waiting` row for the linked Event, converts the placeholder Reservation in-place (flips Source to `Waiting List`, sets Reservation Token, links the Waiting List Entry), generates a Redemption Token + 24h expiry on the Waiting List row, marks it Notified, and emits the same outputs as the cancellation script. If no waitlister exists (race condition), flips the placeholder to `Released` so the seat goes to public.

**Multi-ticket redemption (June 20, 2026):** The redemption page (`/ticket-waiting-list?token=...`) now shows a "There is/are N tickets available" message + a +/- quantity selector capped at 3. `availableTickets` is computed in `/api/waiting-list/lookup/[token]` as `min(3, holdQuantity + max(0, Tickets Remaining))` — i.e. their personal hold plus any public capacity, capped at the per-redemption ceiling. `/api/waiting-list/redeem-checkout` accepts a `quantity` POST param, re-validates against live `Tickets Remaining`, updates the Reservation's `Quantity` to the chosen value BEFORE creating Stripe Checkout (atomic seat-hold against public sniping during the 30-min Stripe session), and scales the Stripe line items + `ticketsData` metadata by the chosen quantity. The webhook then creates N Ticket records via the existing `ticketsData` metadata flow used by public buys.

**Notify-only-#1 model (June 20, 2026):** The Apply Target Allocation script deliberately creates ONE Hold regardless of `delta` — only the top-of-queue waitlister is notified per Allocation increase. The remaining `delta - 1` seats go to public. The trade-off: if WL#1 only claims part of what they could (e.g. 1 of 3 available), the unclaimed seats go to public rather than cascading down the queue. The alternative — a full "Pool" pattern with cascading promotion until queue empty — was scoped (single `Source = "Waiting List Pool"` Reservation with `Q = delta`, with restoration logic in `on-expired` and `redeem-checkout`) but deferred. For typical 3-4-per-event-life Allocation changes with small deltas, the leftover-to-public outcome is acceptable. Upgrading later is a script-only change — no schema migration. See doc comment in `waiting-list-apply-target-allocation.js`.

**Phase 2C hardening — Airtable BOM defenses + cosmetic stripping (June 19, 2026):**

Three layers of defense against Airtable rich-text editor BOM (`U+FEFF`) and zero-width character contamination when blue pills are dragged into `<a href="..."` attributes (URL-encoded as `%EF%BB%BF`, breaks strict token match):

1. **Squarespace page** (`FRONTEND - WAITING LIST REDEMPTION...js`) — `getToken()` strips `[﻿​-‍⁠]` (BOM + ZWSP/ZWNJ/ZWJ + word joiner) from `?token=...` immediately after reading
2. **`/api/waiting-list/lookup/[token].js`** — same regex applied to incoming `token` query param before the Airtable `filterByFormula` lookup
3. **`/api/waiting-list/redeem-checkout.js`** — same regex applied to `token` in POST body before lookup AND before passing through to Stripe metadata

The **source fix** is the `claimUrl` output on the script (step 2 above) — when the entire `href` value is a single blue pill with no surrounding plain text, Airtable's editor has no boundary to wrap with BOMs. The three strip layers are belt-and-braces for any future template that goes wrong.

**Phase 3 — multi-ticket support (partially shipped June 20, 2026):**

Each waitlister can now claim **up to 3 tickets** at the redemption page (see "Multi-ticket redemption" above). The join form still forces `Quantity Wanted = 1` because the value tracks "what they asked for at join time" rather than what they end up claiming — the cap-of-3 lives on the redemption page itself, not in the queue metadata.

Open future work (not yet built):
- Track cumulative cancelled-but-not-yet-redeemed tickets per event so multiple cancellations within a 24h window can be offered atomically to one waitlister
- Allow waitlisters to specify desired quantity at join time (currently always 1; the redemption page lets them up to 3 regardless)
- Full "Pool" cascade for Allocation increases (currently leftover beyond what WL#1 claims goes to public; see "Notify-only-#1 model" note above)

### Send Tickets Table
- `Stripe Session ID` — Groups tickets for email automation
- Airtable automation triggers on record creation to send ticket emails

### Attendance Table
**Purpose:** Live aggregate view of event data. Rollups read straight from linked Event records (and through them, from linked Tickets) — values refresh whenever underlying data changes.
- `*Events` — Linked record(s) to Event table. For multi-date runs (e.g. a 3-night concert with one Event row per date) all dates link to a single Attendance row.
- `Event Name Rollup` — Rollup of linked event names; used by the Step 1 automation to detect existing Attendance rows
- `Date + Time` — Rollup of event dates (ARRAYUNIQUE aggregation)
- Live rollup fields: `Allocation`, `Tickets Sold`, `Sold %age`, `Gross Income`, `Stripe Fees`, `Net Income`, `Checked In`, `Attendance %age`, `Washout`
- `On / Off Sale` — Single select; flipped to `"Event Complete"` after the event has fully ended (triggers the Step 2 snapshot automation)

### Attendance & Revenue Totals Table
**Purpose:** Frozen historical snapshot. Each row is one event's final numbers, captured at the moment the Attendance row's `On / Off Sale` flips to `"Event Complete"`. Values are stored as plain text / number fields (not rollups) so they survive any future cleanup of Tickets or Events.

**Fields** (all populated by the Step 2 script):
- `Name` (text, primary) — copied from Attendance `Name`; used as the upsert key so re-runs update the same row rather than duplicating
- `Date + Time` (text) — pre-formatted UK-locale string like `2/6/2026 7:30pm` (the script's `formatDateTime` helper)
- `Location`, `Show`, `Term` (text)
- `Allocation`, `Tickets Sold`, `Sold %age`, `Gross Income`, `Stripe Fees`, `Net Income`, `Checked In`, `Attendance %age`, `Washout` (number — frozen)

**Always read historical totals from this table, never from `Attendance`** — the Attendance rollups would zero out if old Tickets are ever deleted.

### Two-step Airtable automation chain

Both scripts live in `~/Documents/Vercel/airtable-scripts/` (version-controlled outside the sv-ticket-scanner repo since they run inside Airtable, not Vercel):

**Step 1 — `ticketing-attendance-and-revenue-step1-data-capture.js`**
Trigger: Event record reaches its `Date + Time` (or a scheduled check).
What it does:
1. Finds ALL Event records sharing the same `Event Name`
2. Aborts if any of those still have a future `Date + Time` (the whole multi-night run must be complete)
3. Creates a new Attendance row OR updates the existing one matched by `Event Name Rollup`, linking all matching Events via `*Events`

So a 3-night run produces one Attendance row whose rollups sum across all three dates. Matching is exact string equality on `Event Name` — names must be consistent (trailing spaces, suffixes etc. create new rows).

**Step 2 — `ticketing-attendance-and-revenue-step2-totals.js`**
Trigger: Attendance record where `{On / Off Sale} = "Event Complete"`.
What it does:
1. Reads the Attendance row by ID
2. Coerces each field to its target type (numbers via `coerceNumber`, dates via `formatDateTime`, everything else as text)
3. Finds an existing Attendance & Revenue Totals row by `Name`, or creates one
4. PATCHes the snapshot fields one at a time (so a single failing field doesn't lose the others, and the failing field name shows up in the logs)

Re-runnable: subsequent fires update the same Totals row rather than duplicating.

---

## Reservation System (Overselling Prevention)

### Problem
Concurrent checkouts could both read "5 remaining" and sell 10 tickets total. Previous implementation used a single integer `Reserved` field on the Event table with read-modify-write increments/decrements — that pattern leaked under concurrency because Airtable has no atomic increment, so concurrent webhook decrements lost updates.

### Solution: Reservations table + idempotent status flips

Each in-flight checkout creates one row per cart line in the `Reservations` table (Status=Active). The Event table's `Reserved` rollup sums those Active rows' Quantity. Webhooks flip Status to terminal states by Reservation Token — no shared counter to race on.

**Checkout creation** (`api/create-ticket-checkout.js`):
1. Read `Tickets Remaining` — reject if insufficient
2. Create `Reservations` row with `Status=Active`, `Reservation Token=<UUIDv4>`, `Source`, `Email`
3. Re-read `Tickets Remaining` (rollup recomputes within seconds) — if negative, mark row Released and reject
4. Embed `reservationToken` in Stripe session metadata
5. Create Stripe checkout session (expires in 30 minutes)
6. Best-effort PATCH `Stripe Session ID` onto the row (audit only; webhook finds rows by Token regardless)

**Webhook handling** (`api/stripe-ticket-webhook.js`):
- `checkout.session.completed` → flip Reservations rows to `Status=Fulfilled`, `Reason=Completed`. Tickets now counted in `Tickets Sold`.
- `checkout.session.expired` → flip to `Status=Released`, `Reason=Expired`. Rollup automatically reflects the released capacity.

Both flips look up rows via `filterByFormula({Reservation Token} = '<token>')`. Status flips are idempotent — Stripe webhook retries flip the same row to the same status, no drift.

### Free ticket path
- If `totalCost === 0`, skip Stripe entirely
- Create ticket records directly in `create-ticket-checkout.js`
- Mark Reservations rows as `Fulfilled` / `Completed` inline (no webhook to fire)

### Customer Error Messages
- `"Sorry, {event} is sold out."` — No remaining tickets
- `"Only X ticket(s) remaining. You requested Y."` — Insufficient stock
- `"Sorry, {event} just sold out. Please try again."` — Race condition rollback

---

## Wallet Passes (Apple + Google)

Customers can add their tickets to Apple Wallet or Google Wallet directly from the post-purchase email and the `/ticket-success` Squarespace page. The QR code on each wallet pass matches what the existing scanner reads — no scanner changes were needed.

### Two surfaces per platform

- **Per-ticket endpoint** (`/api/wallet/{apple|google}/[ticketId]`) — generates ONE pass for one Tickets record. Used in the email body so a buyer can forward individual links to family members.
- **Bundle endpoint** (`/api/wallet/{apple|google}/all-by-session/[sessionId]`) — generates passes for ALL Tickets matching a Stripe Session ID. Used on the success page so a single button adds every ticket the customer just bought. Apple bundles as `.pkpasses` (zipped pkpass files); Google packs multiple `eventTicketObjects` into one signed JWT.

### Apple Wallet

**Pass Type ID:** `pass.sv-ticketing` (registered in Apple Developer portal)
**Team ID:** `8Z2X5D3476`
**Template:** `lib/wallet/apple-template.pass/` — pass.json + 6 PNG variants (logo/icon at 1x/2x/3x). Bundled with both endpoints via `vercel.json` `includeFiles` glob.
**Signing:** `passkit-generator` npm package + the four `APPLE_PASS_*` env vars (cert, key, WWDR intermediate, key passphrase).
**Cert expiry:** Apple Pass Type ID certs expire after **1 year**. Renew via Apple Developer portal → Identifiers → Pass Type IDs → click the cert → Renew. New cert PEM goes into `APPLE_PASS_CERT_PEM`. Already-signed passes on customer devices keep working; only newly-generated passes are affected.
**Layout reference:** `pass.json` defines colours (`#f4dbc0` background, black text/labels) and branding. The dynamic field placement (DATE in header, EVENT in primary, NAME/TICKET in secondary, DOORS in auxiliary, venue/ticket type/admission on the back) is set in code in each endpoint's `pass.headerFields.push(...)` etc. calls.
**Bundle behaviour:** single-ticket sessions short-circuit to a plain `.pkpass` even on the bundle endpoint — iOS only renders `.pkpasses` when there's actually more than one pass inside.

### Google Wallet

**Issuer ID:** `3388000000023146852` (Some Voices)
**Pass Class ID:** `3388000000023146852.sv-event-ticket-v1` — one generic Event Ticket class for all events. Event-specific details (event name, date, doors, venue) go on each Pass Object via `textModulesData` rather than on the class.
**Signing:** `jsonwebtoken` npm package + the service account's `private_key` from `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`. Signs the JWT inline at request time; no Google API call needed at runtime.
**Pass Class creation:** `scripts/setup-google-pass-class.js` (one-time, idempotent). Run locally with the service account JSON path. Sample: `node scripts/setup-google-pass-class.js ~/Documents/Vercel/sv-wallet/google-wallet-service-account.json`.
**Save URL pattern:** `https://pay.google.com/gp/v/save/<signed-JWT>`. The endpoint 302-redirects there.
**Production status (as of 2026-05-22):** Issuer is production-approved and the `sv-event-ticket-v1` Pass Class is in `APPROVED` review status. Any Google account can save passes — no whitelist required. (For reference: new issuers start in demo mode where only whitelisted test users can save; production access is a separate Google review of ~1-2 weeks.)

### Customer experience

**Email** (sent by Airtable automation on Send Tickets row creation):
- Body formula references `{Apple Wallet Buttons HTML}` and `{Google Wallet Buttons HTML}` — rollups on Send Tickets that join each linked Ticket's per-row button HTML formula via `ARRAYJOIN(values, "")`. Renders one Apple + one Google button per ticket so the buyer can share individual links if needed.

**Ticket success page** (Squarespace code block at `/ticket-success`):
- Reads `session_id` from URL, polls `/api/tickets-by-session/[sessionId]` until tickets exist (up to ~15s — accounts for Stripe webhook latency)
- Renders ONE pair of buttons (Apple + Google) that link to the bundle endpoints. Adding all tickets is a single tap.

### Why URLs aren't authenticated

Both `recXXX` ticket IDs and Stripe Session IDs are unguessable random strings. The same security model as the existing PDF email link — possession of the URL grants the ability to add the pass, but the QR code is single-use at the door. First scan wins; second scan rejected. No worse than the PDF system.

### Static asset URLs (served from repo root)

- `https://sv-ticket-scanner.vercel.app/add-to-apple-wallet.png` — official Apple badge for email/success page
- `https://sv-ticket-scanner.vercel.app/add-to-google-wallet.png` — official Google badge
- `https://sv-ticket-scanner.vercel.app/some-voices-logo-square.png` — referenced by the Google Pass Class

---

## Stripe Integration

### Stripe Account (CRITICAL)
**Ticketing uses a SEPARATE Stripe account from the rest of Some Voices.** Other Vercel projects (choir dashboard, billing, etc.) read a shared `STRIPE_SECRET_KEY` env var pointing to the main Some Voices Stripe account. Ticketing must NOT read that variable — it has its own:

- Backend secret: `STRIPE_TICKET_SECRET_KEY` (project-level on Vercel, ticketing account `sk_live_...`)
- Webhook secret: `STRIPE_TICKET_WEBHOOK_SECRET`
- Frontend publishable: `pk_live_e3BY9meg9xi16XR7UQ211bv6` (hardcoded in both `FRONTEND - *.js` files)

The shared `STRIPE_SECRET_KEY` is **unlinked** from the `sv-ticket-scanner` Vercel project. If you re-add it accidentally, it has no effect — code reads `STRIPE_TICKET_SECRET_KEY` only.

### Checkout Session Config
- `mode: 'payment'`
- `expires_at: now + 30 minutes` (Stripe minimum)
- `allow_promotion_codes: true` — Discount codes managed in Stripe Dashboard
- `payment_method_types: ['card']`
- Custom text: "We're holding these tickets for 10 minutes..."
- Metadata: customer details, ticketsData JSON, `reservationToken` (UUIDv4 linking to Reservations rows)
- `cancel_url` is **routed by `req.body.source`** — `'public'` → `/ticket-incomplete`, `'member'` → `/member-ticket-incomplete`. Defaults to public if missing. Each Squarespace embed sets its own `source` value in `formData`.

### Webhook Events (same endpoint)
- `checkout.session.completed` — Create ticket records, flip Reservations rows to `Fulfilled`
- `checkout.session.expired` — Flip Reservations rows to `Released` (only)

### Webhook Idempotency
Both event handlers are safe to retry. Stripe redelivers webhooks for up to 3 days if the endpoint times out or returns 5xx.

**`.completed` handler:** at the top, looks up existing Tickets by `Stripe Session ID`. If any exist, the prior run succeeded — skip all creation (no duplicate tickets, no duplicate email automation) and flip Reservations rows to Fulfilled (idempotent). Also checks Send Tickets table for the partial-failure case where Send Tickets was created but ticket creation crashed mid-Promise.all — on retry, skips Send Tickets re-creation but creates the missing tickets.

**`.expired` handler:** flips Reservations rows to Released via Reservation Token. Status PATCH is a no-op on retry.

**Known edge case:** if `Promise.all` for ticket creation partially succeeds (say 2 of 3) before throwing, the retry will see "tickets exist" and skip — leaving the customer 1 short. Visible in Vercel logs as the original error that triggered the retry. Recover manually in Airtable when it happens. Has not been observed in practice.

### Webhook Signature Verification
**CRITICAL:** Uses raw body (not parsed JSON) for `stripe.webhooks.constructEvent()`.
The `vercel.json` does NOT set `bodyParser: false` — the webhook handler reads the raw body manually.

### Stripe Fee Calculation
- Total fee split evenly across tickets: `total_fee ÷ num_tickets`
- Remainder added to first ticket to avoid rounding loss

---

## Data Flows

### Purchase Flow
```
Frontend → POST /api/create-ticket-checkout
  ├─ Validate fields
  ├─ Generate reservationToken (UUIDv4)
  ├─ Per cart line: create Reservations row (Status=Active, token, email, source)
  ├─ Re-read Tickets Remaining (race guard via Reserved rollup)
  ├─ Create Stripe checkout session (token in metadata)
  ├─ Best-effort PATCH Stripe Session ID onto rows (audit)
  └─ Return sessionId

User → Stripe checkout page (30 min expiry)

Stripe → POST /api/stripe-ticket-webhook
  ├─ checkout.session.completed:
  │   ├─ Create Send Tickets record (triggers email automation)
  │   ├─ Create Ticket records (one per ticket)
  │   ├─ markReservationsByToken(token, 'Fulfilled', 'Completed')
  │   └─ Return 200
  ├─ checkout.session.expired:
  │   ├─ markReservationsByToken(token, 'Released', 'Expired')
  │   └─ Return 200

Airtable Automation → Generate PDF → Email to attendee
```

### Free Ticket Flow
- If `totalCost === 0`, skip Stripe entirely
- Reservations rows are still created (Status=Active) for the rollup to count
- After tickets are created, rows are flipped to `Fulfilled` / `Completed` inline
- Redirect to success page (no webhook involved)

### Check-in Flow
```
Door staff → /index.html → Scan QR code
  → POST /api/check-ticket (validate ticket + event match)
  → POST /api/checkin-ticket (mark as checked in)
```

---

## Frontend Deployment

The two `FRONTEND - *.js` files are **standalone HTML/JS** that get copy-pasted into Squarespace code blocks. They are NOT auto-deployed — any changes require manually updating the Squarespace embeds.

**Features:**
- Show selector → Date/time selector → Ticket type quantity selector
- Booking fee calculated and displayed
- Companion ticket option (free, for accessibility)
- Max 4 regular tickets per purchase
- Sticky price bar at bottom
- Email confirmation field (must match)
- Phone format validation (+44 7xxx)
- Postcode validation (UK format)
- SOLD OUT display when `ticketsRemaining <= 0`
- Error recovery: re-fetches events on checkout failure

---

## PDF Ticket Generation

`generate-ticket.js` creates PDF tickets with:
- Some Voices logo (top left)
- Event date (top right)
- Event name, venue (clickable Google Maps link), timings
- Ticket type + price, booking fee, total cost
- Customer name, ticket number ("1 of 3")
- QR code (centered, from Airtable field)
- Admission instructions (branded box)

**Temporary storage:** PDFs held in memory for 5 minutes via `serve-pdf.js`, then auto-deleted.

**Brand colours:** Beige `#f4dbc0`, Red `#ea3e28`, Dark text `#333`

---

## Scanner App (`/index.html`)

- Login with scanner name + password
- Select event from dropdown
- Scan QR codes with device camera
- Validates: correct event, not already checked in
- Records: check-in time, scanner name
- Shows running stats (total scanned, duplicates, errors)

---

## Important Gotchas

### Reservations rows can get stuck Active
If a webhook fails to fire (Stripe outage, Vercel timeout, signature secret mismatch), the corresponding Reservations row stays `Status=Active` and inflates `Reserved` permanently. Stripe retries webhooks for up to 3 days, so most stuck rows self-heal. For ones that don't:

Filter the Reservations table by `Status = 'Active' AND Created < now - 35 minutes`. Should always be empty. If anything appears, flip Status to `Released` and Released Reason to `Manual cleanup` by hand. Takes seconds at this volume.

If stuck rows become a regular occurrence, add a Vercel cron that runs the same filter and PATCH on a schedule (deferred — not worth the complexity at current volume).

### Frontend files are NOT auto-deployed
Changes to the FRONTEND JS files must be manually copy-pasted into Squarespace. Git push only deploys the API routes.

### CORS is permissive
All API routes return `Access-Control-Allow-Origin: *` because the frontend is embedded on external sites.

### Free events bypass Stripe entirely
No webhook fires for free tickets — records created directly in the checkout API.

### Companion tickets
Always £0, created as separate ticket record with no ticket number. Only offered for accessible events.

### Apple Wallet cert renews yearly
Apple Pass Type ID certificates expire **1 year after issue**. After expiry, the wallet endpoint will 500 on every request until the cert is renewed. Already-issued passes on customer devices continue working — only newly-generated passes break. Renewal is ~30 min in the Apple Developer portal: create new CSR in Keychain, upload, download .cer, re-export .p12, convert PEM, update `APPLE_PASS_CERT_PEM` / `APPLE_PASS_KEY_PEM` / `APPLE_PASS_KEY_PASSPHRASE` in Vercel. **Set a calendar reminder.**

### Google Wallet — currently production-approved
The Some Voices issuer (`3388000000023146852`) and the `sv-event-ticket-v1` Pass Class are both in production. Any Google account can save passes today. (If you ever create a new Pass Class or a new issuer, expect demo-mode restrictions until Google reviews and approves — typically ~1-2 weeks.)

### Wallet URLs aren't authenticated
The `/api/wallet/{apple|google}/[ticketId]` and `/api/wallet/{apple|google}/all-by-session/[sessionId]` endpoints have no auth — anyone with the URL can generate a pass. Record IDs and Stripe Session IDs are random/unguessable so they're effectively private, but they're not signed. Same security profile as the existing PDF email links. Single-use QR at the door is the real defense.

---

## Git Workflow
- **Main Branch:** `main`
- **Deployment:** Automatic via Vercel on push to main (API routes only)
- **Frontend:** Manual copy-paste to Squarespace after changes

---

## Never Do This
- Remove raw body handling from webhook — Stripe signature verification will break
- Add a second writer that mutates `Reserved` directly — it's a rollup, not a counter; the only valid way to change it is to add/edit/delete Reservations rows
- Replace status flips with row deletion on the webhook — flips are idempotent (Stripe retries safe), deletes aren't (a retry would error on missing rows)
- Use `=== 0` for sold out checks — use `<= 0` (reservations can cause negative remaining)
- Forget to update Squarespace embeds after frontend JS changes
- Delete ticket records before running the Attendance archival automation
- **Read `process.env.STRIPE_SECRET_KEY`** — ticketing uses its own account; use `STRIPE_TICKET_SECRET_KEY`. The shared key would create sessions in the wrong Stripe account, causing 404s on `/payment_pages/{id}/init`.
- **Commit credentials** (`.p12`, PEM files, service account JSON, `.env*`) — `.gitignore` blocks the obvious patterns but always double-check `git status` before adding broadly. The Apple key + passphrase or Google service account key in a public repo would let anyone sign passes as Some Voices.
- **Modify the Google Wallet Pass Class via the Console UI** after it's been used — re-create as `-v2` instead. Class fields change behaviour for all in-the-wild passes referencing that class.

## Always Do This
- Check `Tickets Remaining <= 0` (not `=== 0`) for sold out state
- Flip Reservations row status in BOTH webhook paths (`.completed` → Fulfilled, `.expired` → Released)
- Pass `reservationToken` through Stripe metadata — webhook looks rows up by token, not by Stripe Session ID
- Re-read `Tickets Remaining` after creating a Reservations row to catch race conditions
- Use `getFieldValue()` helper for Airtable lookup fields (they return arrays)
- Test webhook locally with Stripe CLI before deploying changes
- Encode the Airtable **ticket record ID** as the wallet pass QR — the existing scanner reads exactly that. Anything else and the scanner won't find the ticket.
- Mark `APPLE_PASS_KEY_PEM`, `APPLE_PASS_KEY_PASSPHRASE`, and `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` as **Sensitive** in Vercel env-var settings.

---

## Session Log: May 8, 2026

### Stripe Account Isolation
**Incident:** Customers reported "can't connect to Stripe" — Stripe Checkout returning 404 on `/v1/payment_pages/{sessionId}/init`. Root cause: the shared team-level `STRIPE_SECRET_KEY` env var on Vercel was rotated for the main Some Voices account, but ticketing uses a *different* Stripe account. Sessions were being created in the main account, then loaded with the ticketing account's `pk_live_e3BY9meg9xi16XR7UQ211bv6` → 404.

**Fix:** Renamed env var to `STRIPE_TICKET_SECRET_KEY` (project-specific) so the shared key rotation can never silently break ticketing again. Two-line change in `api/create-ticket-checkout.js` and `api/stripe-ticket-webhook.js`. Shared `STRIPE_SECRET_KEY` was unlinked from the project on Vercel.

**Diagnosis tip for future:** If checkout 404s on `/init`, search for the session ID in Stripe Dashboard. If it doesn't appear in any of your accounts, the secret key on Vercel and publishable key on the frontend are from different Stripe accounts.

### Cancel URL Routing by Source
Added `source` field to checkout request body. PUBLIC frontend sends `source: 'public'`, MEMBER sends `source: 'member'`. Backend maps to `/ticket-incomplete` and `/member-ticket-incomplete` respectively.

**Files:**
- `api/create-ticket-checkout.js` — `CANCEL_URLS` lookup map; `cancel_url` is dynamic
- `FRONTEND - PUBLIC ...js` — `source: 'public'` in formData
- `FRONTEND - MEMBER ...js` — `source: 'member'` in formData

Defaults to public if `source` is missing — backward compatible if either Squarespace embed isn't updated.

---

## Session Log: May 15–16, 2026

### Reservations table migration (fix for climbing Reserved leak)

**Incident:** On one event, the `Reserved` integer field on the Event table had climbed to 60+ despite only 14 completed + 1 expired Stripe webhook firing that day. Customers were being told "sold out" while real capacity was available. Two root causes:

1. `rollbackReservations()` in `api/create-ticket-checkout.js` was overwriting `Reserved` with a captured "previousReserved" snapshot instead of decrementing by quantity. Under concurrent traffic, this clobbered concurrent webhook decrements.
2. Both increment (checkout) and decrement (webhook) did a read-modify-write on the single `Reserved` cell. Airtable has no atomic increment — concurrent decrements both read the same starting value and both wrote their result, losing one of the updates. Compounded over time, Reserved drifted upward.

**Fix:** Removed the shared counter entirely. New `Reservations` Airtable table stores one row per cart-line per checkout. `Reserved (live)` rollup on Event sums `Quantity` from rows where `Status='Active'`. Webhooks flip Status to `Fulfilled` / `Released` by Reservation Token — idempotent under Stripe retries because there's no shared cell to read-modify-write.

**Rolled out in 4 staged phases:**
1. Schema only (manual): new Reservations table, rollup field on Event, no formula change yet
2. Dual-write deploy (`484e518`): code wrote to both new table AND old Reserved field for 24h, verified they stayed in sync across real transactions
3. Formula switch (manual): `Tickets Remaining` changed from `Allocation - Tickets Sold - Reserved` to `Allocation - Tickets Sold - {Reserved (live)}`
4. Single-write deploy (`a38d68e`): removed all writes to the legacy `Reserved` integer field. Legacy field now frozen, ignored by everything, will be deleted in Phase 5 (~1 week buffer for any edge cases).

Considered and rejected: Vercel-cron reconciliation that recomputes Reserved by listing open Stripe sessions. It would self-heal, but adds a second writer racing the webhook on the same counter cell — same class of bug, just bounded. Also contradicts the (now removed) "Set Reserved from multiple systems" warning.

**Analytics added:** `Resv: Started / Completed / Abandoned / Failed` rollups on Event table, plus `Abandon Rate` formula. Sortable column for spotting events with checkout friction.

**Files:**
- `api/create-ticket-checkout.js` — replaced reservation loop with row creation + per-cart UUID token; replaced rollback helper with status flip
- `api/stripe-ticket-webhook.js` — added `markReservationsByToken`; removed `releaseReservation`
- `lib`: none (no shared lib in this repo, all helpers inlined per file)

**Diagnosis tip for future:** If `Reserved` is rising and not coming down, check Vercel logs for the webhook function — `markReservationsByToken` is the only path that releases rows. Filter Reservations by `Status=Active AND Created < now - 35 min` to spot stuck rows directly.

### Webhook idempotency (commit `158e90b`)

Followed up the Reservations migration with a related correctness fix: the `.completed` handler in `api/stripe-ticket-webhook.js` was not idempotent. If Stripe redelivered the event (timeout, transient 5xx, etc.), the handler would create a duplicate Send Tickets row (re-firing the email automation) and a duplicate set of Tickets.

**Fix:** added `fetchRecordsBySessionId(tableId, sessionId)` helper that filters via `{Stripe Session ID} = '<id>'`. At the top of the `.completed` handler:
- If Tickets exist for this Session ID → skip everything, flip Reservations to Fulfilled, return 200
- If only Send Tickets exists (partial-failure case) → skip Send Tickets re-creation but proceed with ticket creation

The Reservations side was already idempotent from the prior migration (status flips are no-ops on retry). This commit makes the ticket creation side robust too. Adds two Airtable reads at the top of the handler — cheap compared to the bug it prevents.

**Known limit:** if `Promise.all` for ticket creation partially succeeds before throwing, the retry will see "tickets exist" and skip the missing ones. Visible in logs, recoverable manually. Not yet observed in practice.

---

## Session Log: June 3, 2026

### Reservations migration — Phase 5 cleanup complete

Three weeks of clean operation after Phase 4 (single-write deploy on May 16) and no anomalies observed, so the final cleanup landed:

- Legacy `Reserved` integer field on Event table **deleted** in Airtable
- `Reserved (live)` rollup **renamed** to `Reserved`
- `Tickets Remaining` formula auto-updated to `Allocation - {Tickets Sold} - Reserved` (Airtable tracks fields by ID, so the rename propagated automatically)
- All current-state mentions of `Reserved (live)` in CLAUDE.md and `api/create-ticket-checkout.js` comments updated to `Reserved`
- Session-log narrative entries from May 15–16 deliberately left referring to `Reserved (live)` — that's accurate history of what the field was called during the migration

No code or behaviour changed — the rollup that drives `Tickets Remaining` is the same field, just now under its final name. Nothing to test in production.

The Reservations migration arc that started May 14 (planning), went through dual-write May 15–16, formula switch + single-write May 16, and bedded in for three weeks before this final cleanup, is now fully closed.

---

## Session Log: May 18–22, 2026

### Apple + Google Wallet implementation

Customers can now add their tickets to Apple Wallet or Google Wallet via buttons in the post-purchase email and on the `/ticket-success` Squarespace page. Same QR code as the existing PDF — no scanner changes required.

**Apple Wallet (commit `01846ef`):**
- New endpoint `/api/wallet/apple/[ticketId]` using `passkit-generator` ^3.5.7
- Pass Type ID `pass.sv-ticketing`, Team ID `8Z2X5D3476`
- Template directory `lib/wallet/apple-template.pass/` bundled with the function via `vercel.json` `includeFiles` (Apple requires the directory to end with `.pass` — see commit `535eb27`)
- Four env vars: `APPLE_PASS_CERT_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_PASS_WWDR_PEM`, `APPLE_PASS_KEY_PASSPHRASE`. Cert renews yearly — calendar reminder essential.
- Removed `logoText: "Some Voices"` from `pass.json` (commit `97b2b21`) because the brand logo image already says it.

**Google Wallet (commit `d0c251a`):**
- New endpoint `/api/wallet/google/[ticketId]` using `jsonwebtoken` ^9.0.3 to sign the save-to-wallet JWT
- Issuer `3388000000023146852`, generic Pass Class `3388000000023146852.sv-event-ticket-v1`
- Per-ticket event details (name, date, doors, venue) on the Pass Object via `textModulesData` — keeps us at one Pass Class for all events
- Pass Class created via `scripts/setup-google-pass-class.js` (one-time, idempotent)
- Three env vars: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_PASS_CLASS_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`

**Bundle endpoints (commit `8469117`):**
- `/api/wallet/apple/all-by-session/[sessionId]` packs multiple `.pkpass` files into a `.pkpasses` ZIP (or short-circuits to a single pkpass if only one ticket)
- `/api/wallet/google/all-by-session/[sessionId]` puts multiple `eventTicketObjects` in one signed JWT
- Both are looked up by Stripe Session ID. Used on the success page so one tap adds all tickets the customer just bought.

**Supporting changes:**
- `/api/tickets-by-session/[sessionId]` (commit `8fcfe93`) returns the ticket record IDs for a Stripe session — drives the success page polling that waits for the webhook to finish creating tickets before rendering buttons
- Static badge images served from repo root: `add-to-apple-wallet.png`, `add-to-google-wallet.png`, `some-voices-logo-square.png`
- `.gitignore` hardened (commit `8f3043a`) to block credentials (`*.p12`, `*.pem`, `*service-account*.json`, `.env*`) from accidental commits
- Tickets table got two new formula fields (`Apple Wallet Button HTML`, `Google Wallet Button HTML`) which roll up on Send Tickets table (`Apple Wallet Buttons HTML`, `Google Wallet Buttons HTML`) via `ARRAYJOIN(values, "")`. Send Tickets email-body formula references both rollups so buyers get per-ticket buttons they can forward to family members.

**Customer experience:**
- Email: one Apple + one Google button per ticket (per-ticket = easy to forward)
- Success page: one Apple + one Google button per session (bundle = single tap for everything)
- iOS users tap Apple, Android users tap Google. Per-platform branding compliance via Apple's and Google's official badge images.

**Architectural choice — why the URL contains the ticket record ID, not an HMAC signature:** record IDs are unguessable (17 random chars) and the QR is single-use at the door. Same security model as the existing PDF email links. Adding HMAC would be belt-and-braces with no real protection improvement at this volume.

**Known follow-ups:**
- Apple cert renewal in ~1 year — set calendar reminder
- Google production access **approved on 2026-05-22** — Pass Class status is `APPROVED`, any Android customer can save passes immediately

---

## Session Log: June 19, 2026

### Waiting List Phase 2C — fully shipped + automated end-to-end

Whole-day push to close Phase 2C. Cancellation → email → claim → checkout was already working. Today added the polish, hardened the token plumbing, and built the self-healing expiry loop so the system runs without human intervention.

#### Squarespace redemption page (`FRONTEND - WAITING LIST REDEMPTION 19th June '26.js`)

Saved the page into the repo as a versioned file alongside the Event Selectors. Three visible iterations during the session:

- Greeting changed to "Hi {firstName} — a ticket has just become available." (was "opened up for you")
- Event details box font +1 step (16 → 18 px body, 20 → 22 px event name)
- Expiry text font +2 steps (14 → 18 px)
- Card nudged 30 px right via `transform: translateX(30px)` to feel visually centred against the Squarespace page chrome; reset on screens ≤ 700 px so it doesn't push off
- Submit button: text → **"Proceed to payment"**, font 16 → 19 px, padding 16 → 18 px
- Event name string strips trailing `(...)` parenthetical — Airtable's `Event Name` field includes the date for use in emails / receipts, but here the date is already rendered separately below

**Squarespace embed gotchas — wrote into the file's header doc:**
- Squarespace renders `//` lines as plain text because they're outside any `<script>` tag → file now has an unmissable `▼▼▼ PASTE FROM HERE ▼▼▼` banner between the repo doc header and the embed content
- Squarespace's theme hijacks `<form>` submit events from Code Block embeds → switched the submit button to `type="button"` and bound a `click` handler instead; replaced lost HTML5 `required` validation with explicit "Please fill in: X, Y" inline check

#### Email template — final polish

- Button colour beige `#f4dbc0` with `color:#000 !important` + inner `<span style="color:#000;">` wrap (some clients strip colour from `<a>` but respect it on inner elements)
- Button text literal capitals (`CLAIM YOUR TICKET`) rather than CSS `text-transform: uppercase` — some clients strip the CSS
- HTML collapsed to a single line so newlines between `<a>` and the text don't get rendered as siblings below the button (Outlook quirk)
- `expiresAt` reformatted from raw ISO (`2026-06-20T13:40:42.907Z`) to friendly Europe/London string: **"Friday 20 June 2026 at 1:40 PM (UK time)"** — done in the script via `Intl.DateTimeFormat.formatToParts()`. The Waiting List row's `Token Expires At` field still stores ISO (Airtable date field needs ISO; `redeem-checkout` compares with `new Date(...).getTime() < Date.now()`).

#### Airtable rich-text editor BOM injection — root cause and three-layer fix

After moving the email Send step inside a Conditional Logic wrapper, customers' click-through URLs came back as `?token=%EF%BB%BF%EF%BB%BFbe01...`. The "claim ticket" link 404'd because the BOMs broke the strict `{Redemption Token} = '...'` filter formula on the lookup endpoint.

**Why it started now and not before**: deleting the Send-email step (necessary because Conditional Logic creates a parent wrapper and can't be slotted between two existing actions on this Airtable plan) meant re-dragging the `redemptionToken` blue pill back into the `<a href="...token=">` attribute. The new drag landed in a position that triggered Airtable's editor to "protect" the pill with invisible `U+FEFF` chars on either side. The original drag (months ago) happened to land cleanly.

**Three layers of defense added**:

1. `FRONTEND - WAITING LIST REDEMPTION 19th June '26.js` — `getToken()` strips `[﻿​-‍⁠]` (BOM + ZWSP/ZWNJ/ZWJ + word joiner) immediately after reading `?token=`
2. `api/waiting-list/lookup/[token].js` — same regex applied to incoming token before the Airtable lookup
3. `api/waiting-list/redeem-checkout.js` — same regex applied before lookup AND before passing through to Stripe metadata

**Source fix (the real solve)**: added `claimUrl` output to the cancellation + on-expired scripts: `const claimUrl = 'https://somevoices.co.uk/ticket-waiting-list?token=' + redemptionToken;` → email template uses `{claimUrl}` as the **entire** `href` value (single blue pill with no plain-text boundary for the editor to wrap with BOMs). Future emails come out clean; the three strip layers are belt-and-braces.

#### Two new automations — self-healing expiry loop

Built the daily expiry flow as **two automations**, not one, because Airtable's Send-email step is one email per automation run. A burst of N expiries needs to fan out into N independent runs.

**Hourly Expiry Sweep** (new file: `~/Documents/Vercel/airtable-scripts/SV-Ticketing-Base - waiting-list-hourly-expiry-sweep.js`)
- Trigger: At scheduled time → Hourly
- Walks every `Notified` row, flips any whose `Token Expires At < NOW()` to `Status=Expired`
- Uses `updateRecordsAsync` in 50-record chunks (Airtable's hard limit)
- No emails, no per-row logic — bulk-mark only

**On-Expired Re-Notify** (new file: `~/Documents/Vercel/airtable-scripts/SV-Ticketing-Base - waiting-list-on-expired.js`)
- Trigger: When record matches conditions → Waiting List `Status` is `Expired`
- Releases the linked Reservation (`Status=Released` so seat goes back to public pool)
- Finds the next eligible `Waiting` row (oldest by Joined At, Quantity Wanted ≤ 1)
- Creates fresh Reservation + token + 24h expiry, marks them `Notified`
- Outputs `notified`, `email`, `firstName`, `eventName`, `claimUrl`, `expiresAt` — identical names to the cancellation script so the email body copy-pastes between automations without re-mapping any blue pills
- Conditional Logic action (tick the `notified` checkbox) → Send email

End-to-end the system now:
1. Customer joins waiting list → row created with `Status=Waiting`
2. Public ticket cancelled → cancellation script picks next eligible, holds Reservation, sends claim email
3. Customer claims (webhook → `Status=Converted`) **or** ignores
4. Within the next hour of expiry, sweep flips `Status=Expired`
5. That status change triggers the re-notify automation → releases old Reservation, finds next waitlister, sends new claim email
6. Loop continues until someone claims or the list runs dry — then released Reservation puts the seat back in the public pool

### Key learnings worth preserving

**Airtable Conditional Logic can't be inserted between existing actions on Business plan** (or it's a UI bug — only appears when added at the end of a chain). Workaround: delete the downstream action(s), add Conditional Logic, then re-add the deleted actions inside the Then branch. **Each delete + re-add carries the BOM-injection risk** described above when blue pills get re-dragged into HTML attributes. Use a precomposed `claimUrl` output to keep `href` values free of mixed text + pill content.

**Airtable's "Conditional logic" UI renders boolean (`output.set('notified', true|false)`) outputs as a tickbox** — not a typed value field. Tick the box = "condition true when notified is true". This caught me trying to type the word `true`.

**Airtable single-select fields require `{ name: 'Option' }` form when used with `createRecordAsync`**, but accept bare strings on `updateRecordAsync`. Already documented; reinforced today when copying the cancellation script pattern into the on-expired script.

**Airtable output variables don't appear in downstream blue-pill dropdowns until they're `output.set()`-ed in at least one test run** with non-empty values. Init every output at the top of the script with empty-string / `false` defaults so early-return paths still expose the variable name to downstream steps.

**Squarespace Code Block hijacks `<form>` submit** events from embeds. Switch the button to `type="button"` + bind `click` handler + replicate HTML5 validation manually (we surface "Please fill in: X" inline error in this codepath).

**Airtable rich-text editor injects invisible BOM/zero-width chars around dragged blue pills inside HTML attribute values**. Mitigations (in priority order):
1. Use a single output for the full URL so the pill IS the attribute value
2. Server-side strip incoming chars in the regex `/[﻿​-‍⁠]/g` before any strict match
3. Client-side strip on read so the address bar value is also clean if you do `history.replaceState`

### Files Modified / Added Today

- **New (saved to repo)**: `FRONTEND - WAITING LIST REDEMPTION 19th June '26.js`
- **New (airtable-scripts/)**: `SV-Ticketing-Base - waiting-list-hourly-expiry-sweep.js`, `SV-Ticketing-Base - waiting-list-on-expired.js`
- **Modified (airtable-scripts/)**: `SV-Ticketing-Base - waiting-list-on-cancellation.js` — friendly `expiresAt` format, added `claimUrl` output
- **Modified API**: `api/waiting-list/lookup/[token].js`, `api/waiting-list/redeem-checkout.js` — BOM/zero-width strip
- **Commit** `b21835a` shipped the API + new frontend file

### Where it ends

Waiting List Phases 1, 2A, 2B, 2C are all live. The whole system is now self-running. Failures will only surface when users alert us (or when periodic checks of Airtable automation history / Vercel function logs catch a red run before customers do). No further work planned unless multi-ticket Phase 3 demand actually materialises.

---

## Session Log: June 20, 2026

### Waiting List — multi-ticket redemption + Target Allocation flow

Two related extensions to yesterday's self-running waiting list system, both live in production by end of day.

#### Multi-ticket redemption (up to 3 tickets per waitlister)

Until today, each waitlister could only claim 1 ticket regardless of how much capacity was available. Customers landing on the redemption page after a cancellation often had public capacity sitting unused next to their hold. Today's change: the page now shows "There is 1 / are N tickets available" with a +/- selector capped at 3.

**Why 3 and not "all available":** prevents a single waitlister from grabbing a large Allocation release in full (e.g. a 100-seat venue expansion), leaving nothing for the rest of the queue. The cap is a soft compromise between "let waitlisters take what they want" and "respect the queue".

**Files changed (committed `b98dacf`):**

- `api/waiting-list/lookup/[token].js` — fetches the linked Reservation to read its `Quantity` + `Status`, computes `availableTickets = min(3, holdQuantity + max(0, ticketsRemaining))`. Hold counts as 0 if `Status != Active` (e.g. abandoned previous checkout) so retries work cleanly. Returns `availableTickets` at the top level of the response.

- `api/waiting-list/redeem-checkout.js` — accepts `quantity` in POST body (default 1, validated as integer 1–3). Re-reads live `Tickets Remaining` and rejects (`409` with descriptive message) if `quantity > currentHoldQty + max(0, ticketsRemaining)`. **Critically: updates the Reservation's `Quantity` field BEFORE creating Stripe Checkout** — this atomic seat-hold extension protects the additional seats from public sniping during the 30-min Stripe session window. Also sets `Status = 'Active'` defensively in case the row had been Released by a prior abandoned attempt. Scales Stripe line items (ticket + booking fee) and `ticketsData` / `totalQuantity` metadata by the chosen quantity.

- `FRONTEND - WAITING LIST REDEMPTION 19th June '26.js` — new `.wl-availability` box between expiry text and form; beige-tinted to match brand. Renders "There is 1 ticket available." (singular) or "There are N tickets available." (plural) with bold N. +/- buttons disable at 1 / max. Live `Total: £X.YY` updates per click including `(ticketPrice + bookingFee) * quantity`. POST body includes `quantity`. **Edge case branch:** if `availableTickets = 0` (rare race), hides the form entirely and shows a friendly sold-out message; the invitation stays live so the next cascade can promote them again.

**No schema changes required** — `Tickets Remaining`, `Reservation.Quantity`, `Reservation.Status` all existed. The webhook already creates N Ticket records from the `ticketsData` metadata array (same path public buys use).

#### Target Allocation — single-field admin workflow for capacity increases

Until today, increasing `Allocation` on an Event row updated the public `Tickets Remaining` formula immediately, with no way to hold the new seats for the waiting list. Admin could open 5 seats and the public could grab all 5 before any waitlister was notified.

Today's change: a new `Target Allocation` field lets admin type the desired new total. An automation atomically holds a seat for the top-of-queue waitlister BEFORE bumping the visible Allocation, so the held seat is never publicly visible.

**Admin UX:** Open the Event row, type `<current + N>` into `Target Allocation`, save. Done.

**Files added** (under `~/Documents/Vercel/airtable-scripts/`):

- `SV-Ticketing-Base - waiting-list-apply-target-allocation.js` — reads `delta = Target - Allocation`. If positive AND at least one eligible waitlister exists for this event, creates ONE placeholder Reservation with `Source = 'Waiting List Hold'`, `Quantity = 1`, `Status = 'Active'` linked to the Event. Then bumps Allocation to the target value and clears `Target Allocation`. The single Hold triggers the per-row "Promote from Hold" automation next.

- `SV-Ticketing-Base - waiting-list-promote-from-hold.js` — reads the placeholder Reservation, finds the next eligible `Waiting` row for the linked Event (oldest by `Joined At`, `Quantity Wanted ≤ 1`), then **converts the placeholder in place** (flips Source to `Waiting List`, sets Reservation Token, links the Waiting List Entry). Generates Redemption Token + 24h expiry on the Waiting List row, marks it `Notified`. Defensive: if no waitlister exists (concurrent processing), flips the placeholder to `Released`. Emits the same outputs as the cancellation script (`notified`, `email`, `firstName`, `eventName`, `claimUrl`, `expiresAt`, etc.) so the same email body copy-pastes between automations without re-mapping blue pills.

**Schema additions (manual in Airtable):**

- New field on Event: `Target Allocation` (Number, allow 0)
- New option on Reservations `Source` single-select: `Waiting List Hold`

**Two new Airtable automations:**

| # | Name | Trigger | Action |
|---|------|---------|--------|
| 1 | Waiting List — apply target allocation | When record updated → Event → fields watched: `Target Allocation` | Run script (`waiting-list-apply-target-allocation.js`), input `eventId = Airtable Record ID` |
| 2 | Waiting List — promote from hold | When record matches conditions → Reservations → `Source is Waiting List Hold` AND `Status is Active` | Run script (`waiting-list-promote-from-hold.js`), input `reservationId = Airtable Record ID` → Conditional (tick `notified`) → Send email (body copy-pasted from on-expired/cancellation, fresh blue pills from this script step) |

### Key learning worth preserving

**"Notify only #1" model for Allocation increases — and why we picked it over the full Pool design**

When `Target Allocation` bumps capacity by `delta`, the script creates **one Hold regardless of delta**. So if admin opens 5 seats, only the top waitlister gets emailed; the other 4 go to public. The trade-off: if WL#1 only claims part of what they could (e.g. takes 1 of 3 available via the multi-ticket page), the unclaimed seats go to public rather than cascading down the queue.

The user (Curtis) initially wanted **all** new capacity reserved for waitlist with cascade-through-queue logic ("a Pool pattern"). After laying out the design (single `Source = 'Waiting List Pool'` Reservation with `Q = delta`, restoration logic in `on-expired` + `redeem-checkout` to push leftover back to pool, new "After Convert" automation to promote the next waitlister), we agreed the implementation was significant — 4 file modifications + 1 new automation + restoration logic that needs to handle race conditions carefully — and the practical difference for small deltas (3-4 Allocation changes per event life, usually opening 1-5 seats) is small enough to defer.

The doc comment in `waiting-list-apply-target-allocation.js` calls out the upgrade path for future-Claude / future-Curtis: it's a script-only change, no schema migration required, so we can swap it in if the leftover-to-public behaviour ever bites in practice.

### Other Airtable footguns surfaced today

**Conditional Logic in Airtable automations cannot be inserted between two existing actions** — even on Business plan, the "Add advanced logic or action → Conditional logic" option only appears *after* the last existing action. To wrap an existing action in a conditional: delete the downstream action, add Conditional Logic (which now appears), then re-add the deleted action inside the Then branch. (This is how today's "Promote from Hold" automation was wired with the Send Email step inside a `notified` check — same pattern as on-expired.)

**Conditional Logic renders boolean script outputs as a checkbox**, not a typed-value field. The blue pill for `output.set('notified', true|false)` shows up as a tickbox in the condition editor. Tick = "send email when notified is true". Easy to overlook on first try.

### Files Modified / Added Today

- **API (deployed `b98dacf`)**: `api/waiting-list/lookup/[token].js`, `api/waiting-list/redeem-checkout.js`
- **Squarespace (re-pasted)**: `FRONTEND - WAITING LIST REDEMPTION 19th June '26.js`
- **New (airtable-scripts/)**: `SV-Ticketing-Base - waiting-list-apply-target-allocation.js`, `SV-Ticketing-Base - waiting-list-promote-from-hold.js`
- **Airtable schema**: `Target Allocation` field on Event, `Waiting List Hold` option on Reservations `Source`
- **Airtable automations**: 2 new (Apply Target Allocation + Promote from Hold)

### Where it ends

Multi-ticket redemption verified live. Target Allocation flow verified live. Combined with yesterday's expiry/re-notify chains, the waiting list system now handles four distinct capacity-change scenarios:

| Event | Trigger | Hold model |
|---|---|---|
| Public ticket cancelled | Tickets Status → Cancelled | 1-seat hold for WL#1 |
| Allocation increased | Event.Target Allocation updated | 1-seat hold for WL#1, delta-1 to public |
| Waitlister abandons 24h window | Hourly sweep flips to Expired | Released, next WL gets fresh hold |
| Waitlister buys with capacity left over | (no auto-trigger) | Leftover stays public |

The last row remains a known gap — if WL#1 takes fewer than they could have, WL#2 only learns when something else happens. Documented as part of the deferred Pool upgrade path; not blocking.
