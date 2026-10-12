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

/**
 * {PDF Ticket} on Tickets, by FIELD ID so a rename in Airtable can't break the
 * upload. The uploadAttachment endpoint takes an id or a name, and its RESPONSE
 * is keyed by field id either way.
 */
const PDF_FIELD_ID = process.env.AIRTABLE_PDF_FIELD_ID || 'flduYaFd3fWnSOPAd';

/**
 * The direct upload endpoint caps around 5MB. Gate below it so an oversize PDF
 * fails with something readable instead of a bare 413. A ticket is a QR, some
 * text and a logo, so this should never be close — the log line below reports
 * the real size on every run so we find out if that changes.
 */
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

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

    // `force: true` regenerates a ticket that already has a PDF, replacing it.
    // Without it an existing PDF is left alone — see the guard below.
    const { recordId, force } = req.body;

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

        /**
         * Don't make a second PDF.
         *
         * uploadAttachment APPENDS, and two PDFs on one ticket push
         * {PDF Ticket Rollup} past {Number of Tickets Purchased}, so
         * {#Tix and #PDFs match} never fires again — and that gate is per
         * ORDER, so one duplicated attachment stops the WHOLE order emailing,
         * not just this ticket. The symptom gives no hint of the cause.
         *
         * The Airtable script won't normally call us for a ticket that already
         * has one, but the retry automation, the hourly sweep and a hand-run
         * can all overlap, so the guard belongs on this side too.
         */
        const existingAttachments = Array.isArray(fields['PDF Ticket']) ? fields['PDF Ticket'] : [];

        if (existingAttachments.length > 0 && !force) {
            console.log(`Ticket ${recordId} already has ${existingAttachments.length} PDF — not regenerating`);
            return res.status(200).json({
                success: true,
                message: 'Ticket already has a PDF',
                recordId,
                alreadyHadPDF: true
            });
        }

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
        const bookingFeeMessage = getFieldValue(fields['Booking Fee Ticket Message']);
        const totalCost = getFieldValue(fields['Total Cost Ticket PDF']);
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
            bookingFeeMessage,
            totalCost,
            venueAddress,
            invoiceNumber,
            ticketNumber,
            admissionInstructions
        );

        // Upload PDF back to Airtable
        const upload = await uploadPDFToAirtable(
            recordId,
            pdfBase64,
            attendeeName,
            existingAttachments.map(a => a.id)
        );

        return res.status(200).json({
            success: true,
            message: 'Ticket PDF generated and uploaded to Airtable',
            recordId: recordId,
            // The PDF is attached BY THE TIME THIS RETURNS, which is the whole
            // point of the change — the Airtable script's poll should now
            // confirm it on its first look rather than after several seconds.
            attached: true,
            sizeKB: upload.sizeKB,
            attachmentId: upload.attachmentId,
            ...(upload.replaced ? { replacedPrevious: upload.replaced } : {})
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

async function generatePDF(name, event, qrImageBase64, recordId, dateFriendly, doorsPerformance, ticketTypePrice, bookingFeeMessage, totalCost, venueAddress, invoiceNumber, ticketNumber, admissionInstructions) {
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
        doc.setFontSize(14);
        doc.setTextColor(...darkColor);
        doc.setFont(undefined, 'normal');
        const dateLines = doc.splitTextToSize(dateFriendly, 80);
        doc.text(dateLines, 195, 20, { align: 'right' });
    }

    let currentY = 62;

    // EVENT NAME
    doc.setFontSize(22);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...darkColor);
    const eventLines = doc.splitTextToSize(event, 180);
    doc.text(eventLines, 15, currentY);
    currentY += eventLines.length * 7 + 3;

    // VENUE ADDRESS - under event name, clickable
    if (venueAddress) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        const addressLines = doc.splitTextToSize(venueAddress, 180);
        doc.textWithLink(addressLines[0], 15, currentY, {
            url: `https://maps.google.com/?q=${encodeURIComponent(venueAddress)}`
        });
        for (let i = 1; i < addressLines.length; i++) {
            doc.text(addressLines[i], 15, currentY + (i * 5));
        }
        currentY += addressLines.length * 5 + 2;
    }

    // DOORS + PERFORMANCE TIME - under venue
    if (doorsPerformance) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(doorsPerformance, 15, currentY);
        currentY += 7;
    }

    // Separator line after doors/performance
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(15, currentY, 195, currentY);
    currentY += 5;

    // TICKET TYPE + PRICE
    if (ticketTypePrice) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(ticketTypePrice, 15, currentY);
        currentY += 7;
    }

    // BOOKING FEE MESSAGE - under ticket type
    if (bookingFeeMessage) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(bookingFeeMessage, 15, currentY);
        currentY += 7;
    }

    // TOTAL COST - under booking fee
    if (totalCost) {
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(totalCost, 15, currentY);
        currentY += 7;
    }

    // Separator line after cost details
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(15, currentY, 195, currentY);
    currentY += 5;

    // CUSTOMER SECTION
    doc.setTextColor(...darkColor);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('Customer', 15, currentY);
    currentY += 8;

    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(name, 15, currentY);
    currentY += 8;

    // TICKET NUMBER - below customer name
    if (ticketNumber) {
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...darkColor);
        doc.text(`Ticket ${ticketNumber}`, 15, currentY);
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
    doc.setFontSize(6);
    doc.setTextColor(180, 180, 180);
    doc.setFont(undefined, 'normal');
    doc.text(`Ticket ID: ${recordId}`, 105, qrY + qrSize - 5, { align: 'center' });

    // ADMISSION INSTRUCTIONS
    if (admissionInstructions) {
        const instructionLines = doc.splitTextToSize(admissionInstructions, 160);
        const boxHeight = Math.max(15, (instructionLines.length * 5) + 10);
        
        doc.setFillColor(...lightBgColor);
        doc.roundedRect(20, 228, 170, boxHeight, 3, 3, 'F');
        
        doc.setTextColor(...darkColor);
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');

        let instructY = 236;
        instructionLines.forEach((line, index) => {
            doc.text(line, 105, instructY + (index * 5), { align: 'center' });
        });
    }

    // Return PDF as base64
    return doc.output('datauristring').split(',')[1];
}

