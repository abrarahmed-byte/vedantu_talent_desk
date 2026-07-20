# Google Sheets connector

This small Apps Script web app reads private Google Sheets using the deploying
admin's Google permissions. It returns only the requested rows to the Cloudflare
Worker and never exposes the connector secret to the browser.

One-time setup:

1. Create a standalone Apps Script project and paste `Code.gs`.
2. In Project Settings, enable **Show appsscript.json manifest file in editor**
   and replace it with the included `appsscript.json`.
3. Select `authorizeTalentDeskAccess` in the editor, choose **Run**, and approve
   Sheets access and read-only Drive access. `SpreadsheetApp.openById()` requires
   Google's `spreadsheets` scope even though this connector only reads Sheet
   values. This must be done by the account that owns the web-app deployment.
4. In Project Settings, add a Script Property named `CONNECTOR_SECRET` with a
   long random value.
5. Deploy a **new Web App version**, executing as the project owner. Choose access that lets
   Cloudflare call the Web App; the shared secret still protects every data request.
6. Add the Web App URL to Cloudflare as `APPS_SCRIPT_CONNECTOR_URL`.
7. Add the same random value to Cloudflare as the encrypted
   `CONNECTOR_SECRET` secret.

Do this only after Cloudflare Access protects the Worker and Admin/Recruiter
users are present in D1.

The deploying account must be able to open every Sheet an Admin connects and
every Google Drive résumé that the AI evidence pipeline processes. Google Docs are
exported to PDF; uploaded PDF and Word résumés retain their original file type.
The connector enforces a 5 MB résumé-processing limit. The
connector reads at most 200 rows per request; Cloudflare continues in batches
and updates the UI with progress and ETA.

If **Profiles needing attention** shows a `DriveApp.getFileById` permission
error, repeat steps 2, 3, and 5, then use **Retry all after fixing access** in
Talent Desk. Temporary network and OpenAI service failures retry automatically.

If a source sync shows a `SpreadsheetApp.openById` permission error, confirm the
manifest uses `https://www.googleapis.com/auth/spreadsheets`, then repeat steps
3 and 5 before retrying the source.
