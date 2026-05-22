const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    issuerId: process.env.GOOGLE_WALLET_ISSUER_ID,
    classId: process.env.GOOGLE_WALLET_PASS_CLASS_ID
};

function fv(field, fallback = '') {
    if (!field) return fallback;
    if (Array.isArray(field)) return field[0] || fallback;
    return field || fallback;
}

function buildPassObject(ticketId, fields) {
    const attendeeName = fv(fields['Name'], 'Guest');
    let eventName = fv(fields['Event Name for Ticket'], 'Event');
    if (typeof eventName === 'string') eventName = eventName.replace(/^"|"$/g, '');
    const dateFriendly = fv(fields['Date Friendly']);
    const doorsPerformance = fv(fields['Doors + Performance Time']);
    const venueAddress = fv(fields['Venue Address']);
    const ticketNumber = fv(fields['Ticket Number']);

    return {
        id: `${CONFIG.issuerId}.ticket-${ticketId}`,
        classId: CONFIG.classId,
        state: 'ACTIVE',
        barcode: {
            type: 'QR_CODE',
            value: ticketId,
            alternateText: ticketNumber || ''
        },
        ticketHolderName: attendeeName,
        ticketNumber: ticketNumber || undefined,
        textModulesData: [
            eventName ? { id: 'event', header: 'EVENT', body: eventName } : null,
            dateFriendly ? { id: 'date', header: 'DATE', body: dateFriendly } : null,
            doorsPerformance ? { id: 'doors', header: 'DOORS', body: doorsPerformance } : null,
            venueAddress ? { id: 'venue', header: 'VENUE', body: venueAddress } : null
        ].filter(Boolean),
        hexBackgroundColor: '#f4dbc0'
    };
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { sessionId } = req.query;
    if (!sessionId || !/^(cs_(test|live)_[A-Za-z0-9]+|free_[A-Za-z0-9_]+)$/.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
    }

    if (!CONFIG.issuerId || !CONFIG.classId) {
        return res.status(500).json({ error: 'Google Wallet not configured' });
    }

    try {
        // Fetch all tickets for this session
        const safeSessionId = String(sessionId).replace(/'/g, "\\'");
        const formula = encodeURIComponent(`{Stripe Session ID} = '${safeSessionId}'`);
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}?filterByFormula=${formula}`;

        const airtableResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!airtableResponse.ok) {
            return res.status(500).json({ error: 'Failed to fetch tickets' });
        }

        const data = await airtableResponse.json();
        const ticketRecords = data.records || [];

        if (ticketRecords.length === 0) {
            return res.status(404).json({ error: 'No tickets found for this session' });
        }

        // Build Pass Object array — one per ticket
        const passObjects = ticketRecords.map(r => buildPassObject(r.id, r.fields));

        // Sign single JWT containing all pass objects — one tap adds them all
        const serviceAccount = JSON.parse(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON);

        const claims = {
            iss: serviceAccount.client_email,
            aud: 'google',
            origins: ['https://somevoices.co.uk', 'https://sv-ticket-scanner.vercel.app'],
            typ: 'savetowallet',
            payload: {
                eventTicketObjects: passObjects
            }
        };

        const token = jwt.sign(claims, serviceAccount.private_key, { algorithm: 'RS256' });
        const saveUrl = `https://pay.google.com/gp/v/save/${token}`;

        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, saveUrl);

    } catch (error) {
        console.error('Error generating Google Wallet bundle:', error);
        return res.status(500).json({ error: error.message });
    }
};
