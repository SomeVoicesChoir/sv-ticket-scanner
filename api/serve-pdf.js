const PDFs = new Map(); // Temporary in-memory storage

module.exports = async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const { id } = req.query;
    
    if (req.method === 'POST') {
        // Store PDF temporarily
        const { pdfData } = req.body;
        
        if (!pdfData) {
            return res.status(400).json({ error: 'PDF data is required' });
        }
        
        const pdfId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        PDFs.set(pdfId, pdfData);
        
        // Auto-delete after 5 minutes
        setTimeout(() => {
            PDFs.delete(pdfId);
            console.log(`PDF ${pdfId} deleted from memory`);
        }, 5 * 60 * 1000);
        
        console.log(`PDF ${pdfId} stored, will be deleted in 5 minutes`);
        return res.status(200).json({ pdfId });
    }
    
    if (req.method === 'GET' && id) {
        // Serve the PDF
        const pdfData = PDFs.get(id);
        
        if (!pdfData) {
            return res.status(404).send('PDF not found or expired');
        }
        
        const buffer = Buffer.from(pdfData, 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=ticket.pdf');
        res.setHeader('Content-Length', buffer.length);
        
        console.log(`Serving PDF ${id}`);
        return res.send(buffer);
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
};