/**
 * Attach the PDF to the ticket by uploading the BYTES directly.
 *
 * ── WHAT THIS REPLACED, AND WHY ───────────────────────────────────────────────
 * It used to POST the PDF to /api/serve-pdf — which held it in a module-level
 * `new Map()` and deleted it after five minutes — and then hand Airtable that
 * URL to come back for. Two independent ways to silently lose a ticket:
 *
 *   1. Serverless instances don't share that Map and get recycled, so
 *      Airtable's fetch could land on an instance that had never heard of the
 *      id and take a 404.
 *   2. The five-minute TTL. Under load, Airtable's attachment-fetch queue
 *      backs up; past five minutes the entry was already deleted.
 *
 * Either way Airtable attaches NOTHING and reports nothing — the cell just
 * stays empty.
 *
 * Measured on the 7 Oct 2026 on-sale: normal PDF attach time was ~15s, but
 * during the 16:50–17:10 burst it stretched to 60–180s, and EIGHT orders out of
 * ~400 lost their attachment entirely. Those customers waited 18 to 41 hours
 * for tickets, until the records were fixed by hand on the morning of 9 Oct.
 * That is the load-dependent ~2% failure the whole exercise was chasing.
 *
 * This endpoint is synchronous: it returns once the file is stored, so there is
 * no queue, no URL, no TTL and no second request to lose.
 *
 * ⚠️ IT APPENDS. It does not replace. Two PDFs on one ticket push
 * {PDF Ticket Rollup} past {Number of Tickets Purchased}, so
 * {#Tix and #PDFs match} never fires — and because that gate is per ORDER, one
 * duplicate attachment stops the whole order emailing. Guarded twice: the
 * handler refuses to regenerate a ticket that already has a PDF, and anything
 * that gets past that (a `force` run) is trimmed back to one below.
 *
 * ⚠️ ITS RESPONSE KEYS `fields` BY FIELD ID, not field name — hence
 * Object.values(...).find(Array.isArray) rather than fields['PDF Ticket'].
 *
 * @param {string}   recordId
 * @param {string}   pdfBase64
 * @param {string}   attendeeName
 * @param {string[]} existingIds  attachment ids present BEFORE this upload, so
 *                                the newly added one can be identified
 * @returns {Promise<{attachmentId: string|null, sizeKB: number, replaced: number}>}
 */
async function uploadPDFToAirtable(recordId, pdfBase64, attendeeName, existingIds = []) {
    const filename = `ticket_${attendeeName.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    const sizeBytes = Buffer.byteLength(pdfBase64, 'base64');
    const sizeKB = Math.round(sizeBytes / 1024);

    console.log(`Uploading ${filename} (${sizeKB}KB) to ${recordId}`);

    if (sizeBytes > MAX_UPLOAD_BYTES) {
        // Better a clear error than a bare 413 from the upload host.
        throw new Error(
            `PDF is ${sizeKB}KB, over the ${Math.round(MAX_UPLOAD_BYTES / 1024)}KB direct-upload limit. `
            + 'Shrink the embedded logo — it is the only large asset in the document.'
        );
    }

    const uploadUrl = `https://content.airtable.com/v0/${CONFIG.baseId}/${recordId}/${PDF_FIELD_ID}/uploadAttachment`;

    const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contentType: 'application/pdf',
            filename: filename,
            file: pdfBase64
        })
    });

    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text().catch(() => '');
        // Throwing is correct: the caller turns this into a 500, the Airtable
        // script records the reason and flags the ticket, and the hourly sweep
        // retries it. Swallowing it would leave a ticket with no PDF and
        // nothing anywhere saying so, which is the bug this change exists to
        // end.
        throw new Error(`uploadAttachment failed (HTTP ${uploadResponse.status}): ${errorText.slice(0, 300)}`);
    }

    const body = await uploadResponse.json();

    // Keyed by field ID, so find the array rather than naming the field.
    const attachments = Object.values(body.fields || {}).find(Array.isArray) || [];
    const added = attachments.find(a => !existingIds.includes(a.id)) || attachments[attachments.length - 1];

    if (!attachments.length) {
        throw new Error('uploadAttachment returned 200 but no attachment — treat as a failure');
    }

    // Trim back to the one we just added. Passing existing attachments as bare
    // {id} retains exactly those and drops the rest.
    let replaced = 0;
    if (attachments.length > 1 && added) {
        const patchUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}/${recordId}`;
        const patchResponse = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: { 'PDF Ticket': [{ id: added.id }] } })
        });

        if (!patchResponse.ok) {
            const errorText = await patchResponse.text().catch(() => '');
            // Must throw. Leaving the ticket holding several PDFs silently
            // breaks its whole order's email gate.
            throw new Error(
                `PDF uploaded but trimming ${attachments.length} attachments back to 1 failed `
                + `(HTTP ${patchResponse.status}): ${errorText.slice(0, 200)}. `
                + 'Delete the extra attachments by hand or the order will never email.'
            );
        }
        replaced = attachments.length - 1;
        console.log(`Trimmed ${attachments.length} attachments back to the new one`);
    }

    console.log(`Attached ${added?.id} (${sizeKB}KB) — present before this call returned`);
    return { attachmentId: added?.id || null, sizeKB, replaced };
}