# Solution Documentation

## Part 1: Performance Issues Fixed

### Missing indexes on frequently filtered columns

**Problem Identified:**

`GET /tasks` supports filtering by `status`, `priority`, `assigneeId`, `projectId`, and a `dueDate` range. None of those columns had an index, so every filtered query was a full table scan on `Task`. At small seed counts you don't feel it. At a few thousand rows it shows up immediately in the load test.

**Solution Implemented:**

Added a single-column btree index on each of the five columns: `status`, `priority`, `assigneeId`, `projectId`, `dueDate`. I went with five separate indexes instead of one composite index on purpose. The bug report named several different filter combinations (status alone, status + date range, status + assignee, all four together, etc), and a composite index only pulls its weight when queries hit it in the same column order it was built with. Postgres can combine multiple single-column indexes through a bitmap index scan for whatever AND combination shows up at query time, so this covers every combo named in the brief without betting on one specific access pattern. The trade-off is each individual index is a bit less selective than a tailored composite would be for its one best case, but it's the right call when you don't actually know which combination a given request will use.

**Performance Impact:**

Indexes alone don't fix everything here since the N+1 and pagination issues below were compounding the same query. See the combined numbers under the next section, since all three landed in the same commit and the load test measures their combined effect, not each one in isolation.

### N+1 query in findAll

**Problem Identified:**

The original `findAll` was loading each task's `assignee`, `project`, and `tags` with separate queries per task instead of a join. For a page of 20 tasks that's roughly 1 query for the tasks plus up to 60 more for their relations. At 5,000 seeded tasks with no pagination yet (see next issue), this was the dominant cost.

**Solution Implemented:**

