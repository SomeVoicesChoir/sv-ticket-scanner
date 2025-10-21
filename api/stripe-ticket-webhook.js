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
    // In the checkout.session.completed handler, after getting the session:
// In the checkout.session.completed handler:
if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;

    if (!metadata.eventId) {
        console.log('⏭️ Skipping - not a ticket purchase');
        return res.status(200).json({ received: true, skipped: 'not a ticket' });
    }

    try {
        const quantity = parseInt(metadata.quantity);
        
        // ✅ Get the receipt number from the charge
        let receiptNumber = '';
        if (session.payment_intent) {
            try {
                // Retrieve the payment intent to get the charge
                const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
                
                // Get the first charge from the payment intent
                if (paymentIntent.charges && paymentIntent.charges.data.length > 0) {
                    const charge = paymentIntent.charges.data[0];
                    receiptNumber = charge.receipt_number || ''; // This is the "Receipt #XXXX-XXXX" format
                }
            } catch (error) {
                console.error('Error fetching receipt number:', error);
                // Continue without receipt number rather than failing
            }
        }
        
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
                postcode: metadata.postcode,
                dateTime: metadata.dateTime,
                venueAddress: metadata.venueAddress,
                stripeSessionId: session.id,
                invoiceNumber: receiptNumber, // ✅ Now contains the receipt number
                amountPaid: session.amount_total / 100,
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
                'Invoice Number': ticketData.invoiceNumber, // ✅ Add this
                'Amount Paid': ticketData.amountPaid,
                'Ticket Number': `${ticketData.ticketNumber} of ${ticketData.totalTickets}`,
                'Status': 'Valid',
                'Currency': ticketData.currency
            }
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create ticket: ${error}`);
    }

    return await response.json();
}