const fetch = require('node-fetch');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
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

    const { 
        eventId, 
        eventName,
        stripePriceId, 
        quantity, 
        firstName,
        surname,
        attendeeEmail,
        phone,
        postcode,
        dateTime,
        venueAddress,
        currency
    } = req.body;

    // Update validation
if (!eventId || !stripePriceId || !quantity || !firstName || !surname || !attendeeEmail || !phone || !postcode) {
    return res.status(400).json({ error: 'Missing required fields' });
}

    try {
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
            automatic_tax: { enabled: true },
            
            // ✅ Override global receipt text with ticket-specific text
    custom_text: {
        submit: {
            message: `Thank you for purchasing tickets to ${eventName}! Your ticket(s) will be sent to your email address one or two weeks prior to the event date.`
        }
    },
            
            // ✅ Custom statement descriptor for bank statements
            payment_intent_data: {
                statement_descriptor: 'SomeVoices Event',
                description: `Ticket for ${eventName}`
            },
            
            metadata: {
                eventId: eventId,
                eventName: eventName,
                quantity: quantity.toString(),
                firstName: firstName,
                surname: surname,
                attendeeEmail: attendeeEmail,
                phone: phone,
                postcode: postcode,
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