Replaced the per-row relation fetching with a single `include` on the `findMany` call (`assignee`, `project`, `tags` all included in one query via Prisma's join), and moved every filter condition into one `where` clause built by `buildWhere()` instead of filtering in application code after the fact. One query in, one query out, with the database doing the join instead of the app doing N+1 round trips.

**Performance Impact:**

Measured with `scripts/load_test.py` against ~5,000 seeded tasks, before and after every Part 1 fix landed (this includes indexes, N+1, pagination, and email decoupling together, since that's how the load test actually measures the endpoint):

| combo | pre-fix p50 | post-fix p50 | pre-fix p99 | post-fix p99 |
|---|---|---|---|---|
| no_filter | 400.11ms | 14.21ms | 633.00ms | 51.30ms |
| status_only | 457.13ms | 11.73ms | 654.21ms | 18.65ms |
| status_and_assignee | 461.98ms | 11.39ms | 664.15ms | 15.78ms |
| all_filters | 386.67ms | 12.40ms | 749.35ms | 17.66ms |

Full numbers for every combo are in `BASELINE.md`. Roughly 25x to 46x faster depending on combo, with zero errors on either run. The single-task lookup (`GET /tasks/:id`) barely moved, 16.43ms to 7.07ms, because it was never affected by either bug in the first place, it's just one indexed primary key lookup. That's a useful sanity check that the improvement actually came from fixing the list endpoint and not from some unrelated change.

### Unbounded result set on GET /tasks

**Problem Identified:**

`GET /tasks` returned every matching row with no limit. Combined with the N+1 problem above, this meant a single request could trigger thousands of relation queries and ship back a response body with every task in the system.

**Solution Implemented:**

Added `page` and `perPage` query params, defaulting to `page=1` and `perPage=20`. The response shape changed from a bare array to `{ data, meta }`, where `meta` carries `page`, `perPage`, `total`, and `totalPages`. This is a breaking change to the response contract, called out explicitly rather than slipped in quietly, and the existing e2e test got updated to match the new shape as part of the same commit.

One bug worth being honest about here: the original `orderBy` was `{ createdAt: 'desc' }` alone. At 5,000 rows created in a tight seeding loop, plenty of rows share the same `createdAt` timestamp down to the millisecond. Without a tiebreaker, Postgres doesn't guarantee the same row ordering across two separate paginated queries, so the same task could show up on both page 1 and page 2. The e2e pagination test caught this directly, asserting page 1 and page 2 don't overlap, and it failed. Fixed by adding `id` as a secondary sort key: `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`. Found and fixed the same latent issue in `ActivitiesService` while I was there, even though no test had hit that scale yet.

**Performance Impact:**

Covered in the table above, since pagination and the N+1 fix landed together and the load test measures the endpoint as a whole.

### Email send blocking the request lifecycle

**Problem Identified:**

Task creation and assignment used to call the email service inline and wait for it to finish before responding. `EmailService.sendEmail` simulates a 2 second network delay, so every `POST /tasks` or `PUT /tasks/:id` that touched an assignee was stuck waiting 2 full seconds for an email that has nothing to do with whether the task mutation itself succeeded.

**Solution Implemented:**

`TasksService` now emits a `task.assigned` event via `EventEmitter2` instead of awaiting an email call directly. `EmailListener` picks that event up and calls the email service from its own handler, wrapped in a `try/catch` that logs failures with `Logger.error` instead of letting them propagate. The emit itself is fire-and-forget, Nest's `EventEmitter2.emit()` (as opposed to `emitAsync()`) doesn't wait on listener completion, so the HTTP response goes out the moment the task mutation transaction commits, regardless of how long the email takes or whether it succeeds at all.

This got tested two ways. An e2e test asserts task creation with an assignee responds in well under 1 second, proving the request isn't blocked on the 2 second delay. A separate test overrides `EmailService` with a mock that always rejects and confirms task creation still returns 201, proving a failed send doesn't take the request down with it.

**Performance Impact:**

Any request involving an assignee dropped from a guaranteed 2+ second floor to whatever the actual task mutation costs, which after the other fixes is single-digit to low double-digit milliseconds.

### No caching on GET /projects and GET /users

**Problem Identified:**

`/projects` and `/users` get hit on basically every page load in a typical client (populating dropdowns, filters, etc), and the underlying data changes rarely if at all, since there are no mutation endpoints for either resource right now.

**Solution Implemented:**

Added Redis caching via `@nestjs/cache-manager` and `cache-manager-redis-yet`, registered globally in `app.module.ts` with the connection URL pulled from `REDIS_URL`. This is specifically safe for these two resources and not a general pattern to copy elsewhere without thinking about it: since neither `Project` nor `User` has a POST, PUT, or DELETE endpoint anywhere in the API, there's no path that could ever write through this API and leave a stale cache behind. If a mutation endpoint gets added to either resource later, this caching needs an invalidation strategy added at the same time, not as an afterthought.

**Performance Impact:**

Not separately load tested, since the brief's load test combos target `/tasks`. Conceptually this removes repeated database round trips for data that doesn't change, which matters more under concurrent load than in a single-request benchmark.

## Part 2: Activity Log Feature

### Implementation Approach

The core idea is that an activity log is only as trustworthy as its connection to the events it's supposed to record. So every design decision here optimizes for "the log can never silently drift from what actually happened to a task," even where that costs a bit of extra complexity.

Concretely that means: activity writes happen inside the exact same database transaction as the task mutation they're logging, using one generic diffing function shared across create, update, and delete instead of three separate ad hoc implementations, and a row lock on update/delete specifically to prevent two concurrent requests from both reading the same stale "before" state and producing a wrong diff.

There's no auth system in this codebase yet, so attribution uses a mock current user, documented openly as a known gap rather than hidden behind something that looks like real auth.

### Database Schema Design

```prisma
model Activity {
  id        String         @id @default(uuid())
  taskId    String
  taskTitle String
  userId    String
  userName  String
  action    ActivityAction
  changes   Json?
  createdAt DateTime       @default(now())

  @@index([taskId])
  @@index([userId])
  @@index([createdAt])
  @@index([action])
}

enum ActivityAction {
  CREATE
  UPDATE
  DELETE
}
```

The single decision that shapes everything else here: `Activity` has no `@relation` to `Task` or `User` at all. `taskId` and `userId` are plain indexed strings, not foreign keys.

That looks wrong at first glance, but walk through what happens with a real FK. Prisma's default `onDelete` behavior is `Restrict`, which means the moment a task has even one activity row (and it always does, since CREATE gets logged immediately), deleting that task would throw a foreign key violation. So `DELETE /tasks/:id` would break for every task that has any history at all, which is most of them after the first mutation. Switching to `onDelete: Cascade` fixes that, but creates a worse problem: deleting the task would delete its own DELETE log entry in the same cascade, which defeats the entire point of having an audit trail for deletions. There's no `onDelete` setting that gives you both "deleting a task doesn't error" and "the deletion gets logged and survives."

Dropping the relation entirely sidesteps both problems. `taskId` becomes a plain string with an index, no constraint enforced at the database level. `taskTitle` and `userName` get denormalized directly onto the Activity row at write time, so a log entry stays fully readable forever, even after the task or user it references is gone. The four indexes (`taskId`, `userId`, `createdAt`, `action`) are individual single-column indexes for the same reasoning as the Task indexes above: any of them could be a query filter on `GET /activities`, and Postgres can combine them via bitmap scans for whatever combination a request actually uses.

`changes` is a single nullable `Json` column shaped as `{ field: { from, to } }`, holding only the fields that actually changed, not a full before/after snapshot of the whole row. `action` is a proper Postgres enum rather than a free string, matching how `TaskStatus` and `TaskPriority` are already modeled, which gets you query-param validation on `GET /activities?action=` for free.

### API Design Decisions

Two endpoints, both returning the same `{ data, meta }` pagination envelope used by `GET /tasks`, so a client consuming this API only has to learn one response shape:

- `GET /activities`, filterable by `taskId`, `userId`, `action`, and a `createdFrom`/`createdTo` date range (naming kept consistent with the existing `dueDateFrom`/`dueDateTo` convention on the task filter)
- `GET /tasks/:id/activities`, which is really the same query with `taskId` forced from the path param instead of the query string

Both routes share one `ActivitiesService.findAll()` implementation. The path param wins if a request somehow supplies both a path `:id` and a conflicting `?taskId=` query param, since the path is the more specific intent.

The diffing logic itself is one function, `diffTask(before, after)`, used identically for all three actions:

- CREATE: `before` is `null`, so every set field shows up as `{ from: null, to: value }`
- UPDATE: both `before` and `after` are real states, only the fields that actually changed appear in the output
- DELETE: `after` is `null`, so every previously set field shows up as `{ from: value, to: null }`

One function, three call sites, no special casing per action. `tagIds` gets compared as a set rather than a list, sorted before comparison, so a many-to-many relation coming back in a different order on re-fetch doesn't register as a fake change. If an UPDATE genuinely changes nothing (a PUT with no actual field differences), no activity row gets written at all rather than logging an empty diff. That keeps the log meaningful instead of filling it with no-op noise.

### Performance Considerations

The activity write for create, update, and delete all happen inside the same Prisma `$transaction` as the mutation itself, so a task changing and its corresponding log entry either both commit or both roll back together. There's no window where the database has a task mutation with no log entry, or a log entry for something that didn't actually happen.

For update and delete specifically, before reading anything else, the transaction takes a row lock with `SELECT id FROM "Task" WHERE id = $1 FOR UPDATE`. This matters because Postgres's default isolation level, Read Committed, doesn't on its own stop two concurrent requests from both reading the same "before" state. Without the lock, two PUTs racing each other against the same task could both diff against a stale snapshot, and one of their changes could get silently dropped from the log even though the final task state ends up correct. The lock forces the second request to wait until the first one's transaction commits, so it reads genuinely fresh state. This got verified with a test that fires 10 concurrent PUT requests at one task and asserts exactly 10 UPDATE activity rows come out the other side, not 9, not 11.

No queue or outbox pattern in front of the activity write. I considered it, since the brief's own deferred-items list calls out an outbox pattern as something worth a one-line mention. Decided against it specifically for Activity: the write itself is a single indexed insert inside a transaction that's already open, so there's no real latency to claim back the way there was with the 2 second email call. Moving it off the request path would trade a real correctness guarantee (every mutation has exactly one corresponding log entry, always) for a performance win that doesn't actually exist here. If Activity writes ever start doing something heavier, like firing webhooks or updating a search index, this is worth revisiting.

### Trade-offs and Assumptions

- No real authentication exists, so every activity is attributed to a hardcoded mock user via a `@CurrentUser()` decorator. It checks `request.user` first and only falls back to the mock constant, so wiring up real auth later means every controller that already uses `@CurrentUser()` starts working correctly with no further changes needed at the call sites.
- No database-level referential integrity between `Activity` and `Task`/`User`, by design, for the reasons covered in the schema section above. In practice `taskId` is always real at write time since the only code path that writes an Activity row is inside `TasksService`'s own transaction, immediately alongside a real Task row, but the database itself doesn't enforce that.
- `changes` stores only the diff, not a full snapshot of the row before and after. This is more compact and matches what the e2e tests assert against, but it means reconstructing the complete state of a task at some point in its history would require replaying every diff from creation forward rather than just reading one row.
- P2002 (Postgres unique constraint violation) isn't currently reachable through any endpoint for testing purposes. `Tag.name` is `@unique`, but there's no `POST /tags` endpoint in this API. The eventual exception filter (see Future Improvements) should still handle P2002 defensively, but there's no test exercising that specific path yet, and I'd rather say so than fake coverage with a test that doesn't actually trigger the condition it claims to.

## Future Improvements

In rough priority order:

1. **Global exception filter.** This one I'm being upfront didn't land. Right now Prisma's `P2025` (record not found, e.g. an update against a deleted row) and `P2003` (foreign key violation, e.g. an `assigneeId` or `projectId` that doesn't exist) both surface as raw 500s instead of 404s. There are two full `describe.skip` blocks already sitting in `test/failure-simulations.e2e-spec.ts` that encode exactly the target behavior (404 not 500 on bad refs, 409 not 500 on unique violations), written and ready to unskip the moment this filter exists.
2. **Pagination clamp and validation.** Also not done yet. `page=0` currently produces a negative `skip` value that Prisma will likely choke on, and there's no upper bound on `perPage`, so a client could request an enormous page in one shot. Same situation as above: tests already written and skipped, waiting on the fix.
3. **Real authentication**, replacing the mock current user with something that actually identifies who's making a request.
4. **Outbox pattern for Activity writes**, if writes ever grow heavier than a single insert (see Performance Considerations above for why this isn't worth it yet).
5. **Rate limiting and idempotency keys** on mutating endpoints, named in the original brief's deferred list, not attempted here given the time available.
6. **Cursor-based pagination** for `GET /activities` specifically. Offset pagination is fine at current scale, but a task with a very long history (or the flat `/activities` endpoint queried across the whole system) would eventually hit the usual offset-pagination problem where deep pages get slower as `OFFSET` grows. Not a problem yet, would be at a much larger scale than this assignment seeds.
7. **A real `POST /tags` endpoint** (or some other reachable trigger), so P2002 has an actual test path once the exception filter exists, instead of the filter handling it on faith alone.

## Time Spent

Started around 4pm, finishing this writeup around 8:15pm. Roughly 4 hours end to end, done in one sitting with Claude as a pairing tool throughout for code generation, debugging, and writing the test suite. Worth saying plainly since it's the honest account of how this got built, not something to gloss over.

Rough breakdown:

- **Phase 0 + Phase 1 (instrumentation and performance fixes):** around 1 hour. Indexes, N+1 elimination, pagination, email decoupling, Redis caching, plus the load test script and baseline capture.
- **Phase 3 (activity log):** around 1.5 hours. Schema and migration, the diffing utility, wiring transactional writes with the row lock into `TasksService`, the mock user decorator, the `ActivitiesModule`, and manually verifying the create/update/delete gate with curl before writing anything permanent.
- **Phase 4 (tests):** around 1.5 hours. Unit tests for filtering/pagination/diffing, e2e tests for the full CRUD and activity lifecycle, the concurrent-update and email-isolation failure simulations, the performance harness and baseline comparison tooling, and the pagination tiebreaker bug that the tests themselves caught and that then needed a real fix.
- **Phase 2 (hardening): 0 hours.** Did not get to the global exception filter or pagination clamp/validate. Listed honestly above under Future Improvements rather than left out.
- **Docs:** the last 15 minutes or so, this file and the final commit grouping.