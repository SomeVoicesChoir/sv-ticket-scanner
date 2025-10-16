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

    const { recordId, selectedEventId } = req.body;

    if (!recordId) {
        return res.status(400).json({ error: 'Record ID is required' });
    }

    try {
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}/${recordId}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`
            }
        });

        if (!response.ok) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const record = await response.json();
        const fields = record.fields;

        // Check if ticket is for the correct event
        const ticketEventIds = fields['Event'] || [];
        const isCorrectEvent = ticketEventIds.includes(selectedEventId);

        // Check if already checked in
        const isCheckedIn = fields['Checked In'] || false;

        return res.status(200).json({
            success: true,
            ticket: {
                name: fields['Name'] || 'Unknown',
                event: fields['Event'] || [],
                checkedIn: isCheckedIn,
                checkinTime: fields['Check-in Time'] || null,
                checkinBy: fields['Check-in By'] || null,
                isCorrectEvent: isCorrectEvent
            }
        });

    } catch (error) {
        console.error('Error checking ticket:', error);
        return res.status(500).json({ error: error.message });
    }
};