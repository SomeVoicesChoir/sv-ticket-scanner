const fetch = require('node-fetch');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { 
        eventId, 
        eventName,
        stripePriceId, 
        quantity, 
        firstName,
        surname,
        attendeeEmail,
        phone,
        dateTime,
        venueAddress,
        currency
    } = req.body;

    // Validate required fields
    if (!eventId || !stripePriceId || !quantity || !firstName || !surname || !attendeeEmail || !phone) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: stripePriceId,
                quantity: parseInt(quantity)
            }],
            mode: 'payment',
            success_url: `https://somevoices.co.uk/ticket-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: 'https://somevoices.co.uk/ticket-incomplete',
            customer_email: attendeeEmail,
            // Store all data in metadata so webhook can create ticket records
            metadata: {
                eventId: eventId,
                eventName: eventName,
                quantity: quantity.toString(),
                firstName: firstName,
                surname: surname,
                attendeeEmail: attendeeEmail,
                phone: phone,
                dateTime: dateTime || '',
                venueAddress: venueAddress || '',
                currency: currency || 'GBP'
            }
        });

        return res.status(200).json({ sessionId: session.id });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return res.status(500).json({ error: error.message });
    }
};