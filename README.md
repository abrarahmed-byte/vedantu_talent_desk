# Vedantu Talent Desk — zero-cost Cloudflare pilot

This repository is a fake-data proof of concept for Cloudflare Workers, D1 and static assets. It does not connect to the production Apps Script app and must not be loaded with real candidate information until Vedantu approves the storage and authentication design.

## Included

- Vedantu-themed discovery, sources and activity pages
- Six fictional canonical candidates and one merged duplicate
- D1 FTS5 indexed search plus freshness ranking
- Candidate cards with identity, contact, subject/function, grades, source, resume preview, interviewers, calls, views, history and match percentage
- Persistent profile views, resume previews and call outcomes
- Repository, source, job and access-preview metadata
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

## Before real candidate data

- configure Google Workspace authentication and enforce Admin/Recruiter authorization on every write endpoint;
- obtain Vedantu approval to store candidate fields in Cloudflare D1;
- add a signed connector secret between Apps Script and the Worker;
- connect only a fictional Google Sheet first;
- confirm retention, deletion, export and audit requirements;
- keep original resumes in Google Drive.
