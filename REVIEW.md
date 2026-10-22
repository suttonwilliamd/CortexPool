# CortexPool review

## Assessment

A compact TypeScript/SQLite prototype with useful entity, relevance-pool, and
memory-maintenance primitives. The public API is small enough to harden without
rewriting it. It is not yet a production semantic-memory or bidirectional-sync
system: vector search is scaffolding and fetching TPC results does not ingest
those results into local memory.

## Implemented reliability improvements

- HTTP/HTTPS transport selection, non-2xx rejection, response-error handling,
  and a 10-second inactivity timeout. Search fallback now works against actual
  HTTP failures, not only mocked exceptions.
- Sync errors propagate to bulk accounting instead of being silently counted
  as successes.
- Expired episodic facts are removed before retrieval, reflection, and sync.
  Zero TTL is supported; invalid TTLs fail before writing entities.
- Fact deletion transactionally removes pool and contradiction references.
- Compression avoids re-merging deleted rows, accumulates usage metadata across
  multiple duplicates, and does not merge relationships to different objects.
  Redundant-edge pruning preserves distinct content, tiers, and sources.
- Alias lookup uses whole normalized values instead of substring/SQL wildcard
  matching. Missing facts consistently return `null`.
- Activation persistence writes new entries once instead of re-inserting history.
- Tests use in-memory databases with teardown, plus real local HTTP servers.
  CI installs the lockfile and covers Windows/Linux with Node.js 20/22. The
  test script uses an explicit suite path because Node.js 20 on Windows does not
  expand the previous test glob.
- Lockfile remediation removes the reported esbuild development-server advisory
  using a non-affected version within the existing dependency range.

## Recommended next steps

1. **Non-destructive maintenance:** replace truncating summaries with an injected
   summarizer that retains original text/provenance. Make contradiction detection
   idempotent and distinguish contradictory claims from simply different facts.
   Make all multi-step compression updates atomic; retain per-source evidence
   rather than combining confidence by addition.
2. **Real vector retrieval:** inject an embedding provider, persist versioned
   vectors, expose asynchronous retrieval, and use one flat result shape for
   graph-only and vector-only hits. Replace random embeddings and test ranking.
3. **Reliable TPC synchronization:** persist a sync cursor and remote identifiers,
   use idempotency keys, support authentication, bounded response sizes and
   configurable deadlines, and define a local ingestion/conflict policy.
4. **Scale and integrity:** migrate existing data before adding stronger schema
   constraints, batch statements in transactions, and benchmark full-table scans
   and quadratic similarity comparisons. Persisted activation history currently
   needs a retention policy and restart hydration.
5. **Runtime support:** update the native SQLite dependency deliberately and test
   Node.js 24 before advertising support; the current Windows prebuilt binary
   supports the tested Node.js 20/22 paths, not this workstation's Node.js 24.

These follow-ups are intentionally separate from the focused correctness fixes;
several require explicit data migration or product/API decisions.
