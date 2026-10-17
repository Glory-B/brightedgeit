# BrightEdge IT V2 production cutover plan

This is a launch plan only. Do not attach a production route, modify DNS, or promote a deployment until the owner approves the cutover window.

## Preconditions

1. `v2.0-relaunch` is deployed successfully to `brightedge-v2-contact` and its GitHub check identifies the intended commit.
2. Verify `GET /api/config` on staging returns only the public Turnstile key with `Cache-Control: no-store`.
3. Confirm the Turnstile widget configuration contains all three exact hostnames:
   - `brightedge-v2-contact.bahigwa.workers.dev`
   - `brightedgeit.com.au`
   - `www.brightedgeit.com.au`
4. Confirm Cloudflare Email Sending has the verified sender `noreply@brightedgeit.com.au`, destination `contact@brightedgeit.com.au`, and the encrypted `TURNSTILE_SECRET` remains configured.
5. Record the currently active production DNS records, Worker routes, certificate status, and the previous live origin/route before making any change.

## Cutover steps

1. In Cloudflare, confirm Universal SSL or an equivalent edge certificate is active for both `brightedgeit.com.au` and `www.brightedgeit.com.au` before routing either hostname to the Worker.
2. Attach the apex hostname to `brightedge-v2-contact` using the existing Cloudflare zone's Worker route/custom-domain workflow. Do not change the target of Microsoft 365 records.
3. Attach `www.brightedgeit.com.au` to the same Worker, then configure one canonical HTTPS redirect. The preferred canonical hostname must be chosen by the owner before launch; the other hostname must issue a single 301 redirect without a redirect chain.
4. Preserve the existing Worker code's production HSTS behaviour only after HTTPS is confirmed on both hostnames. Do not add `includeSubDomains` or `preload` during the first cutover.
5. Confirm the production URLs serve the intended commit and that staging remains reachable and marked `X-Robots-Tag: noindex, nofollow`.
6. Perform one labelled production contact submission only after the owner authorises it. Confirm receipt in `contact@brightedgeit.com.au`, sender `noreply@brightedgeit.com.au`, and the submitter Reply-To value. Do not send repeated live tests.

## DNS records that must remain untouched

Do not change, delete, proxy differently, or repoint Microsoft 365 records during the website cutover, including:

- MX records for `brightedgeit.com.au`
- SPF TXT records
- DKIM CNAME records
- DMARC TXT records
- Autodiscover records
- Any Microsoft verification records

Only the website apex/www routing records or Cloudflare Worker custom-domain attachments are in scope, and only after owner approval.

## Launch verification

Verify at both canonical and redirected hostname URLs:

- HTTPS certificate validity and no mixed-content errors
- One-hop canonical redirect behaviour
- Homepage, Microsoft 365, Cybersecurity, Contact, Privacy, and 404 page behaviour
- Navigation, mobile menu, footer, fonts, assets, and key calls to action
- Production pages do not emit the staging `X-Robots-Tag`
- Contact API rejects invalid Turnstile tokens and accepts one authorised smoke test
- Search console/crawler controls reflect production indexing only after the owner approves indexing

## Rollback

1. Remove the new Worker custom-domain attachments/routes or restore the recorded previous website origin/route. This is the primary rollback and does not modify code history.
2. Verify the former live website returns on both apex and www hostnames over HTTPS.
3. Leave Microsoft 365 MX, SPF, DKIM, DMARC, and Autodiscover records unchanged.
4. Keep the V2 staging Worker available for diagnosis, still `noindex`.
5. Record the rollback time, deployed Worker version, and the observed issue before scheduling another owner-approved cutover.
