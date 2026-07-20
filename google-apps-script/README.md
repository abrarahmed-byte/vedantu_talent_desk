# Google Sheets connector

This small Apps Script web app reads private Google Sheets using the deploying
admin's Google permissions. It returns only the requested rows to the Cloudflare
Worker and never exposes the connector secret to the browser.

One-time setup:

1. Create a standalone Apps Script project and paste `Code.gs`.
2. In Project Settings, add a Script Property named `CONNECTOR_SECRET` with a
   long random value.
3. Deploy as a Web App, executing as the project owner. Choose access that lets
   Cloudflare call the Web App; the shared secret still protects every data request.
4. Add the Web App URL to Cloudflare as `APPS_SCRIPT_CONNECTOR_URL`.
5. Add the same random value to Cloudflare as the encrypted
   `CONNECTOR_SECRET` secret.

Do this only after Cloudflare Access protects the Worker and Admin/Recruiter
users are present in D1.

The deploying account must be able to open every Sheet an Admin connects and
every Google Drive résumé that the AI evidence pilot processes. Google Docs are
exported to PDF; uploaded PDF and Word résumés retain their original file type.
The connector enforces a 5 MB résumé limit for the pilot. The
connector reads at most 200 rows per request; Cloudflare continues in batches
and updates the UI with progress and ETA.
