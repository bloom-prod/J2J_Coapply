# Bloom-tracker: Firestore → Drizzle/Postgres migration guide for route conversion

## Goal
Rewrite each `app/api/**/route.ts` Route Handler so it reads/writes Postgres via Drizzle instead of Firestore. Keep each handler's public response JSON shape and validation logic IDENTICAL to the current Firestore version — only swap the storage layer.

## Rules
- Database handle: `import { db } from "@/db";`  (drizzle instance)
- Query operators: `import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";`
- Auth: `import { requireUser, HttpError } from "@/lib/auth-server";`
  - `const user = await requireUser(req);` returns `{ id, uid, name, email, isAdmin }`.
  - **`user.id` is the Postgres UUID.** `user.uid === user.id`. Use `user.id` when writing to DB columns. Keep returning `user.uid`/`user.name` in responses to preserve the client contract.
- Errors: keep `function fail(status, error)` helper and the `if (err instanceof HttpError) return fail(...)` pattern.
- Transactions: `await db.transaction(async (tx) => { ... })` — use `tx` inside. For anything that must be atomic (mutation + related inserts + activity log), wrap in one transaction.
- Do NOT use `client` from "@/db" — only `db`.
- Do NOT modify: `db/schema.ts`, `db/index.ts`, `db/activity.ts`, `db/migrations/*`, `lib/jwt.ts`, `lib/auth-server.ts`, `lib/enums.ts`, `app/api/applications/route.ts`, `app/api/auth/*`. Those are already done.
- Match existing code style: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` at top, minimal comments only where the original had rationale comments.
- Do NOT run drizzle-kit or the app. Just write TypeScript. (No live DB exists.)

## DB schema (drizzle field names in `db/schema.ts`)
Tables (drizzle name → table):
- `users` (`id` uuid PK, `name`, `email`, `passwordHash`, `userColor`, `leetcodeRepoUrl`, `leetcodeLastSyncedAt`, `websiteUrl`, `linkedinUrl`, `githubUrl`, `isAdmin`, `updatedAt`)
- `lcProblems` (`problemId` text PK = slug like `0001-two-sum`, `problemName` notNull, `problemDifficulty` enum, `firstSeenAt`)
- `lcSolvedUser` (`userId`, `problemId`, `solvedAt`, `languageUsed`, `commitHash`; composite PK `[userId, problemId]`)
- `resumes` (`resumeId` uuid PK, `filePath` notNull, `createdAt`, `userId`, `fileName`, `resumeTitle`)
- `resumeComments` (`commentId` uuid PK, `createdAt`, `comment`, `commenterId`, `resolvedStatus` bool, `resumeId`)
- `applications` (`applicationId` uuid PK, `company` notNull, `createdAt`, `appliedDate`, `location`, `notes`, `applicantId`, `priority` enum, `recruiterName`, `role` notNull, `roleCategory` enum, `salary`, `starred`, `status` enum, `updatedAt`, `followUp`, `url`)
- `activityLog` (`activityId` uuid PK, `company`, `userId`, `occuredAt`, `type` enum, `role`, `status`, `resumeId`, `problemId`)
- `applicationUserStatus` (`statusLogId` uuid PK, `applicationId`, `changedById`, `status` enum, `changedAt`)
- `interviewPrep` (`postId` uuid PK, `company`, `postContent`, `createdAt`, `creatorId`, `postTitle`, `updatedAt`)
- `ivpComments` (`commentId` uuid PK, `commentedOn`, `commentedBy`, `commentContent`, `commentDate`)
- `jobboard` (`postId` uuid PK, `postedBy`, `company`, `createdAt`, `jobRole`, `jobUrl`, `jobLocation`, `jobNotes`)
- `dailyRoasts` (`roastDate` date, `userId`, `roastText`, `appsCount`, `generatedAt`; composite PK `[roastDate, userId]`)

## Activity log helper
`import { logActivity } from "@/db/activity";`
```ts
await logActivity(tx, {
  userId: user.id,
  type: "APPLIED",           // APPLIED | STATUS | OFFER | JOB_SHARE | RESUME_UPLOAD | RESUME_DELETE | LC_SOLVED
  company: "...", role: "...", status: "...",
  resumeId: "<uuid or undefined>", problemId: "<slug or undefined>",
  occuredAt: new Date(),
});
```
It takes a `tx` (transaction) OR `db`. Use `tx` when inside a mutation transaction.

## Name resolution (replaces the Firestore `userProfiles` join)
`import { namesByIds } from "@/db/activity";`
```ts
const nameById = await namesByIds(db, [...uniqueUserIds]);
// nameById[userId] ?? "" or fallback
```
Or for a single id just `select` name from `users`.

## User-profile handling
**There is no `userProfiles` collection anymore.** Logged-in user's profile fields live directly on the `users` row (`user.id`). So profile reads/writes hit `users`.

## Helper enums
`import { enumToStatus, statusToEnum, enumToPriority, priorityToEnum, enumToRoleCategory, roleCategoryToEnum } from "@/lib/enums";`
Used so the UI display strings (`"Applied"`, `"High"`, `"Software Engineering"`) map to Postgres enum values (`"APPLIED"`, `"HIGH"`, `"SOFTWARE_ENGINEERING"`) and back.

## Leetcode specifics
`lc_problems` holds each distinct problem (`problemId` slug = PK). `lc_solved_user` records a user solving it (composite PK `[userId, problemId]`). To upsert a solve:
```ts
await tx
  .insert(lcSolvedUser)
  .values({ userId, problemId, solvedAt, languageUsed, commitHash })
  .onConflictDoUpdate({
    target: [lcSolvedUser.userId, lcSolvedUser.problemId],
    set: { solvedAt, languageUsed: sql`${languageUsed ?? null}`, commitHash, solvedAt: sql`${solvedAt}` },
  });
```
Upsert the problem row the same way:
```ts
await tx
  .insert(lcProblems)
  .values({ problemId, problemName, problemDifficulty })
  .onConflictDoUpdate({
    target: lcProblems.problemId,
    set: { problemName: sql`${problemName}`, problemDifficulty: sql`${problemDifficulty ?? null}` },
  });
```
(difficulty values: `easy|medium|hard|unknown` → enum `EASY|MEDIUM|HARD|UNKNOWN` — map them.)

## Resumes file storage
`resumes.filePath` stores a filesystem path (schema dropped `fileBase64`). On upload: decode base64 body → write bytes to an uploads dir → set `filePath`. On GET by id: read the file → return `{ fileBase64, fileName }` (base64 of the file contents) to preserve the client contract. On delete: also delete the file off disk.
Use dir: `process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads", "resumes")`. Serve static via the existing `public/` folder (`/uploads/resumes/<id>.pdf`).