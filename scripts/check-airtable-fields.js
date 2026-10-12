#!/usr/bin/env node
//
// check-airtable-fields — validate every Airtable field name this code uses
// against the LIVE Ticketing base schema, and flag positional reads of
// linked-record arrays.
//
// Run:  AIRTABLE_API_KEY=pat... node scripts/check-airtable-fields.js
//       (or `npm run check:fields` — it also picks the key up from a
//        .env.local in the repo root if one exists)
//
// WHY THIS EXISTS — two incidents on 12 Oct 2026, both silent:
//
//   1. {Currency} does not exist on the Event table (the real field is
//      {Stripe 'default_price_data[currency]'}). Both waiting-list endpoints
//      read it, so `event.fields['Currency'] || 'GBP'` always said GBP and a
//      EUR event's claim would have been charged in POUNDS at the euro
//      number. A missing Airtable field reads exactly like an empty one —
//      no error, no log, nothing to notice.
//
//   2. `reservationLinks[0]` took the FIRST linked reservation, which on a
//      re-notified Waiting List row is the dead Released one (the new hold is
//      APPENDED). That made the claim page tell five people "No tickets are
//      available for this event right now" while their seat sat held for them.
//      34 Waiting List rows currently carry more than one linked reservation.
//
// WHAT IT CANNOT SEE: Airtable VIEW filters and the scripts attached to
// AUTOMATIONS are invisible to every API. Nothing here can check those — they
// can only be established empirically, by running them and watching.
//
// Exit 1 if a field name doesn't exist in the base. Positional link reads are
// warnings; annotate a reviewed line with `link-index-ok` to silence it.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appDQqklQ8X7LWg8Z';

// Scanned: this repo's endpoints, plus the Ticketing Airtable scripts if the
// sibling directory happens to be checked out alongside (they read the same
// base and are part of the same flows).
const ROOTS = [
    path.join(REPO, 'api'),
    path.resolve(REPO, '..', 'airtable-scripts'),
];

// Header names and currency codes that look like field names but aren't.
const NOT_FIELDS = new Set([
    'Content-Type', 'Authorization', 'Accept', 'Accept-Version', 'Accept-Ranges',
    'Content-Length', 'Content-MD5', 'Content-Range', 'Content-Disposition',
    'Cache-Control', 'Date', 'X-Api-Version', 'X-CSRF-Token', 'X-Requested-With',
    'X-Webhook-Secret', 'Stripe-Signature', 'Access-Control-Allow-Origin',
    'GBP', 'EUR', 'USD',
]);

