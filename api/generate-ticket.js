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

async function generatePDF(name, event, qrImageBase64, recordId) {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    // Colors
    const primaryColor = [102, 126, 234];
    const secondaryColor = [118, 75, 162];
    const darkColor = [51, 51, 51];
    const lightColor = [102, 102, 102];
    const accentColor = [40, 167, 69];

    // HEADER
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 60, 'F');
    
    // ADD YOUR LOGO
    try {
        const logoUrl = 'https://static1.squarespace.com/static/5b0d67017e3c3a79963296a6/t/68c3f9db2254285ac3462c07/1757673947211/SV+Primary+logo+colour+circle+small.png';
        const logoResponse = await fetch(logoUrl);
        const logoBuffer = await logoResponse.arrayBuffer();
        const logoBase64 = Buffer.from(logoBuffer).toString('base64');
        doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', 15, 10, 30, 30);
    } catch (error) {
        console.log('Could not load logo:', error);
        // Fallback to emoji if logo fails
        doc.setFontSize(48);
        doc.setTextColor(255, 255, 255);
        doc.text('🎵', 15, 40);
    }

    // Main title
    doc.setFontSize(36);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('Some Voices Ticket', 105, 30, { align: 'center' });
    
    // Subtitle
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('Present this QR code at the entrance', 105, 45, { align: 'center' });

    // Decorative line
    doc.setDrawColor(...accentColor);
    doc.setLineWidth(1);
    doc.line(20, 65, 190, 65);

    // ATTENDEE SECTION
    doc.setFillColor(248, 249, 250);
    doc.roundedRect(20, 75, 170, 35, 3, 3, 'F');
    
    doc.setTextColor(...darkColor);
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('ATTENDEE', 30, 85);
    
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text(name, 30, 100);

    // EVENT SECTION
    doc.setFillColor(248, 249, 250);
    doc.roundedRect(20, 115, 170, 30, 3, 3, 'F');
    
    doc.setTextColor(...darkColor);
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('EVENT', 30, 125);
    
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...primaryColor);
    doc.text(event, 30, 138);

    // QR CODE SECTION
    doc.setTextColor(...darkColor);
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('SCAN TO CHECK IN', 105, 160, { align: 'center' });
    
    // QR Code with rounded border
    const qrSize = 80;
    const qrX = (210 - qrSize) / 2;
    const qrY = 170;
    
    // Shadow effect
    doc.setFillColor(220, 220, 220);
    doc.roundedRect(qrX + 2, qrY + 2, qrSize, qrSize, 5, 5, 'F');
    
    // White background
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 5, 5, 'F');
    
    // QR Code
    doc.addImage(`data:image/png;base64,${qrImageBase64}`, 'PNG', qrX + 5, qrY + 5, qrSize - 10, qrSize - 10);
    
    // Border around QR
    doc.setDrawColor(...primaryColor);
    doc.setLineWidth(2);
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 5, 5, 'S');

    // INSTRUCTIONS
    doc.setFillColor(255, 253, 231);
    doc.roundedRect(20, 260, 170, 20, 3, 3, 'F');
    
    doc.setTextColor(133, 100, 4);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('💡 Please arrive at least 15 minutes before the event starts', 30, 270);
    doc.text('🎟️ This ticket is valid for one entry only', 30, 276);

    // FOOTER
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(20, 285, 190, 285);
    
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.setFont(undefined, 'normal');
    doc.text(`Ticket ID: ${recordId}`, 105, 290, { align: 'center' });

    // Return PDF as base64
    return doc.output('datauristring').split(',')[1];
}

async function uploadPDFToAirtable(recordId, pdfBase64, attendeeName) {
    const filename = `ticket_${attendeeName.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    
    // Step 1: Store PDF temporarily and get ID
    const storeResponse = await fetch('https://sv-ticket-scanner.vercel.app/api/serve-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfData: pdfBase64 })
    });
    
    const { pdfId } = await storeResponse.json();
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
}