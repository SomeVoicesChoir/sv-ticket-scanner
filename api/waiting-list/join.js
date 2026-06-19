const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

// Waiting List table referenced by name (URL-encoded in fetch URLs).
const WAITING_LIST_TABLE = 'Waiting List';

// Airtable lookup fields come back as arrays — unwrap to first value.
function fv(field, fallback = '') {
    if (!field) return fallback;
    if (Array.isArray(field)) return field[0] || fallback;
    return field || fallback;
}

module.exports = async function handler(req, res) {
    // CORS — Squarespace embed posts from somevoices.co.uk
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { eventId, email, firstName, surname, phone, quantityWanted } = req.body || {};

        // ── Validate inputs ──────────────────────────────────────
        if (!eventId || typeof eventId !== 'string') {
            return res.status(400).json({ error: 'Missing event' });
        }
        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return res.status(400).json({ error: 'Please enter a valid email' });
        }
        if (!firstName || !surname) {
            return res.status(400).json({ error: 'Please enter your name' });
        }
        const qty = parseInt(quantityWanted, 10);
        if (!Number.isFinite(qty) || qty < 1 || qty > 10) {
            return res.status(400).json({ error: 'Please choose a quantity between 1 and 10' });
        }

        // ── Verify the event exists ──────────────────────────────
        const eventUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.eventTableId}/${eventId}`;
        const eventResp = await fetch(eventUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });
        if (!eventResp.ok) {
            return res.status(400).json({ error: 'Event not found' });
        }
        const eventRecord = await eventResp.json();
        const eventName = eventRecord.fields['Event Name'] || 'this event';

        // ── Prevent duplicate waiting list entries for the same email + event ──
        // ARRAYJOIN on a linked-record field returns the primary field text of the
        // linked records (event names), NOT their record IDs — so we can't filter
        // by event ID in the formula. Instead: filter by email + status server-side,
        // then check the linked event in code.
        const safeEmail = String(email).toLowerCase().replace(/'/g, "\\'");
        const dupFormula = encodeURIComponent(
            `AND(LOWER({Email}) = '${safeEmail}', {Status} = 'Waiting')`
        );
        const dupUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(WAITING_LIST_TABLE)}?filterByFormula=${dupFormula}`;
        const dupResp = await fetch(dupUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });
        if (dupResp.ok) {
            const dupData = await dupResp.json();
            const hasDuplicate = (dupData.records || []).some(r => {
                const linkedEvents = r.fields['Event'] || [];
                return Array.isArray(linkedEvents) && linkedEvents.includes(eventId);
            });
            if (hasDuplicate) {
                return res.status(409).json({
                    error: `You're already on the waiting list for ${eventName}. We'll email you if a seat becomes available.`
                });
            }
        }

        // ── Create the Waiting List row ──────────────────────────
        const createUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(WAITING_LIST_TABLE)}`;
        const createResp = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: {
                    'Email': email.trim(),
                    'First Name': firstName.trim(),
                    'Surname': surname.trim(),
                    'Phone': (phone || '').trim(),
                    'Event': [eventId],
                    'Quantity Wanted': qty,
                    'Status': 'Waiting'
                }
            })
        });

        if (!createResp.ok) {
            const errText = await createResp.text();
            console.error('Airtable create failed:', errText);
            return res.status(500).json({ error: 'Could not add you to the waiting list. Please try again.' });
        }

        const created = await createResp.json();

        console.log(`Waiting list joined: ${email} → ${eventName} (record ${created.id})`);

        return res.status(200).json({
            success: true,
            recordId: created.id,
            eventName,
            message: `You're on the waiting list for ${eventName}. We'll email you if a seat becomes available.`
        });

    } catch (error) {
        console.error('Error joining waiting list:', error);
        return res.status(500).json({ error: error.message });
    }
};
