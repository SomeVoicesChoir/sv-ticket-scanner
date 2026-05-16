const fetch = require('node-fetch');
const stripe = require('stripe')(process.env.STRIPE_TICKET_SECRET_KEY);

// CRITICAL: Tell Vercel to NOT parse the body - we need raw bytes for signature verification
exports.config = {
    api: {
        bodyParser: false,
    },
};

const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    sendTicketsTableId: process.env.AIRTABLE_SEND_TICKETS_TABLE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    webhookSecret: process.env.STRIPE_TICKET_WEBHOOK_SECRET
};

// Reservations table — referenced by name (Airtable REST accepts table name or ID)
const RESERVATIONS_TABLE = 'Reservations';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    
    // Get the raw body as a buffer
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);
    
    let event;

    try {
        // Verify webhook signature with raw body
        event = stripe.webhooks.constructEvent(
            rawBody,
            sig,
            CONFIG.webhookSecret
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle successful checkout
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const metadata = session.metadata;

        if (!metadata.eventName) {
            console.log('Skipping - not a ticket purchase');
            return res.status(200).json({ received: true, skipped: 'not a ticket' });
        }

        try {
            // Idempotency guard — if Tickets already exist for this Session ID,
            // a previous run of this webhook already completed. Skip all creation
            // (avoids duplicate tickets and duplicate email automation triggers).
            // Still flip Reservations rows to Fulfilled — that's idempotent.
            const existingTickets = await fetchRecordsBySessionId(CONFIG.tableId, session.id);
            if (existingTickets.length > 0) {
                console.log(`Tickets already exist for session ${session.id} (${existingTickets.length} found) — webhook retry detected, skipping creation`);
                await markReservationsByToken(metadata.reservationToken, 'Fulfilled', 'Completed');
                return res.status(200).json({ received: true, skipped: 'tickets already exist' });
            }

            // Partial-failure guard — Send Tickets may exist from a prior
            // partial run. Don't re-create it (would fire email automation twice).
            const existingSendTickets = await fetchRecordsBySessionId(CONFIG.sendTicketsTableId, session.id);
            const sendTicketsAlreadyExists = existingSendTickets.length > 0;
            if (sendTicketsAlreadyExists) {
                console.log(`Send Tickets record exists for session ${session.id} but no tickets — partial failure detected, will skip Send Tickets creation`);
            }

            // Retrieve Stripe fee from balance transaction
            let stripeFee = null;
            try {
                const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent, {
                    expand: ['latest_charge.balance_transaction']
                });
                const fee = paymentIntent.latest_charge?.balance_transaction?.fee;
                if (fee !== undefined) {
                    stripeFee = fee / 100; // Convert pence to pounds
                    console.log(`Stripe fee: £${stripeFee}`);
                }
            } catch (feeError) {
                console.error('Warning: Could not retrieve Stripe fee:', feeError.message);
                // Continue without fee - don't block ticket creation
            }

            // Create Send Tickets record FIRST (before individual tickets).
            // Skipped if a prior partial run already created one — re-creating
            // would re-trigger the email automation.
            if (!sendTicketsAlreadyExists) {
                console.log('Creating Send Tickets record...');
                await createSendTicketsRecord(session.id);
                console.log('Send Tickets record created');
            } else {
                console.log('Skipping Send Tickets creation — already exists from prior partial run');
            }

            // Parse the tickets data
            const ticketsArray = JSON.parse(metadata.ticketsData);
            
            console.log(`Creating tickets for ${ticketsArray.length} ticket type(s)`);
            
            // Calculate total tickets for numbering (excluding companion)
            const totalTickets = ticketsArray.reduce((sum, t) => sum + t.quantity, 0);
            
            // Calculate per-ticket Stripe fee (remainder goes on first ticket)
            let perTicketFee = null;
            let firstTicketFee = null;
            if (stripeFee !== null && totalTickets > 0) {
                perTicketFee = Math.floor(stripeFee * 100 / totalTickets) / 100; // Round down to nearest penny
                const remainder = Math.round((stripeFee - perTicketFee * totalTickets) * 100) / 100;
                firstTicketFee = Math.round((perTicketFee + remainder) * 100) / 100;
                console.log(`Fee split: first ticket £${firstTicketFee}, remaining tickets £${perTicketFee} each`);
            }

            // Create tickets for each type
            const ticketPromises = [];
            let ticketNumber = 0;
            
            ticketsArray.forEach(ticketType => {
                for (let i = 0; i < ticketType.quantity; i++) {
                    ticketNumber++;
                    ticketPromises.push(createTicketRecord({
                        eventId: ticketType.eventId,
                        eventName: metadata.eventName,
                        firstName: metadata.firstName,
                        surname: metadata.surname,
                        attendeeEmail: metadata.attendeeEmail,
                        phone: metadata.phone,
                        postcode: metadata.postcode,
                        dateTime: metadata.dateTime,
                        venueAddress: metadata.venueAddress,
                        stripeSessionId: session.id,
                        amountPaid: session.amount_total / 100,
                        ticketType: ticketType.ticketType,
                        ticketNumber: ticketNumber,
                        totalTickets: totalTickets,
                        currency: metadata.currency || 'GBP',
                        mailingListOptIn: metadata.mailingListOptIn === 'true',
                        stripeFee: ticketNumber === 1 ? firstTicketFee : perTicketFee
                    }));
                }
            });

            await Promise.all(ticketPromises);
            console.log(`Created ${ticketPromises.length} tickets total`);

            // Create companion ticket if requested
            if (metadata.companionTicket === 'true' && metadata.companionTicketData) {
                console.log('Creating companion ticket...');
                const companionData = JSON.parse(metadata.companionTicketData);
                
                await createTicketRecord({
                    eventId: companionData.eventId,
                    eventName: metadata.eventName,
                    firstName: metadata.firstName,
                    surname: metadata.surname,
                    attendeeEmail: metadata.attendeeEmail,
                    phone: metadata.phone,
                    postcode: metadata.postcode,
                    dateTime: metadata.dateTime,
                    venueAddress: metadata.venueAddress,
                    stripeSessionId: session.id,
                    amountPaid: 0,
                    ticketType: companionData.ticketType,
                    ticketNumber: null,
                    totalTickets: null,
                    currency: metadata.currency || 'GBP',
                    mailingListOptIn: metadata.mailingListOptIn === 'true',
                    isCompanion: true,
                    stripeFee: null
                });
                
                console.log('Created companion ticket');
            }

            // Mark Reservations rows as Fulfilled. Idempotent — safe on Stripe retries.
            await markReservationsByToken(metadata.reservationToken, 'Fulfilled', 'Completed');
            console.log(`Reservation fulfilled for session ${session.id}`);

        } catch (error) {
            console.error('Error creating ticket records:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // Handle expired checkout — release reserved tickets back to availability
    if (event.type === 'checkout.session.expired') {
        const session = event.data.object;
        const metadata = session.metadata;

        if (!metadata || !metadata.reservationToken) {
            console.log('Skipping expired session - no reservation token');
            return res.status(200).json({ received: true });
        }

        try {
            // Mark Reservations rows as Released. Idempotent — safe on Stripe retries.
            await markReservationsByToken(metadata.reservationToken, 'Released', 'Expired');
            console.log(`Reservation released for expired session ${session.id}`);
        } catch (error) {
            console.error('CRITICAL: Failed to release reservation for expired session:', error);
            // Return 500 so Stripe retries the webhook
            return res.status(500).json({ error: 'Failed to release reservations' });
        }
    }

    return res.status(200).json({ received: true });
};

// Look up records in a given Airtable table by Stripe Session ID.
// Used for idempotency: skip ticket/Send-Tickets creation on webhook retries.
async function fetchRecordsBySessionId(tableId, stripeSessionId) {
    const safeId = String(stripeSessionId).replace(/'/g, "\\'");
    const formula = encodeURIComponent(`{Stripe Session ID} = '${safeId}'`);
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to fetch records by Session ID: ${error}`);
    }

    const data = await response.json();
    return data.records || [];
}

async function createSendTicketsRecord(stripeSessionId) {
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.sendTicketsTableId}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: {
                'Stripe Session ID': stripeSessionId
            }
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create Send Tickets record: ${error}`);
    }

    return await response.json();
}

async function createTicketRecord(ticketData) {
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}`;
    
    const fields = {
        'Event Name': [ticketData.eventId],
        'First Name': ticketData.firstName,
        'Surname': ticketData.surname,
        'Email': ticketData.attendeeEmail,
        'Mobile Phone Number': ticketData.phone,
        'Post Code': ticketData.postcode,
        'Stripe Session ID': ticketData.stripeSessionId,
        'Amount Paid': ticketData.amountPaid,
        'Status': 'Valid',
        'Currency': ticketData.currency,
        'Mailing List Opt In': ticketData.mailingListOptIn
    };

    if (ticketData.ticketNumber !== null && ticketData.totalTickets !== null) {
        fields['Ticket Number'] = `${ticketData.ticketNumber} of ${ticketData.totalTickets}`;
    }

    // Add Stripe fee if available
    if (ticketData.stripeFee !== null && ticketData.stripeFee !== undefined) {
        fields['Stripe Fees'] = ticketData.stripeFee;
    }
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create ticket: ${error}`);
    }

    return await response.json();
}

// Mark Reservations-table rows for a given Reservation Token to a terminal status.
// Looked up by Reservation Token (set by create-ticket-checkout.js when reserving).
// Idempotent — Stripe webhook retries simply re-PATCH to the same status. No drift.
async function markReservationsByToken(reservationToken, status, reason) {
    if (!reservationToken) {
        console.log('markReservationsByToken: no token in metadata, skipping');
        return;
    }

    // Escape single quotes to keep the formula safe (token is a UUID so unlikely but defensive)
    const safeToken = String(reservationToken).replace(/'/g, "\\'");

    const records = await base(RESERVATIONS_TABLE).select({
        filterByFormula: `{Reservation Token} = '${safeToken}'`,
        maxRecords: 100
    }).all();

    if (records.length === 0) {
        console.log(`No reservation rows found for token ${reservationToken}`);
        return;
    }

    const fields = {
        'Status': status,
        'Released At': new Date().toISOString(),
        'Released Reason': reason
    };

    await Promise.all(records.map(async (record) => {
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${RESERVATIONS_TABLE}/${record.id}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to mark reservation row ${record.id}: ${error}`);
        }
    }));

    console.log(`Marked ${records.length} reservation row(s) as ${status} (${reason}) for token ${reservationToken}`);
}

