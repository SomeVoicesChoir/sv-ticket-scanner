const fetch = require('node-fetch');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID, // Your Tickets table
    apiKey: process.env.AIRTABLE_API_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Verify webhook signature
        event = stripe.webhooks.constructEvent(
            req.body,
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

        try {
            const quantity = parseInt(metadata.quantity);
            
            // Create multiple ticket records (one per quantity)
            const ticketPromises = [];
            for (let i = 0; i < quantity; i++) {
                ticketPromises.push(createTicketRecord({
                    eventId: metadata.eventId,
                    eventName: metadata.eventName,
                    firstName: metadata.firstName,
                    surname: metadata.surname,
                    attendeeEmail: metadata.attendeeEmail,
                    phone: metadata.phone,
                    dateTime: metadata.dateTime,
                    venueAddress: metadata.venueAddress,
                    stripeSessionId: session.id,
                    amountPaid: session.amount_total / 100, // Convert cents to dollars/pounds
                    ticketNumber: i + 1,
                    totalTickets: quantity,
                    currency: metadata.currency || 'GBP'
                }));
            }

            await Promise.all(ticketPromises);
            console.log(`✅ Created ${quantity} tickets for event ${metadata.eventName}`);

        } catch (error) {
            console.error('Error creating ticket records:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(200).json({ received: true });
};

async function createTicketRecord(ticketData) {
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}`;
    
    // These field names MUST match your Airtable Tickets table exactly
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: {
                'Event Name': [ticketData.eventId],                          // ⚠️ MUST MATCH AIRTABLE - Linked record
                'First Name': ticketData.firstName,                          // ⚠️ MUST MATCH AIRTABLE
                'Surname': ticketData.surname,                               // ⚠️ MUST MATCH AIRTABLE
                'Email': ticketData.attendeeEmail,                           // ⚠️ MUST MATCH AIRTABLE
                'Mobile Phone Number': ticketData.phone,                     // ⚠️ MUST MATCH AIRTABLE
                'Date + Time Friendly': ticketData.dateTime,                 // ⚠️ MUST MATCH AIRTABLE
                // 'Event Address' is a lookup field, so we don't set it - it pulls from linked Event Name
                'Stripe Session ID': ticketData.stripeSessionId,             // ⚠️ MUST MATCH AIRTABLE
                'Amount Paid': ticketData.amountPaid,                        // ⚠️ MUST MATCH AIRTABLE
                'Ticket Number': `${ticketData.ticketNumber} of ${ticketData.totalTickets}`, // ⚠️ MUST MATCH AIRTABLE
                'Status': 'Valid',                                           // ⚠️ MUST MATCH AIRTABLE
                'Currency': ticketData.currency                              // ⚠️ MUST MATCH AIRTABLE
            }
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create ticket: ${error}`);
    }

    return await response.json();
}