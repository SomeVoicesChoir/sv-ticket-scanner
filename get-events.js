const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    eventNameField: 'Event Name'
};

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.eventTableId}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load events');
        }

        const data = await response.json();
        const events = data.records.map(record => ({
            id: record.id,
            name: record.fields[CONFIG.eventNameField] || 'Unnamed Event'
        }));

        // Sort alphabetically
        events.sort((a, b) => a.name.localeCompare(b.name));

        return res.status(200).json({ events });

    } catch (error) {
        console.error('Error fetching events:', error);
        return res.status(500).json({ error: error.message });
    }
};