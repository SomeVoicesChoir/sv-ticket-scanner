const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

// Look up Ticket record IDs by Stripe Session ID.
// Used by the ticket-success page to render "Add to Apple Wallet" buttons
// immediately after purchase, before the customer has to check their email.
module.exports = async function handler(req, res) {
    // CORS — Squarespace embed calls this from somevoices.co.uk
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { sessionId } = req.query;

    // Validate format — Stripe session IDs look like cs_test_/cs_live_;
    // free-ticket sessions use free_<timestamp>_<rand>.
    if (!sessionId || !/^(cs_(test|live)_[A-Za-z0-9]+|free_[A-Za-z0-9_]+)$/.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
    }

    try {
        // Escape single quotes defensively (Stripe IDs don't contain them but belt-and-braces)
        const safeSessionId = String(sessionId).replace(/'/g, "\\'");
        const formula = encodeURIComponent(`{Stripe Session ID} = '${safeSessionId}'`);
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}?filterByFormula=${formula}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Airtable error: ${error}`);
        }

        const data = await response.json();
        const tickets = (data.records || []).map(rec => ({
            recordId: rec.id,
            ticketNumber: rec.fields['Ticket Number'] || ''
        }));

        // ready=false signals "webhook hasn't completed yet, poll again in a moment"
        return res.status(200).json({
            sessionId,
            ready: tickets.length > 0,
            ticketCount: tickets.length,
            tickets
        });

    } catch (error) {
        console.error('Error fetching tickets by session:', error);
        return res.status(500).json({ error: error.message });
    }
};
