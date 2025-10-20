const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    viewName: 'Currently onsale' // ⚠️ MUST MATCH your Airtable view name exactly
};

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.eventTableId}?view=${encodeURIComponent(CONFIG.viewName)}`;
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch events from Airtable');
        }

        const data = await response.json();
        
        // Format events for frontend
        // These field names MUST match your Airtable Event table exactly
        const events = data.records.map(record => ({
            id: record.id,
            name: record.fields['Event Name'] || 'Unnamed Event',           // ⚠️ MUST MATCH AIRTABLE
            price: record.fields['Ticket Price'] || 0,                       // ⚠️ MUST MATCH AIRTABLE
            stripePriceId: record.fields['Stripe Price ID'],                 // ⚠️ MUST MATCH AIRTABLE
            dateTime: record.fields['Date + Time Friendly'] || '',           // ⚠️ MUST MATCH AIRTABLE
            venueAddress: record.fields['Venue Address'] || '',              // ⚠️ MUST MATCH AIRTABLE
            currency: record.fields['Currency'] || 'GBP'                     // ⚠️ MUST MATCH AIRTABLE
        })).filter(event => event.stripePriceId); // Only return events with Stripe Price ID

        return res.status(200).json({ events });

    } catch (error) {
        console.error('Error fetching events:', error);
        return res.status(500).json({ error: error.message });
    }
};