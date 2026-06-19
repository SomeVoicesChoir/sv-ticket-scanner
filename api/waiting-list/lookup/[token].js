// Validate a waiting-list redemption token and return the details the
// Squarespace redemption page needs to render: event info + prefilled
// customer fields.

const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

const WAITING_LIST_TABLE = 'Waiting List';

function fv(field, fallback = '') {
    if (!field) return fallback;
    if (Array.isArray(field)) return field[0] || fallback;
    return field || fallback;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Missing token' });
    }

    try {
        // Strip BOM + zero-width chars that Airtable's rich-text email editor
        // sometimes injects around dragged blue pills inside <a href="..."> —
        // URL-encoded these become %EF%BB%BF and break the strict token match.
        const cleanToken = String(token).replace(/[﻿​-‍⁠]/g, '').trim();
        const safeToken = cleanToken.replace(/'/g, "\\'");
        const formula = encodeURIComponent(`{Redemption Token} = '${safeToken}'`);
        const lookupUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(WAITING_LIST_TABLE)}?filterByFormula=${formula}&maxRecords=1`;

        const wlResp = await fetch(lookupUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!wlResp.ok) {
            return res.status(500).json({ error: 'Could not validate this link. Please try again.' });
        }

        const wlData = await wlResp.json();
        const wlRow = (wlData.records || [])[0];

        if (!wlRow) {
            return res.status(404).json({ error: 'This link is not valid.' });
        }

        const status = wlRow.fields['Status'];
        const expiresAtStr = wlRow.fields['Token Expires At'];

        // Reject anything that isn't an active Notified entry
        if (status !== 'Notified') {
            const msg =
                status === 'Converted' ? 'You have already used this link to purchase your ticket.' :
                status === 'Expired'   ? 'This invitation has expired. We will email you again if another ticket opens up.' :
                                         'This link is no longer valid.';
            return res.status(410).json({ error: msg });
        }

        if (expiresAtStr && new Date(expiresAtStr).getTime() < Date.now()) {
            return res.status(410).json({ error: 'This invitation has expired.' });
        }

        // Fetch the linked Event for display details
        const eventLinks = wlRow.fields['Event'] || [];
        if (eventLinks.length === 0) {
            return res.status(500).json({ error: 'No event linked to this invitation.' });
        }
        const eventId = eventLinks[0];

        const eventUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.eventTableId}/${eventId}`;
        const eventResp = await fetch(eventUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!eventResp.ok) {
            return res.status(500).json({ error: 'Could not fetch event details' });
        }

        const event = await eventResp.json();

        return res.status(200).json({
            ok: true,
            token: token,
            expiresAt: expiresAtStr,
            event: {
                id: event.id,
                name: fv(event.fields['Event Name']),
                ticketTypePrice: fv(event.fields['Ticket Type + Price']) || fv(event.fields['Ticket Type']),
                price: event.fields['Ticket Price'] || 0,
                bookingFee: event.fields['Booking Fee'] || 0,
                dateTime: fv(event.fields['Date + Time Friendly']) || fv(event.fields['Date Friendly']),
                venueAddress: fv(event.fields['Venue Address']),
                currency: event.fields['Currency'] || 'GBP'
            },
            customer: {
                firstName: wlRow.fields['First Name'] || '',
                surname: wlRow.fields['Surname'] || '',
                email: wlRow.fields['Email'] || '',
                phone: wlRow.fields['Phone'] || '',
                quantityWanted: wlRow.fields['Quantity Wanted'] || 1
            }
        });

    } catch (error) {
        console.error('Waiting-list lookup error:', error);
        return res.status(500).json({ error: error.message });
    }
};
