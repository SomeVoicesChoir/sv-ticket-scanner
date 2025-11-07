const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

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

        // BACKEND VALIDATION: Check ticket availability in Airtable
        for (const ticket of selectedTickets) {
            try {
                const record = await base('Event').find(ticket.eventId);
                const ticketsRemaining = record.get('Tickets Remaining');
                
                if (ticketsRemaining === undefined || ticketsRemaining === null) {
                    return res.status(400).json({ 
                        error: `Unable to verify ticket availability for ${ticket.eventName}` 
                    });
                }
                
                if (ticketsRemaining <= 0) {
                    return res.status(400).json({ 
                        error: `Sorry, ${ticket.eventName} is sold out.` 
                    });
                }
                
                if (ticket.quantity > ticketsRemaining) {
                    return res.status(400).json({ 
                        error: `Only ${ticketsRemaining} ticket(s) remaining for ${ticket.eventName}. You requested ${ticket.quantity}.` 
                    });
                }
            } catch (airtableError) {
                console.error('Airtable validation error:', airtableError);
                return res.status(400).json({ 
                    error: 'Unable to verify ticket availability. Please try again.' 
                });
            }
        }

        // Calculate total tickets
        const totalQuantity = selectedTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);

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
                currency: firstTicket.currency,
                stripePriceId: firstTicket.stripePriceId,
                mailingListOptIn: mailingListOptIn ? 'true' : 'false',
                // Add companion ticket metadata
                companionTicket: companionTicket ? 'true' : 'false',
                companionTicketData: companionTicket ? JSON.stringify({
                    eventId: companionTicketDetails.eventId,
                    ticketType: companionTicketDetails.ticketType
                }) : ''
            }
        });

        return res.status(200).json({ sessionId: session.id });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return res.status(500).json({ error: error.message });
    }
};