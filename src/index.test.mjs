import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerSource = await readFile(new URL('./index.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript,${encodeURIComponent(workerSource)}`)).default;

const stagingHostname = 'brightedge-v2-contact.bahigwa.workers.dev';
const trustedHostnames = [
    stagingHostname,
    'brightedgeit.com.au',
    'www.brightedgeit.com.au'
];

function makeEnv(overrides = {}) {
    return {
        ASSETS: {
            async fetch() {
                return new Response('<!doctype html><title>BrightEdge</title>', {
                    headers: { 'content-type': 'text/html; charset=utf-8' }
                });
            }
        },
        TURNSTILE_SITEKEY: '0x4AAAAAAAtestPublicKey',
        TURNSTILE_SECRET: 'test-turnstile-secret',
        TURNSTILE_HOSTNAME: stagingHostname,
        EMAIL_FROM: 'noreply@brightedgeit.example',
        CONTACT_TO: 'contact@brightedgeit.example',
        CONTACT_EMAIL: { async send() {} },
        ...overrides
    };
}

function contactRequest(hostname = stagingHostname, fields = {}) {
    return new Request(`https://${hostname}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            firstName: 'Taylor',
            lastName: 'Ng',
            email: 'taylor@example.test',
            phone: '0400 000 000',
            company: 'Example Co',
            service: 'security',
            message: 'Please contact me about security support.',
            privacy: 'on',
            'cf-turnstile-response': 'valid-turnstile-token',
            ...fields
        })
    });
}

function mockSiteverify(t, result) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' }
    });
    t.after(() => { globalThis.fetch = originalFetch; });
}

test('source configuration declares non-secret settings and only the Turnstile secret name', async () => {
    const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

    assert.deepEqual(config.vars, {
        CONTACT_TO: 'contact@brightedgeit.com.au',
        EMAIL_FROM: 'noreply@brightedgeit.com.au',
        TURNSTILE_SITEKEY: '0x4AAAAAAFY_T5Ci7Q9aalM-',
        TURNSTILE_HOSTNAME: stagingHostname
    });
    assert.deepEqual(config.secrets, { required: ['TURNSTILE_SECRET'] });
    assert.equal(config.send_email[0].name, 'CONTACT_EMAIL');
    assert.equal(config.send_email[0].destination_address, 'contact@brightedgeit.com.au');
});

test('static-asset header rules mirror the Worker security and indexing policy', async () => {
    const headers = await readFile(new URL('../_headers', import.meta.url), 'utf8');

    assert.match(headers, /Content-Security-Policy: default-src 'self'/);
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    assert.match(headers, /X-Frame-Options: SAMEORIGIN/);
    assert.match(headers, /https:\/\/:version\.:subdomain\.workers\.dev\/\*[\s\S]*X-Robots-Tag: noindex, nofollow/);
    assert.match(headers, /https:\/\/brightedgeit\.com\.au\/\*[\s\S]*Strict-Transport-Security: max-age=31536000/);
    assert.match(headers, /https:\/\/www\.brightedgeit\.com\.au\/\*[\s\S]*Strict-Transport-Security: max-age=31536000/);
});

test('static assets receive the staging security headers', async () => {
    const response = await worker.fetch(new Request(`https://${stagingHostname}/index.html`), makeEnv());

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('public Turnstile configuration is no-store and requires a configured key', async () => {
    const configured = await worker.fetch(new Request(`https://${stagingHostname}/api/config`), makeEnv());
    assert.equal(configured.status, 200);
    assert.equal(configured.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await configured.json(), { turnstileSitekey: '0x4AAAAAAAtestPublicKey' });

    const missing = await worker.fetch(new Request(`https://${stagingHostname}/api/config`), makeEnv({
        TURNSTILE_SITEKEY: 'REPLACE_WITH_TURNSTILE_SITEKEY'
    }));
    assert.equal(missing.status, 503);
});

test('accepts valid Turnstile responses for each exact trusted hostname', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });

    for (const hostname of trustedHostnames) {
        let delivery;
        let verificationRequest;
        globalThis.fetch = async (url, init) => {
            verificationRequest = { url, init };
            return new Response(JSON.stringify({ success: true, action: 'contact', hostname }), {
                headers: { 'content-type': 'application/json' }
            });
        };

        const response = await worker.fetch(contactRequest(hostname), makeEnv({
            CONTACT_EMAIL: { async send(message) { delivery = message; } }
        }));

        assert.equal(response.status, 200, hostname);
        assert.deepEqual(await response.json(), { ok: true });
        assert.equal(verificationRequest.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
        assert.match(verificationRequest.init.body.toString(), /response=valid-turnstile-token/);
        assert.equal(delivery.from, 'noreply@brightedgeit.example');
        assert.equal(delivery.to, 'contact@brightedgeit.example');
        assert.equal(delivery.replyTo, 'taylor@example.test');
        assert.match(delivery.text, /Taylor Ng/);
    }
});

test('rejects an untrusted request hostname before verification or email delivery', async t => {
    const originalFetch = globalThis.fetch;
    let verificationAttempts = 0;
    let sent = false;
    globalThis.fetch = async () => { verificationAttempts += 1; throw new Error('must not verify'); };
    t.after(() => { globalThis.fetch = originalFetch; });

    const response = await worker.fetch(contactRequest('preview.brightedgeit.com.au'), makeEnv({
        CONTACT_EMAIL: { async send() { sent = true; } }
    }));

    assert.equal(response.status, 403);
    assert.equal(verificationAttempts, 0);
    assert.equal(sent, false);
});

test('rejects a valid Turnstile token issued for a different trusted hostname', async t => {
    mockSiteverify(t, { success: true, action: 'contact', hostname: 'brightedgeit.com.au' });
    let sent = false;

    const response = await worker.fetch(contactRequest(stagingHostname), makeEnv({
        CONTACT_EMAIL: { async send() { sent = true; } }
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Spam verification failed. Please try again.' });
    assert.equal(sent, false);
});

test('rejects action mismatches, failed verification, and replay failures before email delivery', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    const results = [
        { success: true, action: 'other', hostname: stagingHostname },
        { success: false, action: 'contact', hostname: stagingHostname },
        { success: false, action: 'contact', hostname: stagingHostname, 'error-codes': ['timeout-or-duplicate'] }
    ];

    for (const result of results) {
        let sent = false;
        globalThis.fetch = async () => new Response(JSON.stringify(result), {
            headers: { 'content-type': 'application/json' }
        });
        const response = await worker.fetch(contactRequest(), makeEnv({
            CONTACT_EMAIL: { async send() { sent = true; } }
        }));
        assert.equal(response.status, 403);
        assert.equal(sent, false);
    }
});

test('rejects malformed sender input and does not allow it to trigger verification or email', async t => {
    const originalFetch = globalThis.fetch;
    let verificationAttempts = 0;
    let sent = false;
    globalThis.fetch = async () => { verificationAttempts += 1; throw new Error('must not verify'); };
    t.after(() => { globalThis.fetch = originalFetch; });

    const response = await worker.fetch(contactRequest(stagingHostname, {
        email: 'taylor@example.test\r\nBcc: attacker@example.test'
    }), makeEnv({ CONTACT_EMAIL: { async send() { sent = true; } } }));

    assert.equal(response.status, 400);
    assert.equal(verificationAttempts, 0);
    assert.equal(sent, false);
});

test('fails closed when the configured hostname or enquiry recipient is not configured', async t => {
    mockSiteverify(t, { success: true, action: 'contact', hostname: stagingHostname });
    let sent = false;

    const invalidHostname = await worker.fetch(contactRequest(), makeEnv({
        TURNSTILE_HOSTNAME: 'untrusted.example',
        CONTACT_EMAIL: { async send() { sent = true; } }
    }));
    assert.equal(invalidHostname.status, 503);
    assert.equal(sent, false);

    const missingRecipient = await worker.fetch(contactRequest(), makeEnv({
        CONTACT_TO: 'REPLACE_WITH_VERIFIED_DESTINATION_EMAIL',
        CONTACT_EMAIL: { async send() { sent = true; } }
    }));
    assert.equal(missingRecipient.status, 503);
    assert.equal(sent, false);
});

test('returns a safe error when email delivery fails', async t => {
    mockSiteverify(t, { success: true, action: 'contact', hostname: stagingHostname });
    const response = await worker.fetch(contactRequest(), makeEnv({
        CONTACT_EMAIL: { async send() { const error = new Error('provider failure'); error.code = 'delivery_failed'; throw error; } }
    }));

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Unable to send your message. Please try again.' });
});

test('security policy blocks inline scripts and allows only the needed external sources', async () => {
    const response = await worker.fetch(new Request(`https://${stagingHostname}/`), makeEnv());
    const csp = response.headers.get('content-security-policy');
    const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
    assert.doesNotMatch(scriptSrc, /unsafe-inline/);
    assert.match(csp, /img-src [^;]*https:\/\/images\.unsplash\.com/);
    assert.match(csp, /font-src 'self';/);
    assert.doesNotMatch(csp, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('staging and preview hosts are noindex and never get HSTS', async () => {
    const response = await worker.fetch(new Request(`https://${stagingHostname}/`), makeEnv());
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('strict-transport-security'), null);

    const api = await worker.fetch(new Request(`https://${stagingHostname}/api/config`), makeEnv());
    assert.equal(api.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('production hosts get HSTS and stay indexable', async () => {
    for (const host of ['brightedgeit.com.au', 'www.brightedgeit.com.au']) {
        const response = await worker.fetch(new Request(`https://${host}/`), makeEnv());
        assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
        assert.equal(response.headers.get('x-robots-tag'), null);
    }
});
