const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    issuerId: process.env.GOOGLE_WALLET_ISSUER_ID,
    classId: process.env.GOOGLE_WALLET_PASS_CLASS_ID
};

// Airtable lookup fields come back as arrays — unwrap to the first value.
function fv(field, fallback = '') {
    if (!field) return fallback;
    if (Array.isArray(field)) return field[0] || fallback;
    return field || fallback;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { ticketId } = req.query;
    if (!ticketId || !/^rec[A-Za-z0-9]+$/.test(ticketId)) {
        return res.status(400).json({ error: 'Invalid ticket ID' });
    }

    if (!CONFIG.issuerId || !CONFIG.classId) {
        return res.status(500).json({ error: 'Google Wallet not configured (missing issuerId or classId env vars)' });
    }

    try {
        // 1. Fetch the ticket record from Airtable
        const ticketUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}/${ticketId}`;
        const ticketResponse = await fetch(ticketUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!ticketResponse.ok) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const { fields } = await ticketResponse.json();

        const attendeeName = fv(fields['Name'], 'Guest');
        let eventName = fv(fields['Event Name for Ticket'], 'Event');
        if (typeof eventName === 'string') eventName = eventName.replace(/^"|"$/g, '');
        const dateFriendly = fv(fields['Date Friendly']);
        const doorsPerformance = fv(fields['Doors + Performance Time']);
        const venueAddress = fv(fields['Venue Address']);
        const ticketNumber = fv(fields['Ticket Number']);

        // 2. Build the Pass Object (one per ticket)
        const objectId = `${CONFIG.issuerId}.ticket-${ticketId}`;

        const passObject = {
            id: objectId,
            classId: CONFIG.classId,
            state: 'ACTIVE',
            barcode: {
                type: 'QR_CODE',
                value: ticketId,
                alternateText: ticketNumber || ''
            },
            ticketHolderName: attendeeName,
            ticketNumber: ticketNumber || undefined,
            // Custom text modules for event-specific details (event name varies per ticket,
            // so we put it here rather than locking it to one value on the class)
            textModulesData: [
                eventName ? { id: 'event', header: 'EVENT', body: eventName } : null,
                dateFriendly ? { id: 'date', header: 'DATE', body: dateFriendly } : null,
                doorsPerformance ? { id: 'doors', header: 'DOORS', body: doorsPerformance } : null,
                venueAddress ? { id: 'venue', header: 'VENUE', body: venueAddress } : null
            ].filter(Boolean),
            hexBackgroundColor: '#f4dbc0'
        };

        // 3. Sign the JWT with the service account private key
        const serviceAccount = JSON.parse(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON);

        const claims = {
            iss: serviceAccount.client_email,
            aud: 'google',
            origins: ['https://somevoices.co.uk', 'https://sv-ticket-scanner.vercel.app'],
            typ: 'savetowallet',
            payload: {
                eventTicketObjects: [passObject]
            }
        };

        const token = jwt.sign(claims, serviceAccount.private_key, { algorithm: 'RS256' });
        const saveUrl = `https://pay.google.com/gp/v/save/${token}`;

        // 4. 302 redirect the customer to Google's save URL
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, saveUrl);

    } catch (error) {
        console.error('Error generating Google Wallet pass:', error);
        return res.status(500).json({ error: error.message });
    }
};
