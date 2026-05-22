const path = require('path');
const fetch = require('node-fetch');
const { PKPass } = require('passkit-generator');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

const TEMPLATE_DIR = path.join(process.cwd(), 'lib/wallet/apple-template.pass');

function fv(field, fallback = '') {
    if (!field) return fallback;
    if (Array.isArray(field)) return field[0] || fallback;
    return field || fallback;
}

async function buildPass(ticketId, fields) {
    const attendeeName = fv(fields['Name'], 'Guest');
    let eventName = fv(fields['Event Name for Ticket'], 'Event');
    if (typeof eventName === 'string') eventName = eventName.replace(/^"|"$/g, '');

    const dateFriendly = fv(fields['Date Friendly']);
    const doorsPerformance = fv(fields['Doors + Performance Time']);
    const ticketTypePrice = fv(fields['Ticket Type + Price']);
    const venueAddress = fv(fields['Venue Address']);
    const ticketNumber = fv(fields['Ticket Number']);
    const admissionInstructions = fv(fields['Admission Instructions']);
    const status = fields['Status'] || 'Valid';

    const pass = await PKPass.from({
        model: TEMPLATE_DIR,
        certificates: {
            wwdr: process.env.APPLE_PASS_WWDR_PEM,
            signerCert: process.env.APPLE_PASS_CERT_PEM,
            signerKey: process.env.APPLE_PASS_KEY_PEM,
            signerKeyPassphrase: process.env.APPLE_PASS_KEY_PASSPHRASE
        }
    }, {
        serialNumber: ticketId,
        description: `Some Voices Ticket: ${eventName}`
    });

    if (dateFriendly) {
        pass.headerFields.push({ key: 'date', label: 'DATE', value: dateFriendly });
    }
    pass.primaryFields.push({ key: 'event', label: 'EVENT', value: eventName });
    pass.secondaryFields.push({ key: 'name', label: 'NAME', value: attendeeName });
    if (ticketNumber) {
        pass.secondaryFields.push({ key: 'ticket', label: 'TICKET', value: ticketNumber });
    }
    if (doorsPerformance) {
        pass.auxiliaryFields.push({ key: 'doors', label: 'DOORS', value: doorsPerformance });
    }
    if (venueAddress) {
        pass.backFields.push({ key: 'venue', label: 'Venue', value: venueAddress });
    }
    if (ticketTypePrice) {
        pass.backFields.push({ key: 'ticketType', label: 'Ticket Type', value: ticketTypePrice });
    }
    if (admissionInstructions) {
        pass.backFields.push({ key: 'admission', label: 'Admission', value: admissionInstructions });
    }
    pass.backFields.push({ key: 'ticketId', label: 'Ticket ID', value: ticketId });
    pass.backFields.push({ key: 'status', label: 'Status', value: status });

    pass.setBarcodes({
        message: ticketId,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
        altText: ticketNumber || ''
    });

    return pass;
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

        // Single ticket — short-circuit and return as a regular .pkpass
        if (ticketRecords.length === 1) {
            const r = ticketRecords[0];
            const pass = await buildPass(r.id, r.fields);
            const buffer = pass.getAsBuffer();
            res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
            res.setHeader('Content-Disposition', `attachment; filename="some-voices-ticket-${r.id}.pkpass"`);
            res.setHeader('Cache-Control', 'no-store');
            return res.send(buffer);
        }

        // Multi-ticket — build all passes then pack into a .pkpasses bundle
        const passes = await Promise.all(
            ticketRecords.map(r => buildPass(r.id, r.fields))
        );

        const bundle = await PKPass.pack(...passes);
        const buffer = bundle.getAsBuffer ? bundle.getAsBuffer() : bundle;

        res.setHeader('Content-Type', 'application/vnd.apple.pkpasses');
        res.setHeader('Content-Disposition', `attachment; filename="some-voices-tickets-${sessionId}.pkpasses"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buffer);

    } catch (error) {
        console.error('Error generating Apple Wallet bundle:', error);
        return res.status(500).json({ error: error.message });
    }
};
