# BrightEdge IT V2 staging readiness

This repository serves static site assets and the contact endpoint through the Cloudflare Worker in `src/index.js`. Production DNS, routes, and custom domains remain account-side and are not changed by this repository.

## Account-side prerequisites

Before a staging deployment, confirm:

1. The staging Worker hostname is `brightedge-v2-contact.bahigwa.workers.dev`.
2. Cloudflare Email Sending has `noreply@brightedgeit.com.au` onboarded and `contact@brightedgeit.com.au` verified as its destination.
3. The encrypted `TURNSTILE_SECRET` remains configured on `brightedge-v2-contact`. Its value is never stored in this repository. The `secrets.required` declaration in `wrangler.jsonc` makes a deployment fail if it is absent.
4. TLS/HTTPS works on staging and, before an owner-approved launch, both production hostnames. The Worker sends HSTS (`max-age=31536000`, no subdomains) only for `brightedgeit.com.au` and `www.brightedgeit.com.au`; every other hostname gets `X-Robots-Tag: noindex, nofollow`.

## Source-controlled configuration

`wrangler.jsonc` is the source of truth for all non-secret Worker configuration:

- `CONTACT_TO=contact@brightedgeit.com.au`
- `EMAIL_FROM=noreply@brightedgeit.com.au`
- `TURNSTILE_SITEKEY` (public key only)
- `TURNSTILE_HOSTNAME=brightedge-v2-contact.bahigwa.workers.dev`
- `CONTACT_EMAIL` Email Sending binding and its verified destination

The Worker accepts a Turnstile response only when its verified hostname equals the actual request hostname and both are one of these exact values:

- `brightedge-v2-contact.bahigwa.workers.dev`
- `brightedgeit.com.au`
- `www.brightedgeit.com.au`

`TURNSTILE_HOSTNAME` remains a deployment configuration guard and must itself be one of that explicit set; it does not weaken the request-host equality check.

Create `.dev.vars` from `.dev.vars.example` only when local Worker testing needs the secret; it is ignored by Git. Do not place a production secret in test fixtures, source files, prompts, or build logs.

## Implemented controls

- The public Turnstile key is obtained at runtime from `GET /api/config`, with `Cache-Control: no-store`; no secret is embedded in HTML.
- Contact submissions require a valid Turnstile response, `contact` action, exact trusted request/response hostname match, and configured email delivery before sending.
- The endpoint accepts only URL-encoded `POST` submissions with allowlisted fields, input limits, privacy consent, and valid service options.
- Static assets and API responses receive CSP, anti-framing, MIME-sniffing, referrer, permissions, and cross-origin isolation headers from the Worker.
- Static asset responses receive the same baseline policy from the Cloudflare `_headers` file because asset-first routing does not invoke the Worker for matching files. The Worker continues to set headers for API and other dynamic responses.

## Local verification

Run the Worker tests without installing dependencies:

```powershell
node --test src/index.test.mjs
```

The suite uses mock values and does not contact Cloudflare or send email.
