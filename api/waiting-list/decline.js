// Waiting list — decline a held invitation
//
// Lets a Notified waitlister actively give up their 24h ticket hold so the
// seat can be offered to the next person immediately, rather than waiting for
// the 24h token to lapse.
//
// It does the MINIMUM: validate the token and flip the Waiting List row to
// Status = 'Declined'. It deliberately does NOT release the Reservation or
// notify the next waitlister itself — that is the job of the existing
// "on-expired" Airtable automation, whose trigger should be widened to fire on
// Status becoming EITHER 'Expired' OR 'Declined'. The automation script reads
// only `waitingListId` and does not care which status name triggered it, so no
// script change is needed. Keeping one cascade path avoids double-releasing a
// seat or racing two notify flows.
//
// Reuses the same token-cleaning + lookup pattern as lookup/[token].js and
// redeem-checkout.js.

const fetch = require('node-fetch');

const CONFIG = {
    baseId: process.env.AIRTABLE_BASE_ID,
    apiKey: process.env.AIRTABLE_API_KEY
};

const WAITING_LIST_TABLE = 'Waiting List';

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { token: rawToken } = req.body || {};
        if (!rawToken || typeof rawToken !== 'string') {
            return res.status(400).json({ error: 'Missing token' });
        }

        // Strip BOM + zero-width chars that Airtable's rich-text email editor
        // sometimes injects around dragged blue pills inside <a href="...">.
        const token = String(rawToken).replace(/[﻿​-‍⁠]/g, '').trim();
        const safeToken = token.replace(/'/g, "\\'");
        const formula = encodeURIComponent(`{Redemption Token} = '${safeToken}'`);
        const lookupUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(WAITING_LIST_TABLE)}?filterByFormula=${formula}&maxRecords=1`;

        const wlResp = await fetch(lookupUrl, {
            headers: { 'Authorization': `Bearer ${CONFIG.apiKey}` }
        });
        if (!wlResp.ok) {
            return res.status(500).json({ error: 'Could not validate this link. Please try again.' });
        }

        const wlData = await wlResp.json();
        const wlRow = (wlData.records || [])[0];
        if (!wlRow) {
            return res.status(404).json({ error: 'This link is not valid.' });
        }

        const status = wlRow.fields['Status'];

        // Idempotent / friendly handling of non-actionable states.
        if (status === 'Declined') {
            // Already declined (e.g. double tap) — treat as success.
            return res.status(200).json({ ok: true, alreadyDone: true });
        }
        if (status === 'Expired') {
            // The 24h hold already lapsed and the seat has moved on — same net
            // outcome as a decline, so report success.
            return res.status(200).json({ ok: true, alreadyDone: true });
        }
        if (status === 'Converted') {
            return res.status(410).json({ error: 'You have already purchased this ticket, so there is nothing to release.' });
        }
        if (status !== 'Notified') {
            // 'Waiting' or anything else — no live invitation to decline.
            return res.status(410).json({ error: 'This link is no longer active.' });
        }

        // Flip to Declined. The on-expired automation (widened to also trigger
        // on Declined) then releases the Reservation and notifies the next
        // eligible waitlister.
        const patchUrl = `https://api.airtable.com/v0/${CONFIG.baseId}/${encodeURIComponent(WAITING_LIST_TABLE)}/${wlRow.id}`;
        const patchResp = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: { 'Status': 'Declined' } })
        });

        if (!patchResp.ok) {
            const detail = await patchResp.text().catch(() => '');
            console.error('Decline PATCH failed:', patchResp.status, detail);
            return res.status(500).json({ error: 'Could not release your ticket. Please try again or contact sing@somevoices.co.uk.' });
        }

        console.log(`Waiting list row ${wlRow.id} declined by waitlister (was ${status})`);
        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error('Waiting-list decline error:', error);
        return res.status(500).json({ error: error.message });
    }
};
