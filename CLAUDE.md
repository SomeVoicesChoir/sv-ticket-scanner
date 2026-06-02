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

### Scripts (local-only, not deployed)

- `scripts/setup-google-pass-class.js` — one-time idempotent script that creates the Google Wallet Pass Class via the Wallet REST API. Run with the service account JSON file path as argument. Re-running prints "already exists".

### Frontend Files (Copy-paste into Squarespace)
- `FRONTEND - PUBLIC Event Selector 9th Feb '26.js` — Public ticket purchasing
- `FRONTEND - MEMBER Event Selector 9th Feb '26.js` — Member event selector

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
- `Reserved (live)` — **Rollup:** SUM of `Quantity` from linked `Reservations` records where `Status = 'Active'`. Drives `Tickets Remaining`.
- `Reserved` — **Legacy integer field, no longer written.** Will be deleted after Phase 5 cleanup completes.
- `Tickets Remaining` — **Formula:** `Allocation - {Tickets Sold} - {Reserved (live)}`
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
**Purpose:** One row per cart-line per checkout. Tracks in-flight tickets via the `Status` field. `Reserved (live)` rollup on the Event table sums Quantity from rows where Status='Active'.

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

Each in-flight checkout creates one row per cart line in the `Reservations` table (Status=Active). The Event table's `Reserved (live)` rollup sums those Active rows' Quantity. Webhooks flip Status to terminal states by Reservation Token — no shared counter to race on.

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
  ├─ Re-read Tickets Remaining (race guard via Reserved (live) rollup)
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
If a webhook fails to fire (Stripe outage, Vercel timeout, signature secret mismatch), the corresponding Reservations row stays `Status=Active` and inflates `Reserved (live)` permanently. Stripe retries webhooks for up to 3 days, so most stuck rows self-heal. For ones that don't:

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
- Add a second writer that mutates `Reserved (live)` directly — it's a rollup, not a counter; the only valid way to change it is to add/edit/delete Reservations rows
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

**Diagnosis tip for future:** If `Reserved (live)` is rising and not coming down, check Vercel logs for the webhook function — `markReservationsByToken` is the only path that releases rows. Filter Reservations by `Status=Active AND Created < now - 35 min` to spot stuck rows directly.

### Webhook idempotency (commit `158e90b`)

Followed up the Reservations migration with a related correctness fix: the `.completed` handler in `api/stripe-ticket-webhook.js` was not idempotent. If Stripe redelivered the event (timeout, transient 5xx, etc.), the handler would create a duplicate Send Tickets row (re-firing the email automation) and a duplicate set of Tickets.

**Fix:** added `fetchRecordsBySessionId(tableId, sessionId)` helper that filters via `{Stripe Session ID} = '<id>'`. At the top of the `.completed` handler:
- If Tickets exist for this Session ID → skip everything, flip Reservations to Fulfilled, return 200
- If only Send Tickets exists (partial-failure case) → skip Send Tickets re-creation but proceed with ticket creation

The Reservations side was already idempotent from the prior migration (status flips are no-ops on retry). This commit makes the ticket creation side robust too. Adds two Airtable reads at the top of the handler — cheap compared to the bug it prevents.

**Known limit:** if `Promise.all` for ticket creation partially succeeds before throwing, the retry will see "tickets exist" and skip the missing ones. Visible in logs, recoverable manually. Not yet observed in practice.

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
