const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { recordId, scannerName } = req.body;

    if (!recordId || !scannerName) {
        return res.status(400).json({ error: 'Record ID and scanner name are required' });
    }

    try {
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}/${recordId}`;
        
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: {
                    'Checked In': true,
                    'Check-in Time': new Date().toISOString(),
                    'Check-in By': scannerName
                }
            })
        });

        if (!response.ok) {
            throw new Error('Failed to check in ticket');
        }

        const data = await response.json();

        return res.status(200).json({
            success: true,
            ticket: {
                name: data.fields['Name'] || 'Unknown',
                event: data.fields['Event'] || []
            }
        });

    } catch (error) {
        console.error('Error checking in ticket:', error);
        return res.status(500).json({ error: error.message });
    }
};