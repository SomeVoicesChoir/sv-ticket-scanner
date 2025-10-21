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

// Helper function to safely get value from Airtable field (handles arrays from lookup fields)
function getFieldValue(field, defaultValue = '') {
    if (!field) return defaultValue;
    if (Array.isArray(field) && field.length > 0) {
        return field[0];
    }
    return field || defaultValue;
}

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
        const attendeeName = getFieldValue(fields['Name'], 'Guest');

        // Get event name and remove any surrounding quotes
        let eventName = getFieldValue(fields['Event Name for Ticket'], 'Event');
        if (typeof eventName === 'string') {
            eventName = eventName.replace(/^"|"$/g, '');
        }
        
        // Get fields - use helper to handle lookup arrays
        const dateFriendly = getFieldValue(fields['Date Friendly']);
        const doorsPerformance = getFieldValue(fields['Doors + Performance Time']);
        const ticketTypePrice = getFieldValue(fields['Ticket Type + Price']);
        const venueAddress = getFieldValue(fields['Venue Address']);
        const invoiceNumber = getFieldValue(fields['Invoice Number']);
        const ticketNumber = getFieldValue(fields['Ticket Number']);
        const admissionInstructions = getFieldValue(fields['Admission Instructions']);

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
        const pdfBase64 = await generatePDF(
            attendeeName, 
            eventName, 
            qrImageBase64, 
            recordId, 
            dateFriendly,
            doorsPerformance,
            ticketTypePrice,
            venueAddress, 
            invoiceNumber, 
            ticketNumber,
            admissionInstructions
        );

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

async function generatePDF(name, event, qrImageBase64, recordId, dateFriendly, doorsPerformance, ticketTypePrice, venueAddress, invoiceNumber, ticketNumber, admissionInstructions) {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    const darkColor = [51, 51, 51];
    const accentColor = [234, 62, 40]; // #ea3e28
    const lightBgColor = [244, 219, 192]; // #f4dbc0

    // ADD LOGO - top left
    try {
        const logoUrl = 'https://static1.squarespace.com/static/5b0d67017e3c3a79963296a6/t/68f0f21825cefe7a23c08f8e/1760621080739/SomeVoices_Logo_Black';
        const logoResponse = await fetch(logoUrl);
        const logoBuffer = await logoResponse.arrayBuffer();
        const logoBase64 = Buffer.from(logoBuffer).toString('base64');
        doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', 15, 15, 30, 30);
    } catch (error) {
        console.log('Could not load logo:', error);
    }

    // DATE + TIME FRIENDLY - top right (opposite logo)
    if (dateFriendly) {
        doc.setFontSize(16);
        doc.setTextColor(...darkColor);
        doc.setFont(undefined, 'normal');
        const dateLines = doc.splitTextToSize(dateFriendly, 80);
        doc.text(dateLines, 195, 20, { align: 'right' });
    }

    // EVENT NAME - slightly lower
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...darkColor);
    const eventLines = doc.splitTextToSize(event, 180);
    doc.text(eventLines, 15, 62);

    let currentY = 62 + (eventLines.length * 7) + 5;

    // DOORS + PERFORMANCE TIME - under event name
    if (doorsPerformance) {
        doc.setFontSize(14);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(doorsPerformance, 15, currentY);
        currentY += 7;
    }

    // TICKET TYPE + PRICE - under doors/performance
    if (ticketTypePrice) {
        doc.setFontSize(14);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(ticketTypePrice, 15, currentY);
        currentY += 7;
    }

    // VENUE ADDRESS - after other details, clickable
    if (venueAddress) {
        doc.setFontSize(14);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        const addressLines = doc.splitTextToSize(venueAddress, 180);
        doc.textWithLink(addressLines[0], 15, currentY, { 
            url: `https://maps.google.com/?q=${encodeURIComponent(venueAddress)}` 
        });
        for (let i = 1; i < addressLines.length; i++) {
            doc.text(addressLines[i], 15, currentY + (i * 5));
        }
    }

    // CUSTOMER SECTION
    doc.setTextColor(...darkColor);
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('Customer', 15, 108);
    
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text(name, 15, 118);
    
    // TICKET NUMBER - below customer name
    if (ticketNumber) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(`Ticket ${ticketNumber}`, 15, 126);
    }

    // QR CODE
    const qrSize = 80;
    const qrX = (210 - qrSize) / 2;
    const qrY = 135;
    
    // White background
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 5, 5, 'F');
    
    // QR Code
    doc.addImage(`data:image/png;base64,${qrImageBase64}`, 'PNG', qrX + 5, qrY + 5, qrSize - 10, qrSize - 10);

    // ✅ TICKET ID - directly below QR code
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.setFont(undefined, 'normal');
    doc.text(`Ticket ID: ${recordId}`, 105, qrY + qrSize + 3, { align: 'center' });

    // ADMISSION INSTRUCTIONS
    if (admissionInstructions) {
        const instructionLines = doc.splitTextToSize(admissionInstructions, 160);
        const boxHeight = Math.max(15, (instructionLines.length * 5) + 10);
        
        doc.setFillColor(...lightBgColor);
        doc.roundedRect(20, 228, 170, boxHeight, 3, 3, 'F');
        
        doc.setTextColor(...darkColor);
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        
        let instructY = 236;
        instructionLines.forEach((line, index) => {
            doc.text(line, 105, instructY + (index * 5), { align: 'center' });
        });
    }

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