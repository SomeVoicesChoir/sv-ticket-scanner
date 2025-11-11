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
    sendTicketsTableId: process.env.AIRTABLE_SEND_TICKETS_TABLE_ID, // ✅ NEW: Add this to your .env
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
            // ✅ NEW: Create Send Tickets record FIRST (before individual tickets)
            console.log('Creating Send Tickets record...');
            await createSendTicketsRecord(session.id);
            console.log('✅ Send Tickets record created');

            // Parse the tickets data
            const ticketsArray = JSON.parse(metadata.ticketsData);
            
            console.log(`Creating tickets for ${ticketsArray.length} ticket type(s)`);
            
            // Calculate total tickets for numbering (excluding companion)
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
                        mailingListOptIn: metadata.mailingListOptIn === 'true'
                    }));
                }
            });

            await Promise.all(ticketPromises);
            console.log(`✅ Created ${ticketPromises.length} tickets total`);

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
                    amountPaid: 0, // Free ticket
                    ticketType: companionData.ticketType, // Will be "ACCESS COMPANION"
                    ticketNumber: null, // Companion tickets don't get numbered
                    totalTickets: null,
                    currency: metadata.currency || 'GBP',
                    mailingListOptIn: metadata.mailingListOptIn === 'true',
                    isCompanion: true // Flag for companion ticket
                });
                
                console.log('✅ Created companion ticket');
            }

        } catch (error) {
            console.error('Error creating ticket records:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(200).json({ received: true });
};

// ✅ NEW: Function to create Send Tickets record
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
    
    // Build fields object
    const fields = {
        'Event Name': [ticketData.eventId], // ✅ This link will pull Ticket Type via lookup
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

    // Only add ticket number if it's not a companion ticket
    if (ticketData.ticketNumber !== null && ticketData.totalTickets !== null) {
        fields['Ticket Number'] = `${ticketData.ticketNumber} of ${ticketData.totalTickets}`;
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
```

**Key changes:**
1. ✅ Added `sendTicketsTableId` to CONFIG (you'll need to add this to your `.env` file)
2. ✅ Created new `createSendTicketsRecord()` function
3. ✅ Calls it BEFORE creating any tickets
4. ✅ Order is now: Send Tickets record → Individual tickets → Companion ticket

**What you need to do:**
Add to your `.env` or Vercel environment variables:
```
AIRTABLE_SEND_TICKETS_TABLE_ID=tblXXXXXXXXXX