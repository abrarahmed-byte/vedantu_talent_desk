# Vedantu Talent Desk

A Cloudflare Workers and D1 candidate repository for Vedantu recruitment. Connected Google Sheets remain the source of truth; synchronized application rows, employment history, deduplicated candidate profiles, recruiter activity, and AI-extracted resume evidence live in D1 for fast searches.

## What is included

- Vedantu-themed Discover, Sources, Activity, and Superadmin pages
- Natural-language search over the indexed D1 repository, with recent profiles favored after relevance
- Candidate cards and drawers with contact details, source, resume, match score, views, callers, calls, and timestamped history
- Google Sheet source wizard with automatic suggestions and manual column mapping
- Incremental background sync with progress, ETA, imported/updated/merged/failed totals, and duplicate reporting
- Active and former employee source matching
- Repository-driven filter lists that update with synchronized data
- Superadmin-only canonical record editor, original row inspection, user usage, operational reports, and CSV exports
- Superadmin, Admin, and Recruiter authorization; only a Superadmin can grant Superadmin access
- Persistent audit events attributed to the signed-in user's email
- No Interviews tab; the candidate profile's activity thread holds recruiter calls and outcomes

## AI resume classification and evidence

The asynchronous AI workflow processes up to 20 new profiles per batch. It reads the application row and resume together, saves structured facts and evidence to D1, and independently recommends **Teacher**, **Non-teaching**, or **Unclear** from resume evidence. The original source-sheet category remains available for comparison and audit.

The recommendation is a routing aid, not a hiring decision. Teaching requires direct resume evidence such as instruction, tutoring, faculty work, lesson delivery, or student assessment. Subject knowledge or a selected form option alone is not enough. Unsupported form claims remain visible as `claim_only` rather than being treated as false.

1. Apply all D1 migrations, including `0005_ai_enrichment.sql` and `0006_superadmin.sql`.
2. Deploy the current Apps Script connector so the Worker can securely read resume files.
3. Add `OPENAI_API_KEY` as an encrypted Cloudflare Worker secret. `AI_MODEL` defaults to `gpt-5-nano`.
4. Open **Sources** and select **Classify next 20 profiles**.
5. Monitor queued, processing, classified, and needs-attention totals without blocking search or source sync.

OpenAI Batch files and temporary resume uploads are deleted after the structured result is stored. Obtain Vedantu approval before processing production candidate data with an external AI provider.

## Roles

- **Recruiter:** discover profiles, inspect history, and log calls.
- **Admin:** Recruiter permissions plus connect and manage sources and workspace users.
- **Superadmin:** Admin permissions plus master reporting, exports, raw source-row access, audited canonical edits, and Superadmin access management.

The migration promotes `abrar.ahmed@vedantu.com` to the initial Superadmin and prevents removal of the final active Superadmin.

## Local validation

```text
npm install
npm run db:local
npm test
npm run dev
```

## Deployment

Apply D1 migrations before deploying code that depends on them:

```text
npx wrangler d1 migrations apply vedantu_talent_desk_db --remote
npx wrangler deploy
```

The current GitHub integration automatically deploys the `main` branch to Cloudflare. Original resumes stay in Google Drive; D1 stores the standardized profile, original source-row JSON, resume link, and structured AI evidence.
