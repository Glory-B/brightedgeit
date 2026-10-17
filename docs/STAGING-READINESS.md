# BrightEdge IT V2.0 staging readiness

This repository is prepared to serve static site assets and the contact endpoint through the Cloudflare Worker in `src/index.js`. No production domain, DNS, route, or Cloudflare account setting is encoded here.

## Required Cloudflare staging configuration

Before a staging deployment, confirm and configure these account-side values:

1. A distinct staging hostname and the Worker route/custom domain serving it.
2. A Turnstile widget whose allowed hostname includes that exact staging hostname.
3. Worker secrets and variables (never commit them):
   - `TURNSTILE_SITEKEY` — public site key for the staging widget.
   - `TURNSTILE_SECRET` — matching secret key.
   - `TURNSTILE_HOSTNAME` — exact expected Turnstile hostname.
   - `EMAIL_FROM` — an onboarded Cloudflare Email Sending sender address.
   - `CONTACT_TO` — the verified address that receives enquiries (must match the binding's destination address).
4. The `CONTACT_EMAIL` Email Sending binding destination in `wrangler.jsonc`. Replace `REPLACE_WITH_VERIFIED_DESTINATION_EMAIL` with a verified recipient before deployment.
5. TLS/HTTPS on the staging and production hostnames. The Worker sends HSTS (`max-age=31536000`, no subdomains) only for `brightedgeit.com.au` and `www.brightedgeit.com.au`; every other hostname gets `X-Robots-Tag: noindex, nofollow` so staging stays out of search results. Update `PRODUCTION_HOSTNAMES` in `src/index.js` if the live domain changes.

Create `.dev.vars` from `.dev.vars.example` for local Worker testing; it is ignored by Git.

## Implemented local controls

- The public Turnstile key is obtained at runtime from `GET /api/config`, with `Cache-Control: no-store`; no keys are embedded in the HTML.
- Contact submissions require a valid Turnstile response, `contact` action, and configured expected hostname before email delivery.
- The endpoint accepts only URL-encoded `POST` submissions with allowlisted fields, input limits, privacy consent, and valid service options.
- Static assets and API responses receive CSP, anti-framing, MIME-sniffing, referrer, permissions, and cross-origin isolation headers from the Worker.

## Local verification

Run the Worker tests without installing dependencies:

```powershell
node --test src/index.test.mjs
```

The test suite uses mock values and does not send an email or contact Cloudflare.
