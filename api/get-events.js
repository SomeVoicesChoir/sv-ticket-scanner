const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    viewName: 'Currently onsale'
};

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
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
        
        const events = data.records.map(record => ({
            id: record.id,
            name: record.fields['Event Name'] || 'Unnamed Event',
            showName: record.fields['Event Name (input here)'] || '',
            showDescription: record.fields['Event Description'] || '',
            showImage: (record.fields['Event Image'] && record.fields['Event Image'][0]) ? record.fields['Event Image'][0].url : '',
            displayName: record.fields['Display Name'] || record.fields['Event Name'] || 'Unnamed Event',
            ticketTypePrice: record.fields['Ticket Type + Price'] || 'Standard',
            price: record.fields['Ticket Price'] || 0,
            stripePriceId: record.fields['Stripe Price ID'],
            dateTime: record.fields['Date + Time Friendly'] || '',
            doorsPerformance: record.fields['Doors + Performance Time'] || '',
            venueAddress: record.fields['Venue Address'] || '',
            ticketType: record.fields['Ticket Type'] || 'Standard',
            eventType: record.fields['Public or Member Event'] || '',
            currency: record.fields["Stripe 'default_price_data[currency]'"] || 'GBP',
            currencySymbol: record.fields['Currency Symbol'] || '£',
            allocation: record.fields['Allocation'] || 0,
            maxTickets: record.fields['Max Tickets Per Purchase'] || 6,
            ticketsRemaining: record.fields['Tickets Remaining'] || 0,
            bookingFee: record.fields['Booking Fee'] || 0,
            bookingFeeMessage: record.fields['Booking Fee Message'] || '',
            totalCost: record.fields['Total Cost'] || 0
        })).filter(event => event.stripePriceId);

        return res.status(200).json({ events });

    } catch (error) {
        console.error('Error fetching events:', error);
        return res.status(500).json({ error: error.message });
    }
};