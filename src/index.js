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

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' }
    });
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname !== '/api/contact') {
            return env.ASSETS.fetch(request);
        }

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', {
                status: 405,
                headers: { Allow: 'POST' }
            });
        }

        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('application/x-www-form-urlencoded')) {
            return json(415, { error: 'Unsupported form submission format.' });
        }

        const formData = await request.formData();
        for (const [name] of formData.entries()) {
            if (!ALLOWED_FIELDS.has(name)) {
                return json(400, { error: 'Unsupported form field.' });
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
            return json(400, { error: 'Please complete the required fields and spam check.' });
        }

        if (formData.get('privacy') !== 'on') {
            return json(400, { error: 'Privacy consent is required.' });
        }

        if (!env.TURNSTILE_SECRET) {
            return json(503, { error: 'Contact form verification is not configured.' });
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
            return json(502, { error: 'Spam verification is unavailable. Please try again.' });
        }

        if (!turnstileResponse.ok || !turnstileResult.success) {
            return json(400, { error: 'Spam verification failed. Please try again.' });
        }

        if (!env.CONTACT_EMAIL || !hasSafeHeaderValue(env.EMAIL_FROM)) {
            return json(503, { error: 'Contact delivery is not configured.' });
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
                to: null,
                from: env.EMAIL_FROM,
                subject: 'New BrightEdge IT contact enquiry',
                text: notification
            });
        } catch (error) {
            console.error('Contact email delivery failed', error && error.code ? error.code : 'unknown');
            return json(502, { error: 'Unable to send your message. Please try again.' });
        }

        return json(200, { ok: true });
    }
};
