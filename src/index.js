const ALLOWED_FIELDS = new Set([
    'firstName',
    'lastName',
    'email',
    'phone',
    'company',
    'service',
    'message',
    'privacy',
    'cf-turnstile-response'
]);

const SERVICE_OPTIONS = new Set([
    'cloud',
    'security',
    'analytics',
    'infrastructure',
    'support',
    'ai',
    'digital',
    'other'
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FORM_BODY_BYTES = 16_384;

const SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; script-src 'self' https://plausible.io https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; font-src 'self'; connect-src 'self' https://plausible.io; frame-src https://challenges.cloudflare.com",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN'
};

// Only the live site gets HSTS and is open to search engines; every other
// hostname (staging, *.workers.dev, previews) is marked noindex.
const PRODUCTION_HOSTNAMES = new Set(['brightedgeit.com.au', 'www.brightedgeit.com.au']);
const TRUSTED_TURNSTILE_HOSTNAMES = new Set([
    'brightedge-v2-contact.bahigwa.workers.dev',
    'brightedgeit.com.au',
    'www.brightedgeit.com.au'
]);
const HSTS_VALUE = 'max-age=31536000';

function withSecurityHeaders(response, request) {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    const hostname = request ? new URL(request.url).hostname : '';
    if (PRODUCTION_HOSTNAMES.has(hostname)) {
        headers.set('Strict-Transport-Security', HSTS_VALUE);
    } else {
        headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

function json(status, body, additionalHeaders = {}, request) {
    return withSecurityHeaders(new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...additionalHeaders }
    }), request);
}

function textValue(formData, name, maximumLength, required = false) {
    const values = formData.getAll(name);
    if (values.length > 1 || values.some(value => typeof value !== 'string')) return null;

    const value = (values[0] || '').trim();
    if ((required && !value) || value.length > maximumLength) return null;
    return value;
}

function hasSafeHeaderValue(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 254 && !/[\r\n]/.test(value);
}

function isConfiguredValue(value) {
    return hasSafeHeaderValue(value) && !value.startsWith('REPLACE_WITH_');
}

function isTrustedTurnstileHostname(hostname) {
    return typeof hostname === 'string' && TRUSTED_TURNSTILE_HOSTNAMES.has(hostname.toLowerCase());
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/api/config') {
            if (request.method !== 'GET') {
                return withSecurityHeaders(new Response('Method Not Allowed', {
                    status: 405,
                    headers: { Allow: 'GET' }
                }), request);
            }
            if (!isConfiguredValue(env.TURNSTILE_SITEKEY)) {
                return json(503, { error: 'Form configuration is unavailable.' }, { 'cache-control': 'no-store' }, request);
            }
            return json(200, { turnstileSitekey: env.TURNSTILE_SITEKEY }, { 'cache-control': 'no-store' }, request);
        }

        if (url.pathname !== '/api/contact') {
            return withSecurityHeaders(await env.ASSETS.fetch(request), request);
        }

        if (request.method !== 'POST') {
            return withSecurityHeaders(new Response('Method Not Allowed', {
                status: 405,
                headers: { Allow: 'POST' }
            }), request);
        }

        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('application/x-www-form-urlencoded')) {
            return json(415, { error: 'Unsupported form submission format.' }, {}, request);
        }

        const contentLength = Number(request.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BODY_BYTES) {
            return json(413, { error: 'Form submission is too large.' }, {}, request);
        }

        let formData;
        try {
            formData = await request.formData();
        } catch {
            return json(400, { error: 'Invalid form submission.' }, {}, request);
        }
        for (const [name] of formData.entries()) {
            if (!ALLOWED_FIELDS.has(name)) {
                return json(400, { error: 'Unsupported form field.' }, {}, request);
            }
        }

        const firstName = textValue(formData, 'firstName', 100, true);
        const lastName = textValue(formData, 'lastName', 100, true);
        const email = textValue(formData, 'email', 254, true);
        const phone = textValue(formData, 'phone', 50);
        const company = textValue(formData, 'company', 200);
        const service = textValue(formData, 'service', 50, true);
        const message = textValue(formData, 'message', 5000, true);
        const turnstileToken = textValue(formData, 'cf-turnstile-response', 2048, true);

        if (!firstName || !lastName || !email || !EMAIL_PATTERN.test(email) || !message || !turnstileToken || !SERVICE_OPTIONS.has(service)) {
            return json(400, { error: 'Please complete the required fields and spam check.' }, {}, request);
        }

        const privacyValues = formData.getAll('privacy');
        if (privacyValues.length !== 1 || privacyValues[0] !== 'on') {
            return json(400, { error: 'Privacy consent is required.' }, {}, request);
        }

        const requestHostname = url.hostname.toLowerCase();
        if (!isConfiguredValue(env.TURNSTILE_SECRET) || !isTrustedTurnstileHostname(env.TURNSTILE_HOSTNAME)) {
            return json(503, { error: 'Contact form verification is not configured.' }, {}, request);
        }
        if (!isTrustedTurnstileHostname(requestHostname)) {
            return json(403, { error: 'Spam verification failed. Please try again.' }, {}, request);
        }

        const siteverifyBody = new URLSearchParams({
            secret: env.TURNSTILE_SECRET,
            response: turnstileToken
        });
        const remoteIp = request.headers.get('CF-Connecting-IP');
        if (remoteIp) siteverifyBody.set('remoteip', remoteIp);

        let turnstileResponse;
        let turnstileResult;
        try {
            turnstileResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: siteverifyBody
            });
            turnstileResult = await turnstileResponse.json();
        } catch {
            return json(502, { error: 'Spam verification is unavailable. Please try again.' }, {}, request);
        }

        const verifiedHostname = typeof turnstileResult.hostname === 'string' ? turnstileResult.hostname.toLowerCase() : '';
        if (!turnstileResponse.ok || !turnstileResult.success || turnstileResult.action !== 'contact' || !isTrustedTurnstileHostname(verifiedHostname) || verifiedHostname !== requestHostname) {
            return json(403, { error: 'Spam verification failed. Please try again.' }, {}, request);
        }

        if (!env.CONTACT_EMAIL || !isConfiguredValue(env.EMAIL_FROM) || !isConfiguredValue(env.CONTACT_TO)) {
            return json(503, { error: 'Contact delivery is not configured.' }, {}, request);
        }

        const notification = [
            'New BrightEdge IT contact enquiry',
            '',
            `Name: ${firstName} ${lastName}`,
            `Email: ${email}`,
            `Phone: ${phone || 'Not supplied'}`,
            `Company: ${company || 'Not supplied'}`,
            `Service: ${service}`,
            '',
            'Message:',
            message
        ].join('\n');

        try {
            await env.CONTACT_EMAIL.send({
                to: env.CONTACT_TO,
                from: env.EMAIL_FROM,
                replyTo: email,
                subject: 'New BrightEdge IT contact enquiry',
                text: notification
            });
        } catch (error) {
            console.error('Contact email delivery failed', error && error.code ? error.code : 'unknown');
            return json(502, { error: 'Unable to send your message. Please try again.' }, {}, request);
        }

        return json(200, { ok: true }, {}, request);
    }
};
