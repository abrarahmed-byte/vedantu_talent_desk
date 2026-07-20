# Start here

The pilot is deployed from `abrarahmed-byte/vedantu_talent_desk` and uses the existing Cloudflare D1 database `vedantu_talent_desk_db`.

## Current safe stage

The public pilot contains six fictional candidates and keeps real Google Sheets locked. The next test is:

1. enable Cloudflare Access for approved Vedantu users;
2. deploy the private Apps Script Sheet reader;
3. add its URL and shared secret to the Worker;
4. connect the fictional response Sheet through the Admin wizard;
5. confirm new, updated, merged, duplicate and failed row counts.

No Google Sheet, real candidate, employee record or real resume is used in this first test.

## Commands used by the deployment helper

```text
npm install
npx wrangler login
npm run db:remote
npm run deploy
```

Cloudflare prints the test website address after the final step.

## Safety boundary

Do not connect a real application Sheet until Cloudflare Access is enforced and Vedantu has approved Cloudflare as a candidate-data processor. The code intentionally rejects source and user-management actions in public pilot mode.
