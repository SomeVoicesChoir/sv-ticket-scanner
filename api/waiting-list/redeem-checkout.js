// Waiting list redemption checkout
//
// Receives the customer's details + their redemption token from the
// Squarespace redemption page, validates everything, then creates a Stripe
// Checkout session that reuses the EXISTING Reservation already created by
// the Airtable cancellation script. The shared Reservation Token in Stripe
// metadata means the existing webhook handler (markReservationsByToken) will
// flip the same Reservation to Fulfilled on payment completion — no new
// reservation row, no double-counting of capacity.
//
// Also adds waitingListRedemption + waitingListId to Stripe metadata so the
// webhook can mark the Waiting List row as Converted in the same step.
//
// FREE events (member tickets at £0) have no Stripe session at all — see the
// FREE TICKET PATH below, which writes the tickets itself and does inline
// what the webhook would otherwise have done.

const stripe = require('stripe')(process.env.STRIPE_TICKET_SECRET_KEY);
const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    ticketsTableId: process.env.AIRTABLE_TABLE_ID,
    sendTicketsTableId: process.env.AIRTABLE_SEND_TICKETS_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

const WAITING_LIST_TABLE = 'Waiting List';
const RESERVATIONS_TABLE = 'Reservations';

// Hard cap on tickets a single waitlister can claim. Keep in sync with
// MAX_TICKETS_PER_REDEMPTION in api/waiting-list/lookup/[token].js.
const MAX_TICKETS_PER_REDEMPTION = 3;

