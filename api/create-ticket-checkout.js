const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    try {
        const { selectedTickets, firstName, surname, attendeeEmail, phone, postcode } = req.body;

        if (!selectedTickets || selectedTickets.length === 0) {
            return res.status(400).json({ error: 'No tickets selected' });
        }

        if (!firstName || !surname || !attendeeEmail || !phone || !postcode) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Calculate total tickets
        const totalQuantity = selectedTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);

        // Build Stripe line items from selected tickets
        const lineItems = selectedTickets.map(ticket => ({
            price: ticket.stripePriceId,
            quantity: ticket.quantity
        }));

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
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `https://somevoices.co.uk/ticket-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: 'https://somevoices.co.uk/ticket-incomplete',
            customer_email: attendeeEmail,
            automatic_tax: { enabled: true },
            custom_text: {
                submit: {
                    message: `Thank you for purchasing tickets to ${eventNamesList}! Your ticket(s) will be sent to your email address one or two weeks prior to the event date.`
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
                currency: firstTicket.currency
            }
        });

        return res.status(200).json({ sessionId: session.id });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return res.status(500).json({ error: error.message });
    }
};