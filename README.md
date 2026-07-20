# Vedantu Talent Desk — zero-cost Cloudflare pilot

This repository is a fake-data proof of concept for Cloudflare Workers, D1 and static assets. Private source connections are locked while `AUTH_MODE` is `pilot`; do not load real candidate information until Cloudflare Access and Vedantu's data approval are in place.

## Included

- Vedantu-themed discovery, sources and activity pages
- Six fictional canonical candidates and one merged duplicate
- D1 FTS5 indexed search plus freshness ranking
- Candidate cards with identity, contact, subject/function, grades, source, resume preview, interviewers, calls, views, history and match percentage
- Persistent profile views, resume previews and call outcomes
- Admin/Recruiter server authorization and server-attributed audit events
- Admin source wizard with automatic column suggestions and manual mapping
- Incremental background sync, progress, ETA and import/duplicate/failure reporting
- Central email/phone identity matching, duplicate merging and profile updates
- Repository, source, job and workspace-access metadata
- A zero-cost Apps Script connector for private Google Sheets
- No Interviews tab
- No paid AI dependency

## First deployment

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Run `npx wrangler login` and approve the Cloudflare sign-in in the browser.
4. Confirm `wrangler.jsonc` contains the existing `vedantu_talent_desk_db` database identifier.
5. Run `npm run db:remote` once. This creates the pilot tables and inserts only fictional profiles.
6. Run `npm run deploy`.
7. Open the `workers.dev` URL printed after deployment.

The migration is safe to rerun. The fictional seed uses stable IDs and `INSERT OR IGNORE` so it does not duplicate profiles.

## Local validation

Run `npm run db:local`, then `npm run dev`. Search and activity tests run with `npm test`.

## Unlocking a fictional Google Sheet test

1. Protect the Worker with Cloudflare Access and allow only approved Vedantu email addresses.
2. Apply all D1 migrations, including the source, access and identity tables.
3. Deploy `google-apps-script/Code.gs` as a Web App executing as the Sheet-owning Admin.
4. Save `APPS_SCRIPT_CONNECTOR_URL` as a Worker variable and `CONNECTOR_SECRET` as an encrypted Worker secret.
5. Change `AUTH_MODE` to `cloudflare-access`; keep `ALLOW_PILOT_SOURCE_SYNC` false.
6. Connect only the fictional test Sheet and verify the row, failure and duplicate totals.

Before real candidate data, obtain Vedantu approval for Cloudflare storage, retention, deletion, export and audit requirements. Original resumes remain in Google Drive; D1 stores the standardized profile and the Drive link.
