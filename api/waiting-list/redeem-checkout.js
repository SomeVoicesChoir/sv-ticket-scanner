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

const stripe = require('stripe')(process.env.STRIPE_TICKET_SECRET_KEY);
const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
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
        const reservationId = reservationLinks[0];

        const resvUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(RESERVATIONS_TABLE)}/${reservationId}`;
        const resvResp = await fetch(resvUrl, { headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` } });
        if (!resvResp.ok) return res.status(500).json({ error: 'Could not find your held reservation' });

        const reservation = await resvResp.json();
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
        const currency = (event.fields['Currency'] || 'GBP').toLowerCase();
        const price = Number(event.fields['Ticket Price'] || 0);
        const bookingFee = Number(event.fields['Booking Fee'] || 0);
        const stripePriceId = event.fields['Stripe Price ID'] || '';
        const ticketsRemaining = Number(event.fields['Tickets Remaining'] || 0);

        if (price <= 0) {
            return res.status(500).json({ error: 'Event has no price set. Please contact support.' });
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
