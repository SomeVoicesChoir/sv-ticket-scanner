#!/usr/bin/env node
// One-time setup: creates the Google Wallet Pass Class that all per-ticket
// Pass Objects will reference. Run locally with the service account JSON file
// you downloaded from Google Cloud Console.
//
// Usage:
//   node scripts/setup-google-pass-class.js <path-to-service-account.json>
//
// Idempotent — re-running prints "already exists" instead of erroring.

const fs = require('fs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const ISSUER_ID = '3388000000023146852';
const CLASS_SUFFIX = 'sv-event-ticket-v1';
const CLASS_ID = `${ISSUER_ID}.${CLASS_SUFFIX}`;

async function getAccessToken(serviceAccount) {
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };
    const assertion = jwt.sign(claim, serviceAccount.private_key, { algorithm: 'RS256' });

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: assertion
        })
    });

    if (!response.ok) {
        throw new Error(`Token request failed (${response.status}): ${await response.text()}`);
    }

    const { access_token } = await response.json();
    return access_token;
}

async function createClass(accessToken) {
    const classDef = {
        id: CLASS_ID,
        issuerName: 'Some Voices',
        reviewStatus: 'underReview',
        eventName: {
            defaultValue: { language: 'en-GB', value: 'Some Voices Event' }
        },
        hexBackgroundColor: '#f4dbc0',
        logo: {
            sourceUri: {
                uri: 'https://sv-ticket-scanner.vercel.app/some-voices-logo-square.png'
            },
            contentDescription: {
                defaultValue: { language: 'en-GB', value: 'Some Voices Logo' }
            }
        }
    };

    const response = await fetch(
        'https://walletobjects.googleapis.com/walletobjects/v1/eventTicketClass',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(classDef)
        }
    );

    if (response.status === 409) {
        console.log(`\n✓ Pass Class already exists: ${CLASS_ID}`);
        return CLASS_ID;
    }

    if (!response.ok) {
        throw new Error(`Failed to create class (${response.status}): ${await response.text()}`);
    }

    const data = await response.json();
    console.log(`\n✓ Pass Class created: ${data.id}`);
    return data.id;
}

async function main() {
    const jsonPath = process.argv[2];
    if (!jsonPath) {
        console.error('Usage: node scripts/setup-google-pass-class.js <path-to-service-account.json>');
        process.exit(1);
    }

    if (!fs.existsSync(jsonPath)) {
        console.error(`File not found: ${jsonPath}`);
        process.exit(1);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    console.log(`Service account: ${serviceAccount.client_email}`);
    console.log(`Issuer ID: ${ISSUER_ID}`);
    console.log(`Class ID: ${CLASS_ID}\n`);

    console.log('Getting access token...');
    const token = await getAccessToken(serviceAccount);

    console.log('Creating Pass Class...');
    const classId = await createClass(token);

    console.log('\nSet these Vercel env vars:');
    console.log(`  GOOGLE_WALLET_ISSUER_ID=${ISSUER_ID}`);
    console.log(`  GOOGLE_WALLET_PASS_CLASS_ID=${classId}`);
    console.log(`  GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=<paste the entire contents of your service account JSON file>`);
}

main().catch(err => {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
});