const READ_PATTERNS = [
    /fields\[\s*(['"])([^'"]{2,60})\1\s*\]/g,                      // fields['X']
    /getCellValue(?:AsString)?\(\s*(['"])([^'"]{2,60})\1\s*\)/g,   // scripting block
    /^\s*(['"])([A-Z][^'"]{2,60})\1\s*:/gm,                        // write payload keys
];

function resolveKey() {
    if (process.env.AIRTABLE_API_KEY) return process.env.AIRTABLE_API_KEY;
    const envFile = path.join(REPO, '.env.local');
    if (fs.existsSync(envFile)) {
        const m = fs.readFileSync(envFile, 'utf8').match(/^AIRTABLE_API_KEY=(.+)$/m);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    return null;
}

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(p, out);
        } else if (entry.name.endsWith('.js')) {
            out.push(p);
        }
    }
    return out;
}

// Superseded copies kept for reference shouldn't fail a build.
const isLive = (file) =>
    !/\bOLD-/.test(file) &&
    !/\bBACKUP\b/i.test(file) &&
    !/ORIGINAL/i.test(file) &&
    (file.includes(path.join(REPO, 'api')) || /SV-Ticketing-Base/.test(file));

(async () => {
    const key = resolveKey();
    if (!key) {
        console.error('No AIRTABLE_API_KEY (env or .env.local). Nothing checked.');
        process.exit(2);
    }

    const resp = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
        headers: { Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) {
        console.error(`Could not read the base schema: ${resp.status} ${await resp.text()}`);
        process.exit(2);
    }
    const meta = await resp.json();

    const tablesByField = new Map();
    for (const t of meta.tables) {
        for (const f of t.fields) {
            if (!tablesByField.has(f.name)) tablesByField.set(f.name, []);
            tablesByField.get(f.name).push(t.name);
        }
    }

    const files = ROOTS.flatMap(r => walk(r)).filter(isLive).sort();
    const rel = f => path.relative(path.resolve(REPO, '..'), f);

    const unknownFields = [];
    const unknownFormulaRefs = [];
    const positional = [];
    let projectionsChecked = 0;
    let formulaRefsChecked = 0;

    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        const lines = src.split('\n');
        const lineAt = idx => src.slice(0, idx).split('\n').length;

        for (const re of READ_PATTERNS) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(src))) {
                const name = m[2];
                if (NOT_FIELDS.has(name) || tablesByField.has(name)) continue;
                if (!/[A-Za-z]/.test(name)) continue;
                const line = lineAt(m.index);
                unknownFields.push({ file, line, name, text: (lines[line - 1] || '').trim() });
            }
        }

        // {Field} references inside filterByFormula strings. An unknown name
        // there 422s the whole query, which looks like "no rows", not an error.
        const formulaRef = /(?<!\$)\{([^{}]{2,60})\}/g;
        let f;
        while ((f = formulaRef.exec(src))) {
            const name = f[1];
            const line = lineAt(f.index);
            const text = (lines[line - 1] || '').trim();
            if (!/filterByFormula|formula|FIND\(|ARRAYJOIN|AND\(|OR\(/i.test(text)) continue;
            if (/^(RECORD_ID|NOW|TODAY)/.test(name)) continue;
            formulaRefsChecked++;
            if (!tablesByField.has(name)) unknownFormulaRefs.push({ file, line, name, text });
        }

        // fields[] projections — one unknown name returns NOTHING for the whole
        // request, so these are worth naming explicitly when they appear.
        lines.forEach((l, i) => {
            const m = l.match(/fields(?:\[\]|%5B%5D)['"]?\s*[,=]\s*['"]([^'"]+)['"]/);
            if (!m) return;
            projectionsChecked++;
            if (!tablesByField.has(m[1])) unknownFields.push({ file, line: i + 1, name: m[1], text: l.trim() });
        });

        // Positional reads of a linked-record array.
        lines.forEach((l, i) => {
            if (/^\s*(\/\/|\*)/.test(l)) return;
            if (l.includes('link-index-ok')) return;
            if (/(Links|links|Reservations|Tickets)\s*\[\s*0\s*\]/.test(l)) {
                positional.push({ file, line: i + 1, text: l.trim() });
            }
        });
    }

    console.log(`${files.length} files · ${tablesByField.size} field names in ${meta.tables.length} tables · ${formulaRefsChecked} formula refs · ${projectionsChecked} projections\n`);

    if (unknownFields.length) {
        console.log('FIELD NAMES THAT DO NOT EXIST IN THE BASE:');
        for (const u of unknownFields) console.log(`  ${rel(u.file)}:${u.line}  {${u.name}}\n    ${u.text}`);
    }
    if (unknownFormulaRefs.length) {
        console.log('\nFORMULA REFERENCES THAT DO NOT EXIST (422s the whole query):');
        for (const u of unknownFormulaRefs) console.log(`  ${rel(u.file)}:${u.line}  {${u.name}}\n    ${u.text}`);
    }
    if (positional.length) {
        console.log('\nUNREVIEWED POSITIONAL LINK READS (pick by Status, not position — add `link-index-ok` once reviewed):');
        for (const p of positional) console.log(`  ${rel(p.file)}:${p.line}\n    ${p.text}`);
    }

    const failures = unknownFields.length + unknownFormulaRefs.length;
    if (failures === 0 && positional.length === 0) console.log('All field names exist; no unreviewed positional link reads.');
    process.exit(failures > 0 ? 1 : 0);
})().catch(err => {
    console.error('check-airtable-fields failed:', err.message);
    process.exit(2);
});
