# Start here

Vedantu Talent Desk is deployed from `abrarahmed-byte/vedantu_talent_desk` and uses the Cloudflare D1 database `vedantu_talent_desk_db`.

## Routine deployment

```text
npm install
npm run db:remote
npm test
npm run deploy
```

The `db:remote` command applies schema migrations only. It does not insert sample users, sources, candidates, calls, or activity.

## Source synchronization

1. Sign in through Cloudflare Access with an approved workspace account.
2. Deploy and configure the private Apps Script connector.
3. Add its URL and shared secret to the Worker.
4. Connect an application or employment Sheet from **Sources**.
5. Confirm imported, updated, merged, duplicate, skipped, and failed row counts.

Connected Sheets remain the source of truth. D1 stores standardized profiles, every application occurrence, employment matches, recruiter activity, and structured AI evidence. Obtain Vedantu approval before processing production candidate data with an external AI provider.
