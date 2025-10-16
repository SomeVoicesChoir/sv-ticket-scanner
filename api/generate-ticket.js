const fetch = require('node-fetch');
const { jsPDF } = require('jspdf');

// Configuration
const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY,
    eventTableId: process.env.AIRTABLE_EVENT_TABLE_ID,
    eventNameField: 'Event Name'
};

module.exports = async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { recordId } = req.body;

    if (!recordId) {
        return res.status(400).json({ error: 'Record ID is required' });
    }

    try {
        // Fetch ticket data
        const ticketUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}/${recordId}`;
        const ticketResponse = await fetch(ticketUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!ticketResponse.ok) {
            throw new Error('Ticket not found');
        }

        const ticketData = await ticketResponse.json();
        const fields = ticketData.fields;

        // Get attendee name
        const attendeeName = fields['Name'] || 'Guest';

        // Get event name
        let eventName = 'Event';
        if (fields['Event'] && fields['Event'].length > 0) {
            const eventId = fields['Event'][0];
            eventName = await getEventName(eventId);
        }

        // Get new fields
        const dateTime = fields['Date + Time Friendly'] || '';
        const venueAddress = fields['Venue Address'] || '';

        // Get QR code URL
        const qrCodeImages = fields['QR Code Image'];
        if (!qrCodeImages || qrCodeImages.length === 0) {
            throw new Error('No QR code found for this ticket');
        }
        const qrCodeUrl = qrCodeImages[0].url;

        // Download QR code image
        const qrImageResponse = await fetch(qrCodeUrl);
        const qrImageBuffer = await qrImageResponse.arrayBuffer();
        const qrImageBase64 = Buffer.from(qrImageBuffer).toString('base64');

        // Generate PDF
        const pdfBase64 = await generatePDF(attendeeName, eventName, qrImageBase64, recordId, dateTime, venueAddress);

        // Upload PDF back to Airtable
        await uploadPDFToAirtable(recordId, pdfBase64, attendeeName);

        return res.status(200).json({ 
            success: true, 
            message: 'Ticket PDF generated and uploaded to Airtable',
            recordId: recordId
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

async function getEventName(eventId) {
    try {
        const url = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.eventTableId}/${eventId}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!response.ok) return 'Event';

        const data = await response.json();
        return data.fields[CONFIG.eventNameField] || 'Event';
    } catch (error) {
        return 'Event';
    }
}

async function generatePDF(name, event, qrImageBase64, recordId, dateTime, venueAddress) {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    const darkColor = [51, 51, 51];
    const accentColor = [234, 62, 40]; // #ea3e28
    const lightBgColor = [244, 219, 192]; // #f4dbc0

    // ADD LOGO - top left (compressed version)
    try {
        const logoUrl = 'https://static1.squarespace.com/static/5b0d67017e3c3a79963296a6/t/68f0f21825cefe7a23c08f8e/1760621080739/SomeVoices_Logo_Black';
        const logoResponse = await fetch(logoUrl);
        const logoBuffer = await logoResponse.arrayBuffer();
        const logoBase64 = Buffer.from(logoBuffer).toString('base64');
        doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', 15, 15, 30, 30);
    } catch (error) {
        console.log('Could not load logo:', error);
    }

    // DATE + TIME - top right
    if (dateTime) {
        doc.setFontSize(12);
        doc.setTextColor(...darkColor);
        doc.setFont(undefined, 'normal');
        const dateLines = doc.splitTextToSize(dateTime, 80);
        doc.text(dateLines, 195, 20, { align: 'right' });
    }

    // EVENT - under logo, left side with max width
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...darkColor);
    const eventLines = doc.splitTextToSize(event, 180);
    doc.text(eventLines, 15, 65);

    // Position for venue address
    let currentY = 65 + (eventLines.length * 7) + 5;

    // VENUE ADDRESS - under event, left side, clickable (black text)
    if (venueAddress) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        const addressLines = doc.splitTextToSize(venueAddress, 180);
        doc.textWithLink(addressLines[0], 15, currentY, { 
            url: `https://maps.google.com/?q=${encodeURIComponent(venueAddress)}` 
        });
        // Add remaining lines without link if address wraps
        for (let i = 1; i < addressLines.length; i++) {
            doc.text(addressLines[i], 15, currentY + (i * 5));
        }
    }

    // ATTENDEE SECTION
    doc.setTextColor(...darkColor);
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('Attendee', 15, 135);
    
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text(name, 15, 145);

    // QR CODE
    const qrSize = 80;
    const qrX = (210 - qrSize) / 2;
    const qrY = 170;
    
    // White background
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 5, 5, 'F');
    
    // QR Code
    doc.addImage(`data:image/png;base64,${qrImageBase64}`, 'PNG', qrX + 5, qrY + 5, qrSize - 10, qrSize - 10);

    // INSTRUCTIONS with custom background color
    doc.setFillColor(...lightBgColor);
    doc.roundedRect(20, 260, 170, 15, 3, 3, 'F');
    
    doc.setTextColor(...darkColor);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('Please arrive at least 15 minutes before the event starts', 105, 268, { align: 'center' });
    doc.text('This ticket is valid for one entry only', 105, 273, { align: 'center' });

    // FOOTER
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.setFont(undefined, 'normal');
    doc.text(`Ticket ID: ${recordId}`, 105, 290, { align: 'center' });

    // Return PDF as base64
    return doc.output('datauristring').split(',')[1];
}

async function uploadPDFToAirtable(recordId, pdfBase64, attendeeName) {
    const filename = `ticket_${attendeeName.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    
    try {
        // Step 1: Store PDF temporarily and get ID
        const storeResponse = await fetch('https://sv-ticket-scanner.vercel.app/api/serve-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfData: pdfBase64 })
        });
        
        if (!storeResponse.ok) {
            const errorText = await storeResponse.text();
            throw new Error(`Failed to store PDF: ${storeResponse.status} - ${errorText}`);
        }
        
        const storeData = await storeResponse.json();
        const { pdfId } = storeData;
        const pdfUrl = `https://sv-ticket-scanner.vercel.app/api/serve-pdf?id=${pdfId}`;
        
        // Step 2: Tell Airtable to fetch from that URL
        const updateUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}/${recordId}`;
        
        await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: {
                    'PDF Ticket': [{
                        url: pdfUrl,
                        filename: filename
                    }]
                }
            })
        });
    } catch (error) {
        console.error('Error uploading PDF to Airtable:', error);
        throw error;
    }
}