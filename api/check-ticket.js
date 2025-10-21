const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { recordId, selectedEventName } = req.body;
    
    if (!recordId) {
        return res.status(400).json({ error: 'Record ID is required' });
    }

    try {
        // Fetch the ticket
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

        // Get the ticket's event record IDs (field is called 'Event Name' in Tickets table)
        const ticketEventIds = fields['Event Name'] || [];
        
        // Fetch the actual Event records to get their names
        let isCorrectEvent = false;
        if (ticketEventIds.length > 0) {
            for (const eventId of ticketEventIds) {
                const eventUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.eventTableId}/${eventId}`;
                const eventResponse = await fetch(eventUrl, {
                    headers: {
                        'Authorization': `Bearer ${CONFIG.apiKey}`
                    }
                });
                
                if (eventResponse.ok) {
                    const eventRecord = await eventResponse.json();
                    const eventName = eventRecord.fields['Event Name'] || '';
                    
                    // Compare event names instead of IDs
                    if (eventName === selectedEventName) {
                        isCorrectEvent = true;
                        break;
                    }
                }
            }
        }

        // Check if already checked in
        const isCheckedIn = fields['Checked In'] || false;

        return res.status(200).json({
            success: true,
            ticket: {
                name: fields['Name'] || 'Unknown',
                event: fields['Event Name'] || [],
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