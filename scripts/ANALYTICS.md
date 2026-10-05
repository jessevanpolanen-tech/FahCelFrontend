# Google Analytics 4: language traffic

## Finish connecting (Google account required)

1. Sign in at https://analytics.google.com/. Choose **Admin → Create → Account**
   if needed, then **Create → Property**. Name it FahCel and choose your reporting
   timezone/currency. Complete Google's business details and terms.
2. Create one **Web** data stream for your actual production domain. Use the same
   stream for all English, Dutch and German pages, not three properties.
3. For this page-view-only integration, turn **Enhanced measurement off** in the
   stream settings (avoids automatic form tracking and additional URL collection).
4. Copy the public **Measurement ID** beginning `G-` (not the numeric property ID).
   Set `measurementId` in `assets/analytics-config.js`; confirm `allowedHosts`
   matches your deployment domain. Do not add preview hosts to that list.
   This is a public identifier, so no API secret or Google account password is needed.
5. Deploy the changed static files through the repository's Vercel workflow.
   The sandbox preview is not production and deliberately sends no analytics.
6. Visit the deployed site with a fresh browser profile, allow analytics, then
   check **Reports → Realtime**. Rejecting analytics must produce no Google tag
   requests. Cookie settings lets a visitor withdraw consent; withdrawal deletes
   first-party `_ga` cookies, disables tracking, and reloads to unload the tag.

## Compare languages and equivalent pages

Under **Admin → Custom definitions**, create two **event-scoped** dimensions:

| Display name | Event parameter | Values |
|---|---|---|
| Site language | `site_language` | `en`, `nl`, `de` |
| Page group | `page_group` | `/`, `/hash-chain`, `/book-a-demo`, etc. |

Then create **Explore → Free form**:
- Import dimensions **Site language** and **Page group**, plus metric **Views**.
- Put **Page group** in rows, **Site language** in columns, **Views** in values.
- Sort descending by Views to see which language versions get most traffic.
- Custom dimensions can take 24–48 hours to become available and are not retroactive.
- Google's built-in **Language** dimension is the visitor's browser language, NOT
  the language version of the page. Use **Site language** for this comparison.
- **Pages and screens → Page path** can immediately distinguish `/nl/*`, `/de/*`
  and the English root routes without waiting for custom dimensions.

## Privacy and scope

The shared script is generated into the 15 public EN/NL/DE pages only; internal
operator pages and the hidden USB draft are excluded. It sends one page_view per
page load only after opt-in and only on allowed production hosts with a valid ID.
Advertising consent stays denied, Google signals and advertising personalization
are disabled. Query strings, fragments and form fields are not included in our
page-view payload. This intentionally omits campaign query attribution.
Consent (accept OR reject) is remembered on the same origin for 180 days and works
across languages. No Google tag or cookieless analytics pings load before consent.
Update your privacy notice for Google Analytics processing and review your Google
property settings/legal obligations before enabling collection. This banner is not
certification of GDPR compliance. Analytics measures consenting visitors only.

Until a real Measurement ID is supplied, consent controls work but Google receives
no traffic; a property has not been created automatically.
