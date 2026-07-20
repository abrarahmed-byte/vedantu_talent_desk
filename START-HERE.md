# Start here

The pilot is ready for the empty GitHub repository `abrarahmed-byte/vedantu_talent_desk` and the existing Cloudflare D1 database `vedantu_talent_desk_db`.

## What happens during the first online test

1. Sign in to Cloudflare from the deployment tool.
2. Create the database tables in the already-empty D1 database.
3. Insert six fictional candidates and one fictional duplicate.
4. Deploy the Vedantu pilot to a free `workers.dev` address.
5. Test search, profile views, resume preview and call logging.

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

Do not connect the real Apps Script app or upload real data until Google Workspace sign-in and server-side Admin/Recruiter permissions have been added and Vedantu has approved Cloudflare as a candidate-data processor.
