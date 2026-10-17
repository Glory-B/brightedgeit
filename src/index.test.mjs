import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerSource = await readFile(new URL('./index.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript,${encodeURIComponent(workerSource)}`)).default;

const hostname = 'staging.brightedgeit.example';

function makeEnv(overrides = {}) {
    return {
        ASSETS: {
            async fetch() {
                return new Response('<!doctype html><title>BrightEdge</title>', {
                    headers: { 'content-type': 'text/html; charset=utf-8' }
                });
            }
        },
        TURNSTILE_SITEKEY: '0x4AAAAAAAstagingPublicKey',
        TURNSTILE_SECRET: 'staging-turnstile-secret',
        TURNSTILE_HOSTNAME: hostname,
        EMAIL_FROM: 'website@staging.brightedgeit.example',
        CONTACT_TO: 'enquiries@staging.brightedgeit.example',
        CONTACT_EMAIL: { async send() {} },
        ...overrides
    };
}

function contactRequest() {
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
            'cf-turnstile-response': 'valid-turnstile-token'
        })
    });
}

test('static assets receive the staging security headers', async () => {
    const response = await worker.fetch(new Request(`https://${hostname}/index.html`), makeEnv());

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('public Turnstile configuration is no-store and requires a configured key', async () => {
    const configured = await worker.fetch(new Request(`https://${hostname}/api/config`), makeEnv());
    assert.equal(configured.status, 200);
    assert.equal(configured.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await configured.json(), { turnstileSitekey: '0x4AAAAAAAstagingPublicKey' });

    const missing = await worker.fetch(new Request(`https://${hostname}/api/config`), makeEnv({
        TURNSTILE_SITEKEY: 'REPLACE_WITH_TURNSTILE_SITEKEY'
    }));
    assert.equal(missing.status, 503);
});

test('validates Turnstile action and hostname before delivering an enquiry', async t => {
    let verificationRequest;
    let delivery;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        verificationRequest = { url, init };
        return new Response(JSON.stringify({ success: true, action: 'contact', hostname }), {
            headers: { 'content-type': 'application/json' }
        });
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const response = await worker.fetch(contactRequest(), makeEnv({
        CONTACT_EMAIL: { async send(message) { delivery = message; } }
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(verificationRequest.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.match(verificationRequest.init.body.toString(), /response=valid-turnstile-token/);
    assert.equal(delivery.from, 'website@staging.brightedgeit.example');
    assert.equal(delivery.to, 'enquiries@staging.brightedgeit.example');
    assert.equal(delivery.replyTo, 'taylor@example.test');
    assert.match(delivery.text, /Taylor Ng/);
});

test('rejects a Turnstile token issued for a different hostname', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        success: true,
        action: 'contact',
        hostname: 'untrusted.example'
    }), { headers: { 'content-type': 'application/json' } });
    t.after(() => { globalThis.fetch = originalFetch; });

    const response = await worker.fetch(contactRequest(), makeEnv());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Spam verification failed. Please try again.' });
});

test('fails closed when the enquiry recipient is not configured', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: 'contact', hostname }), {
        headers: { 'content-type': 'application/json' }
    });
    t.after(() => { globalThis.fetch = originalFetch; });

    let sent = false;
    const response = await worker.fetch(contactRequest(), makeEnv({
        CONTACT_TO: 'REPLACE_WITH_VERIFIED_DESTINATION_EMAIL',
        CONTACT_EMAIL: { async send() { sent = true; } }
    }));
    assert.equal(response.status, 503);
    assert.equal(sent, false);
});

test('security policy blocks inline scripts and allows only the needed external sources', async () => {
    const response = await worker.fetch(new Request(`https://${hostname}/`), makeEnv());
    const csp = response.headers.get('content-security-policy');
    const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
    assert.doesNotMatch(scriptSrc, /unsafe-inline/);
    assert.match(csp, /img-src [^;]*https:\/\/images\.unsplash\.com/);
    assert.match(csp, /font-src 'self';/);
    assert.doesNotMatch(csp, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('staging and preview hosts are noindex and never get HSTS', async () => {
    const response = await worker.fetch(new Request(`https://${hostname}/`), makeEnv());
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('strict-transport-security'), null);

    const api = await worker.fetch(new Request(`https://${hostname}/api/config`), makeEnv());
    assert.equal(api.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('production hosts get HSTS and stay indexable', async () => {
    for (const host of ['brightedgeit.com.au', 'www.brightedgeit.com.au']) {
        const response = await worker.fetch(new Request(`https://${host}/`), makeEnv());
        assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
        assert.equal(response.headers.get('x-robots-tag'), null);
    }
});
