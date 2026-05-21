const path = require('path');
const fetch = require('node-fetch');
const { PKPass } = require('passkit-generator');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    tableId: process.env.AIRTABLE_TABLE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

// Template directory is bundled with the function via vercel.json includeFiles
const TEMPLATE_DIR = path.join(process.cwd(), 'lib/wallet/apple-template');

// Airtable lookup fields come back as arrays — unwrap to the first value.
function fv(field, fallback = '') {
    if (!field) return fallback;
    if (Array.isArray(field)) return field[0] || fallback;
    return field || fallback;
}

module.exports = async function handler(req, res) {
    // Enable CORS so the success page (embedded on Squarespace) can link/redirect here
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { ticketId } = req.query;
    if (!ticketId || !/^rec[A-Za-z0-9]+$/.test(ticketId)) {
        return res.status(400).json({ error: 'Invalid ticket ID' });
    }

    try {
        // 1. Fetch the ticket record from Airtable
        const ticketUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${CONFIG.tableId}/${ticketId}`;
        const ticketResponse = await fetch(ticketUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });

        if (!ticketResponse.ok) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const { fields } = await ticketResponse.json();

        // 2. Extract display values (use same field names as generate-ticket.js)
        const attendeeName = fv(fields['Name'], 'Guest');
        let eventName = fv(fields['Event Name for Ticket'], 'Event');
        if (typeof eventName === 'string') eventName = eventName.replace(/^"|"$/g, '');

        const dateFriendly = fv(fields['Date Friendly']);
        const doorsPerformance = fv(fields['Doors + Performance Time']);
        const ticketTypePrice = fv(fields['Ticket Type + Price']);
        const venueAddress = fv(fields['Venue Address']);
        const ticketNumber = fv(fields['Ticket Number']);
        const admissionInstructions = fv(fields['Admission Instructions']);
        const status = fields['Status'] || 'Valid';

        // 3. Build the pass from the template
        const pass = await PKPass.from({
            model: TEMPLATE_DIR,
            certificates: {
                wwdr: process.env.APPLE_PASS_WWDR_PEM,
                signerCert: process.env.APPLE_PASS_CERT_PEM,
                signerKey: process.env.APPLE_PASS_KEY_PEM,
                signerKeyPassphrase: process.env.APPLE_PASS_KEY_PASSPHRASE
            }
        }, {
            // Top-level pass overrides
            serialNumber: ticketId,
            description: `Some Voices Ticket: ${eventName}`
        });

        // 4. Set fields on the pass face

        // Header (top right): event date
        if (dateFriendly) {
            pass.headerFields.push({
                key: 'date',
                label: 'DATE',
                value: dateFriendly
            });
        }

        // Primary (large, prominent): event name
        pass.primaryFields.push({
            key: 'event',
            label: 'EVENT',
            value: eventName
        });

        // Secondary (middle row): attendee name + ticket number
        pass.secondaryFields.push({
            key: 'name',
            label: 'NAME',
            value: attendeeName
        });

        if (ticketNumber) {
            pass.secondaryFields.push({
                key: 'ticket',
                label: 'TICKET',
                value: ticketNumber
            });
        }

        // Auxiliary (bottom row): doors / performance time
        if (doorsPerformance) {
            pass.auxiliaryFields.push({
                key: 'doors',
                label: 'DOORS',
                value: doorsPerformance
            });
        }

        // Back (flip-over details)
        if (venueAddress) {
            pass.backFields.push({
                key: 'venue',
                label: 'Venue',
                value: venueAddress
            });
        }

        if (ticketTypePrice) {
            pass.backFields.push({
                key: 'ticketType',
                label: 'Ticket Type',
                value: ticketTypePrice
            });
        }

        if (admissionInstructions) {
            pass.backFields.push({
                key: 'admission',
                label: 'Admission',
                value: admissionInstructions
            });
        }

        pass.backFields.push({
            key: 'ticketId',
            label: 'Ticket ID',
            value: ticketId
        });

        pass.backFields.push({
            key: 'status',
            label: 'Status',
            value: status
        });

        // 5. Encode the Airtable record ID as the QR — matches what the scanner reads
        pass.setBarcodes({
            message: ticketId,
            format: 'PKBarcodeFormatQR',
            messageEncoding: 'iso-8859-1',
            altText: ticketNumber || ''
        });

        // 6. Return the .pkpass as a binary download
        const buffer = pass.getAsBuffer();

        res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
        res.setHeader('Content-Disposition', `attachment; filename="some-voices-ticket-${ticketId}.pkpass"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buffer);

    } catch (error) {
        console.error('Error generating Apple Wallet pass:', error);
        return res.status(500).json({ error: error.message });
    }
};
