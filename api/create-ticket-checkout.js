const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const fetch = require('node-fetch');

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    sendTicketsTableId: process.env.AIRTABLE_SEND_TICKETS_TABLE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Track reservations outside try so catch can rollback on Stripe/unexpected errors
    const reservations = [];

    try {
        const {
            selectedTickets,
            firstName,
            surname,
            attendeeEmail,
            phone,
            postcode,
            mailingListOptIn,
            companionTicket,
            companionTicketDetails
        } = req.body;

        if (!selectedTickets || selectedTickets.length === 0) {
            return res.status(400).json({ error: 'No tickets selected' });
        }

        if (!firstName || !surname || !attendeeEmail || !phone || !postcode) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate every ticket has an eventId
        const invalidTicket = selectedTickets.find(t => !t.eventId);
        if (invalidTicket) {
            return res.status(400).json({ error: 'Invalid ticket data. Please refresh the page and try again.' });
        }

        // BACKEND VALIDATION + RESERVATION: Check availability then reserve tickets
        // Reservations are tracked via the 'Reserved' field on the Event table.
        // Tickets Remaining formula = Allocation - Tickets Sold - Reserved

        for (const ticket of selectedTickets) {
            try {
                const record = await base('Event').find(ticket.eventId);
                const ticketsRemaining = record.get('Tickets Remaining');
                const currentReserved = record.get('Reserved') || 0;

                if (ticketsRemaining === undefined || ticketsRemaining === null) {
                    await rollbackReservations(reservations);
                    return res.status(400).json({
                        error: `Unable to verify ticket availability for ${ticket.eventName}`
                    });
                }

                if (ticketsRemaining <= 0) {
                    await rollbackReservations(reservations);
                    return res.status(400).json({
                        error: `Sorry, ${ticket.eventName} is sold out.`
                    });
                }

                if (ticket.quantity > ticketsRemaining) {
                    await rollbackReservations(reservations);
                    return res.status(400).json({
                        error: `Only ${ticketsRemaining} ticket(s) remaining for ${ticket.eventName}. You requested ${ticket.quantity}.`
                    });
                }

                // RESERVE: increment the Reserved field immediately
                const newReserved = currentReserved + ticket.quantity;
                await updateAirtableRecord(CONFIG.eventTableId, ticket.eventId, {
                    'Reserved': newReserved
                });

                reservations.push({
                    eventId: ticket.eventId,
                    eventName: ticket.eventName,
                    quantity: ticket.quantity,
                    previousReserved: currentReserved
                });

                // VERIFY: re-read to check Tickets Remaining didn't go negative (race condition guard)
                const verifyRecord = await base('Event').find(ticket.eventId);
                const verifiedRemaining = verifyRecord.get('Tickets Remaining');
                if (verifiedRemaining < 0) {
                    // Another concurrent checkout squeezed in — rollback everything
                    await rollbackReservations(reservations);
                    return res.status(400).json({
                        error: `Sorry, ${ticket.eventName} just sold out. Please try again.`
                    });
                }

                console.log(`Reserved ${ticket.quantity} ticket(s) for ${ticket.eventName} (Reserved: ${currentReserved} → ${newReserved})`);
            } catch (airtableError) {
                console.error('Airtable reservation error:', airtableError);
                await rollbackReservations(reservations);
                return res.status(400).json({
                    error: 'Unable to reserve tickets. Please try again.'
                });
            }
        }

        // Calculate total tickets and total cost (including booking fees)
        const totalQuantity = selectedTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
        const totalCost = selectedTickets.reduce((sum, ticket) => {
            const ticketTotal = ticket.quantity * (ticket.price + (ticket.bookingFee || 0));
            return sum + ticketTotal;
        }, 0);

        // FREE TICKET PATH: bypass Stripe entirely when total is £0
        if (totalCost === 0) {
            console.log('Free ticket detected — bypassing Stripe');

            const freeSessionId = `free_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
            const firstTicket = selectedTickets[0];

            // Create Send Tickets record (same as webhook does)
            await createAirtableRecord(CONFIG.sendTicketsTableId, {
                'Stripe Session ID': freeSessionId
            });

            // Create individual ticket records
            const minimalTicketsData = selectedTickets.map(ticket => ({
                eventId: ticket.eventId,
                quantity: ticket.quantity,
                ticketType: ticket.ticketType
            }));

            let ticketNumber = 0;
            const ticketPromises = [];

            for (const ticketType of minimalTicketsData) {
                for (let i = 0; i < ticketType.quantity; i++) {
                    ticketNumber++;
                    ticketPromises.push(createAirtableRecord(CONFIG.tableId, {
                        'Event Name': [ticketType.eventId],
                        'First Name': firstName,
                        'Surname': surname,
                        'Email': attendeeEmail,
                        'Mobile Phone Number': phone,
                        'Post Code': postcode,
                        'Stripe Session ID': freeSessionId,
                        'Amount Paid': 0,
                        'Status': 'Valid',
                        'Currency': firstTicket.currency || 'GBP',
                        'Mailing List Opt In': mailingListOptIn || false,
                        'Ticket Number': `${ticketNumber} of ${totalQuantity}`
                    }));
                }
            }

            // Create companion ticket if requested
            if (companionTicket && companionTicketDetails) {
                ticketPromises.push(createAirtableRecord(CONFIG.tableId, {
                    'Event Name': [companionTicketDetails.eventId],
                    'First Name': firstName,
                    'Surname': surname,
                    'Email': attendeeEmail,
                    'Mobile Phone Number': phone,
                    'Post Code': postcode,
                    'Stripe Session ID': freeSessionId,
                    'Amount Paid': 0,
                    'Status': 'Valid',
                    'Currency': companionTicketDetails.currency || 'GBP',
                    'Mailing List Opt In': mailingListOptIn || false
                }));
            }

            await Promise.all(ticketPromises);
            console.log(`Created ${ticketPromises.length} free ticket(s) with session ID: ${freeSessionId}`);

            // Release reservations — tickets are now real (counted in Tickets Sold)
            await rollbackReservations(reservations);

            return res.status(200).json({
                free: true,
                redirectUrl: 'https://somevoices.co.uk/ticket-success'
            });
        }

        // PAID TICKET PATH: create Stripe checkout session

        // Build Stripe line items from selected tickets with custom names
        const lineItems = selectedTickets.map(ticket => ({
            price_data: {
                currency: ticket.currency.toLowerCase() || 'gbp',
                unit_amount: Math.round(ticket.price * 100),
                product_data: {
                    name: ticket.eventName,
                    description: `${ticket.ticketType} - ${ticket.dateTime}`,
                    metadata: {
                        original_price_id: ticket.stripePriceId
                    }
                }
            },
            quantity: ticket.quantity
        }));

        // Add booking fee line items (per ticket, shown separately)
        for (const ticket of selectedTickets) {
            if (ticket.bookingFee && ticket.bookingFee > 0) {
                lineItems.push({
                    price_data: {
                        currency: ticket.currency.toLowerCase() || 'gbp',
                        unit_amount: Math.round(ticket.bookingFee * 100),
                        product_data: {
                            name: 'Booking Fee',
                            description: `Booking fee for ${ticket.eventName}`
                        }
                    },
                    quantity: ticket.quantity
                });
            }
        }

        // Add companion ticket if requested
        if (companionTicket && companionTicketDetails) {
            lineItems.push({
                price_data: {
                    currency: companionTicketDetails.currency.toLowerCase() || 'gbp',
                    unit_amount: 0, // Free ticket
                    product_data: {
                        name: companionTicketDetails.eventName,
                        description: `${companionTicketDetails.ticketType} - ${companionTicketDetails.dateTime}`,
                        metadata: {
                            original_price_id: companionTicketDetails.stripePriceId,
                            is_companion: 'true'
                        }
                    }
                },
                quantity: 1
            });
        }

        // Get first ticket for shared metadata
        const firstTicket = selectedTickets[0];

        // Build event names list for thank you message
        const eventNamesList = [...new Set(selectedTickets.map(t => t.eventName))].join(', ');

        // Trim ticket data to essential fields only (stay under 500 chars)
        const minimalTicketsData = selectedTickets.map(ticket => ({
            eventId: ticket.eventId,
            quantity: ticket.quantity,
            ticketType: ticket.ticketType
        }));

        // Create Stripe checkout session with multiple line items
        // Stripe minimum expires_at is 30 minutes from now
        const expiresAt = Math.floor(Date.now() / 1000) + 1800; // 30 minutes

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            expires_at: expiresAt,
            allow_promotion_codes: true,
            success_url: `https://somevoices.co.uk/ticket-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: 'https://somevoices.co.uk/ticket-incomplete',
            customer_email: attendeeEmail,
            automatic_tax: { enabled: true },
            custom_text: {
                submit: {
                    message: `We're holding these tickets for you for 10 minutes. Please complete checkout within that time or your order will expire.`
                }
            },
            payment_intent_data: {
                statement_descriptor: 'SomeVoices Event',
                description: `Ticket for ${eventNamesList}`
            },
            metadata: {
                firstName: firstName,
                surname: surname,
                attendeeEmail: attendeeEmail,
                phone: phone,
                postcode: postcode,
                ticketsData: JSON.stringify(minimalTicketsData),
                totalQuantity: totalQuantity.toString(),
                eventName: firstTicket.eventName,
                dateTime: firstTicket.dateTime,
                venueAddress: firstTicket.venueAddress,
                currency: firstTicket.currency,
                stripePriceId: firstTicket.stripePriceId,
                mailingListOptIn: mailingListOptIn ? 'true' : 'false',
                // Add companion ticket metadata
                companionTicket: companionTicket ? 'true' : 'false',
                companionTicketData: companionTicket ? JSON.stringify({
                    eventId: companionTicketDetails.eventId,
                    ticketType: companionTicketDetails.ticketType
                }) : '',
                // Reservation data so webhook can release on expiry
                reservationData: JSON.stringify(
                    reservations.map(r => ({ eventId: r.eventId, quantity: r.quantity }))
                )
            }
        });

        console.log(`Checkout session ${session.id} created, expires at ${new Date(expiresAt * 1000).toISOString()}`);
        return res.status(200).json({ sessionId: session.id, expiresAt });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        // Rollback any reservations made before the error
        if (reservations.length > 0) {
            console.log(`Rolling back ${reservations.length} reservation(s) due to error`);
            await rollbackReservations(reservations);
        }
        return res.status(500).json({ error: error.message });
    }
};

// Rollback reservations by restoring the Reserved field to its previous value
async function rollbackReservations(reservations) {
    for (const r of reservations) {
        try {
            await updateAirtableRecord(CONFIG.eventTableId, r.eventId, {
                'Reserved': r.previousReserved
            });
            console.log(`Rolled back reservation for ${r.eventName}: Reserved → ${r.previousReserved}`);
        } catch (err) {
            console.error(`CRITICAL: Failed to rollback reservation for ${r.eventName}:`, err);
        }
    }
}

// Helper to update (PATCH) a record in any Airtable table
async function updateAirtableRecord(tableId, recordId, fields) {
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${tableId}/${recordId}`;

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
        throw new Error(`Failed to update Airtable record: ${error}`);
    }

    return await response.json();
}

// Helper to create a record in any Airtable table
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
        const error = await response.text();
        throw new Error(`Failed to create Airtable record: ${error}`);
    }

    return await response.json();
}