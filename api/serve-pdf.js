const PDFs = new Map(); // Temporary in-memory storage

module.exports = async function handler(req, res) {
    const { id } = req.query;
    
    if (req.method === 'POST') {
        // Store PDF temporarily
        const { pdfData } = req.body;
        const pdfId = Date.now().toString();
        PDFs.set(pdfId, pdfData);
        
        // Auto-delete after 5 minutes
        setTimeout(() => PDFs.delete(pdfId), 5 * 60 * 1000);
        
        return res.status(200).json({ pdfId });
    }
    
    if (req.method === 'GET' && id) {
        // Serve the PDF
        const pdfData = PDFs.get(id);
        if (!pdfData) {
            return res.status(404).send('PDF not found');
        }
        
        const buffer = Buffer.from(pdfData, 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=ticket.pdf');
        return res.send(buffer);
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
};