const fetch = require('node-fetch');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ✅ CRITICAL: Tell Vercel to NOT parse the body - we need raw bytes for signature verification
export const config = {
    api: {
        bodyParser: false,
    },
};

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    webhookSecret: process.env.STRIPE_TICKET_WEBHOOK_SECRET
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    
    // ✅ Get the raw body as a buffer
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
            console.log('⏭️ Skipping - not a ticket purchase');
            return res.status(200).json({ received: true, skipped: 'not a ticket' });
        }

        try {
            // Parse the tickets data
            const ticketsArray = JSON.parse(metadata.ticketsData);
            
            console.log(`Creating tickets for ${ticketsArray.length} ticket type(s)`);
            
            // Calculate total tickets for numbering
            const totalTickets = ticketsArray.reduce((sum, t) => sum + t.quantity, 0);
            
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
                        mailingListOptIn: metadata.mailingListOptIn === 'true'  // Add this line
                    }));
                }
            });

            await Promise.all(ticketPromises);
            console.log(`✅ Created ${ticketPromises.length} tickets total`);

        } catch (error) {
            console.error('Error creating ticket records:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(200).json({ received: true });
};

async function createTicketRecord(ticketData) {
    const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: {
                'Event Name': [ticketData.eventId],
                'First Name': ticketData.firstName,
                'Surname': ticketData.surname,
                'Email': ticketData.attendeeEmail,
                'Mobile Phone Number': ticketData.phone,
                'Post Code': ticketData.postcode,
                'Stripe Session ID': ticketData.stripeSessionId,
                // 'Send Tickets Table' will be populated by Airtable automation
                'Amount Paid': ticketData.amountPaid,
                'Ticket Number': `${ticketData.ticketNumber} of ${ticketData.totalTickets}`,
                'Status': 'Valid',
                'Currency': ticketData.currency,
                'Mailing List Opt In': ticketData.mailingListOptIn  // Add this line
            }
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create ticket: ${error}`);
    }

    return await response.json();
}