function fv(field, fallback = '') {
    if (!field) return fallback;
    if (Array.isArray(field)) return field[0] || fallback;
    return field || fallback;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { token: rawToken, firstName, surname, email, phone, postcode, mailingListOptIn, quantity: rawQuantity } = req.body || {};

        if (!rawToken || typeof rawToken !== 'string') {
            return res.status(400).json({ error: 'Missing redemption token' });
        }
        // Strip BOM + zero-width chars (Airtable rich-text editor leakage).
        const token = String(rawToken).replace(/[﻿​-‍⁠]/g, '').trim();

        if (!firstName || !surname || !email || !phone || !postcode) {
            return res.status(400).json({ error: 'Please complete every required field' });
        }
        if (!String(email).includes('@')) {
            return res.status(400).json({ error: 'Please enter a valid email' });
        }

        // Quantity: default 1, must be integer in [1, MAX_TICKETS_PER_REDEMPTION].
        // Capacity check (against live Tickets Remaining) happens after we have
        // the linked Event in hand a few lines below.
        const quantity = Math.floor(Number(rawQuantity) || 1);
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_REDEMPTION) {
            return res.status(400).json({ error: `Quantity must be between 1 and ${MAX_TICKETS_PER_REDEMPTION}.` });
        }

        // ── Find the Waiting List row by token ───────────────────────
        const safeToken = token.replace(/'/g, "\\'");
        const wlFormula = encodeURIComponent(`{Redemption Token} = '${safeToken}'`);
        const wlUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(WAITING_LIST_TABLE)}?filterByFormula=${wlFormula}&maxRecords=1`;

        const wlResp = await fetch(wlUrl, { headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` } });
        if (!wlResp.ok) return res.status(500).json({ error: 'Could not validate redemption token' });

        const wlData = await wlResp.json();
        const wlRow = (wlData.records || [])[0];

        if (!wlRow) {
            return res.status(404).json({ error: 'This link is not valid.' });
        }

        const wlStatus = wlRow.fields['Status'];
        const expiresAtStr = wlRow.fields['Token Expires At'];

        if (wlStatus !== 'Notified') {
            return res.status(410).json({
                error: wlStatus === 'Converted'
                    ? 'You have already used this link to purchase your ticket.'
                    : 'This invitation is no longer valid.'
            });
        }
        if (expiresAtStr && new Date(expiresAtStr).getTime() < Date.now()) {
            return res.status(410).json({ error: 'This invitation has expired.' });
        }

        // ── Find the linked Reservation row (created by cancellation script) ──
        const reservationLinks = wlRow.fields['Reservations'] || [];
        if (reservationLinks.length === 0) {
            return res.status(500).json({ error: 'No reservation held for this invitation. Please contact support.' });
        }
        // Take the ACTIVE hold, not `reservationLinks[0]`. A row notified more
        // than once accumulates Reservations — the earlier ones Released by the
        // on-expired cascade — and the newest is APPENDED, so [0] is the dead
        // one. Picking it reads `currentHoldQty` as 0, and on a sold-out event
        // (where the only free seat IS their hold) the capacity check then
        // refuses with "No tickets are available for this event right now". Three
        // of the 13 rows on the free Grand Sing row already carry two links.
        // Falls back to the most recent link, not the first. Oct 12 2026.
        const linkedReservations = await Promise.all(
            reservationLinks.slice(0, 10).map(async (id) => {
                const r = await fetch(
                    `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(RESERVATIONS_TABLE)}/${id}`,
                    { headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` } }
                );
                return r.ok ? await r.json() : null;
            })
        );
        const readable = linkedReservations.filter(Boolean);
        if (readable.length === 0) return res.status(500).json({ error: 'Could not find your held reservation' });

        const reservation = readable.find(r => r.fields['Status'] === 'Active') || readable[readable.length - 1];
        const reservationId = reservation.id;
        if (readable.length > 1) {
            console.log(`Waiting list ${wlRow.id} has ${readable.length} linked reservation(s) — using ${reservationId} (${reservation.fields['Status']})`);
        }

        const resvUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(RESERVATIONS_TABLE)}/${reservationId}`;
        const reservationToken = reservation.fields['Reservation Token'];
        if (!reservationToken) {
            return res.status(500).json({ error: 'Reservation is missing its token. Please contact support.' });
        }

        // ── Get the linked Event for pricing ──────────────────────────
        const eventLinks = reservation.fields['Event'] || [];
        if (eventLinks.length === 0) {
            return res.status(500).json({ error: 'Reservation has no linked event' });
        }
        const eventId = eventLinks[0];

        const eventUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.eventTableId}/${eventId}`;
        const eventResp = await fetch(eventUrl, { headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` } });
        if (!eventResp.ok) return res.status(500).json({ error: 'Could not fetch event details' });

        const event = await eventResp.json();
        const eventName = fv(event.fields['Event Name'], 'Some Voices Event');
        const ticketTypePrice = fv(event.fields['Ticket Type + Price']) || fv(event.fields['Ticket Type']) || 'Ticket';
        const dateTime = fv(event.fields['Date + Time Friendly']) || fv(event.fields['Date Friendly']);
        const venueAddress = fv(event.fields['Venue Address']);
        // ⚠️ The Event table has NO {Currency} field. The real one is Stripe's
        // own `default_price_data[currency]` single-select (gbp/eur/usd) — which
        // is what get-events.js reads for the public selectors. This line used to
        // read `event.fields['Currency']`, always undefined, so EVERY claim fell
        // back to GBP: a EUR event's waiting-list claim was charged in POUNDS at
        // the euro number. 11 EUR event rows exist, 6 of them priced, incl. Glow
        // Amsterdam (€10/€15, Dec 2026). Found Oct 12 2026 while fixing the free
        // path. The `Currency` fallback stays only in case such a field is ever
        // added; it is NOT the authority.
        const currency = String(
            event.fields["Stripe 'default_price_data[currency]'"] || event.fields['Currency'] || 'GBP'
        ).toLowerCase();
        const price = Number(event.fields['Ticket Price'] || 0);
        const bookingFee = Number(event.fields['Booking Fee'] || 0);
        const stripePriceId = event.fields['Stripe Price ID'] || '';
        const ticketsRemaining = Number(event.fields['Tickets Remaining'] || 0);

        // £0 is a legitimate price — member tickets are often free, and the
        // public/member selectors have bypassed Stripe for them since launch
        // (create-ticket-checkout.js's FREE TICKET PATH). This endpoint used to
        // refuse a zero price outright, so EVERY free-event claim died with
        // "Event has no price set" and the invitation lapsed 24h later
        // (12 of 12 notified waitlisters on the free Grand Sing London row,
        // Oct 2026). Only nonsense pricing is an error now.
        if (!Number.isFinite(price) || price < 0 || !Number.isFinite(bookingFee) || bookingFee < 0) {
            return res.status(500).json({ error: 'Event pricing is not set up correctly. Please contact support.' });
        }

        // ── Capacity check ───────────────────────────────────────────
        // Their existing hold quantity is already counted in Tickets Remaining
        // via the Reserved rollup, so add it back to compute their true ceiling.
        const currentHoldQty = (reservation.fields['Status'] === 'Active')
            ? (Number(reservation.fields['Quantity']) || 1)
            : 0;
        const maxClaim = Math.min(MAX_TICKETS_PER_REDEMPTION, currentHoldQty + Math.max(0, ticketsRemaining));
        if (quantity > maxClaim) {
            return res.status(409).json({
                error: maxClaim === 0
                    ? 'No tickets are available for this event right now.'
                    : `Only ${maxClaim} ticket${maxClaim > 1 ? 's' : ''} available — please reduce your quantity and try again.`
            });
        }

        // ── Update the Reservation's Quantity BEFORE creating Stripe Checkout
        // so that Reserved goes up by the extra seats immediately, protecting
        // them from a public sniper during the next 30 mins of checkout.
        if (currentHoldQty !== quantity) {
            const qtyPatchResp = await fetch(resvUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${CONFIG.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fields: { 'Quantity': quantity, 'Status': 'Active' } })
            });
            if (!qtyPatchResp.ok) {
                return res.status(500).json({ error: 'Could not hold the requested number of tickets. Please try again.' });
            }
        }

        // ── FREE TICKET PATH: no Stripe session at all ────────────────
        // Stripe Checkout cannot take a £0 payment, so there is nothing to
        // redirect to. We write the tickets here and do inline the three things
        // the webhook would have done on `checkout.session.completed`: create
        // the Send Tickets row (which triggers the PDF + email automation),
        // flip the held Reservation to Fulfilled, and mark the Waiting List row
        // Converted. Mirrors create-ticket-checkout.js's free path.
        //
        // The session id is DERIVED from the Waiting List row rather than
        // random, so a double-tap or a retry after a timeout finds the tickets
        // it already created instead of issuing a second set. `free_...` is the
        // shape tickets-by-session/[sessionId].js already accepts.
        if (price + bookingFee === 0) {
            const freeSessionId = `free_wl_${wlRow.id}`;
            console.log(`Free event — bypassing Stripe for waiting list ${wlRow.id} (session ${freeSessionId})`);

            const existingTickets = await findBySessionId(CONFIG.ticketsTableId, freeSessionId);
            if (existingTickets.length > 0) {
                console.log(`Tickets already exist for ${freeSessionId} — duplicate submit, skipping creation`);
            } else {
                // Send Tickets FIRST (same order as the webhook), and only if a
                // prior partial run didn't already make one — re-creating it
                // would re-fire the customer email.
                const existingSend = await findBySessionId(CONFIG.sendTicketsTableId, freeSessionId);
                if (existingSend.length === 0) {
                    await createAirtableRecord(CONFIG.sendTicketsTableId, { 'Stripe Session ID': freeSessionId });
                }

                const ticketWrites = [];
                for (let n = 1; n <= quantity; n++) {
                    ticketWrites.push(createAirtableRecord(CONFIG.ticketsTableId, {
                        'Event Name': [eventId],
                        'First Name': firstName,
                        'Surname': surname,
                        'Email': email,
                        'Mobile Phone Number': phone,
                        'Post Code': postcode,
                        'Stripe Session ID': freeSessionId,
                        'Amount Paid': 0,
                        'Status': 'Valid',
                        'Currency': currency,
                        'Mailing List Opt In': mailingListOptIn ? true : false,
                        'Ticket Number': `${n} of ${quantity}`
                    }));
                }
                await Promise.all(ticketWrites);
                console.log(`Created ${quantity} free ticket(s) for ${email} (Event ${eventId})`);
            }

            // Reservation → Fulfilled (seat now counted in Tickets Sold, not Reserved)
            await fetch(resvUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${CONFIG.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fields: {
                        'Status': 'Fulfilled',
                        'Released At': new Date().toISOString(),
                        'Released Reason': 'Completed',
                        'Stripe Session ID': freeSessionId
                    }
                })
            });

            // Waiting List → Converted. Last, so a failure anywhere above leaves
            // the row Notified and the link still usable.
            const wlPatch = await fetch(
                `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(WAITING_LIST_TABLE)}/${wlRow.id}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${CONFIG.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fields: { 'Status': 'Converted', 'Converted Session ID': freeSessionId }
                    })
                }
            );
            if (!wlPatch.ok) {
                console.error('Non-fatal: failed to mark Waiting List row Converted:', await wlPatch.text());
            }

            return res.status(200).json({
                free: true,
                sessionId: freeSessionId,
                redirectUrl: 'https://somevoices.co.uk/ticket-success'
            });
        }

        // ── Build Stripe Checkout line items ─────────────────────────
        const lineItems = [{
            price_data: {
                currency: currency,
                unit_amount: Math.round(price * 100),
                product_data: {
                    name: eventName,
                    description: `${ticketTypePrice} - ${dateTime}`,
                    metadata: {
                        original_price_id: stripePriceId,
                        waiting_list: 'true'
                    }
                }
            },
            quantity: quantity
        }];

        if (bookingFee > 0) {
            lineItems.push({
                price_data: {
                    currency: currency,
                    unit_amount: Math.round(bookingFee * 100),
                    product_data: {
                        name: 'Booking Fee',
                        description: `Booking fee for ${eventName}`
                    }
                },
                quantity: quantity
            });
        }

        // ── Create Stripe Checkout session ────────────────────────────
        // Stripe minimum expires_at is 30 minutes; use that so the reservation
        // stays held in case the customer wanders.
        const stripeExpiresAt = Math.floor(Date.now() / 1000) + 1800;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            expires_at: stripeExpiresAt,
            allow_promotion_codes: true,
            success_url: 'https://somevoices.co.uk/ticket-success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: `https://somevoices.co.uk/ticket-waiting-list?token=${encodeURIComponent(token)}`,
            customer_email: email,
            automatic_tax: { enabled: true },
            custom_text: {
                submit: {
                    message: "We're holding your ticket for the next few minutes. Please complete checkout to claim it."
                }
            },
            payment_intent_data: {
                statement_descriptor: 'SomeVoices Event',
                description: `Ticket for ${eventName}`
            },
            metadata: {
                firstName: firstName,
                surname: surname,
                attendeeEmail: email,
                phone: phone,
                postcode: postcode,
                ticketsData: JSON.stringify([{ eventId: eventId, quantity: quantity, ticketType: ticketTypePrice }]),
                totalQuantity: String(quantity),
                eventName: eventName,
                dateTime: dateTime,
                venueAddress: venueAddress,
                currency: currency.toUpperCase(),
                stripePriceId: stripePriceId,
                mailingListOptIn: mailingListOptIn ? 'true' : 'false',
                companionTicket: 'false',
                companionTicketData: '',
                // Reuses the existing Reservation's token so the webhook's
                // markReservationsByToken flips THIS row to Fulfilled (no new row)
                reservationToken: reservationToken,
                // Tells the webhook to also mark the Waiting List row Converted
                waitingListRedemption: 'true',
                waitingListId: wlRow.id
            }
        });

        // Best-effort: attach the Stripe Session ID to the held Reservation row
        await fetch(resvUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: { 'Stripe Session ID': session.id } })
        }).catch(err => console.error('Non-fatal: failed to patch Session ID onto held reservation:', err));

        console.log(`Waiting list redeem checkout ${session.id} for ${email} (Event ${eventId}, qty ${quantity})`);
        return res.status(200).json({ sessionId: session.id, expiresAt: stripeExpiresAt });

    } catch (error) {
        console.error('Error creating waiting list redeem checkout:', error);
        return res.status(500).json({ error: error.message });
    }
};

// Look up records in a table by Stripe Session ID. Used by the free path for
// idempotency — same job as the webhook's fetchRecordsBySessionId.
async function findBySessionId(tableId, sessionId) {
    const safeId = String(sessionId).replace(/'/g, "\\'");
    const formula = encodeURIComponent(`{Stripe Session ID} = '${safeId}'`);
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`;

    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` } });
    if (!response.ok) {
        throw new Error(`Failed to look up ${tableId} by Session ID: ${await response.text()}`);
    }
    const data = await response.json();
    return data.records || [];
}

async function createAirtableRecord(tableId, fields) {
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${tableId}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        throw new Error(`Failed to create record in ${tableId}: ${await response.text()}`);
    }
    return await response.json();
}
