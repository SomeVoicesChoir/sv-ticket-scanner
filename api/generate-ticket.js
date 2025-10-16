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
        const pdfBase64 = await generatePDF(attendeeName, eventName, qrImageBase64, recordId);

        // For testing - return the PDF data
        return res.status(200).json({ 
            success: true, 
            message: 'PDF generated successfully',
            recordId: recordId,
            pdfData: pdfBase64,
            filename: `ticket_${attendeeName.replace(/[^a-z0-9]/gi, '_')}.pdf`
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

async function generatePDF(name, event, qrImageBase64, recordId) {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    // Colors
    const primaryColor = [102, 126, 234];
    const darkColor = [51, 51, 51];
    const lightColor = [102, 102, 102];

    // Header background
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 50, 'F');

    // Title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(32);
    doc.setFont(undefined, 'bold');
    doc.text('YOUR TICKET', 105, 25, { align: 'center' });

    doc.setFontSize(14);
    doc.setFont(undefined, 'normal');
    doc.text('Present this QR code at the entrance', 105, 38, { align: 'center' });

    // Attendee name
    doc.setTextColor(...darkColor);
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text(name, 105, 70, { align: 'center' });

    // Event name
    doc.setTextColor(...lightColor);
    doc.setFontSize(18);
    doc.setFont(undefined, 'normal');
    doc.text(event, 105, 85, { align: 'center' });

    // QR Code
    const qrSize = 80;
    const qrX = (210 - qrSize) / 2;
    doc.addImage(`data:image/png;base64,${qrImageBase64}`, 'PNG', qrX, 100, qrSize, qrSize);

    // Border around QR
    doc.setDrawColor(...primaryColor);
    doc.setLineWidth(2);
    doc.rect(qrX - 5, 95, qrSize + 10, qrSize + 10);

    // Footer
    doc.setTextColor(...lightColor);
    doc.setFontSize(10);
    doc.text('Please arrive 15 minutes before the event starts', 105, 200, { align: 'center' });
    doc.text('This ticket is valid for one entry only', 105, 207, { align: 'center' });

    // Record ID at bottom
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(`Ticket ID: ${recordId}`, 105, 280, { align: 'center' });

    // Return PDF as base64
    return doc.output('datauristring').split(',')[1];
}

async function uploadPDFToAirtable(recordId, pdfBase64, attendeeName) {
    const filename = `ticket_${attendeeName.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    
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
                    url: `data:application/pdf;base64,${pdfBase64}`,
                    filename: filename
                }]
            }
        })
    });
}