# CortexPool 🧠

A graph-based memory system with relevance pooling for AI assistants.

## Core Concept

Combines:
- **Graph memory** (entities + relationships) — long-term semantic store
- **Relevance Pool** (sliding window of hot facts) — working memory
- **Hybrid retrieval** (graph traversal + vector search) — associative recall
- **Activation spreading** — cognitive-style indirect reasoning

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   User Query                        │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│            Topic Extraction + Entity Resolution       │
│   (alias resolution, fuzzy matching, co-reference)  │
└─────────────────┬───────────────────────────────────┘
                  │
         ┌────────┴────────┐
         ▼                 ▼
┌─────────────────┐  ┌─────────────────┐
│  Graph Traverse │  │ Vector Search   │
│  (structured)   │  │ (semantic)      │
└────────┬────────┘  └────────┬────────┘
         │                    │
         └────────┬───────────┘
                  ▼
         ┌────────────────┐
         │ Rerank + Merge │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │ Relevance Pool │ ← Top N facts in context
         │ (sliding window)│
         └────────────────┘
```

## Memory Tiers

- **Episodic** — Conversation events, short lifespan, fast decay
- **Semantic** — Stable knowledge, medium lifespan
- **Structural** — System/tool relations, long lifespan, slow decay

## Features

- Usage-weighted importance with time decay
- Edge confidence (source tracking, contradiction detection)
- Activation spreading for associative recall
- Reflection loop for memory maintenance
- Entity resolution with aliases
- Graph retrieval with vector integration scaffolding (not yet functional)

## Development

Use Node.js 22 (CI also covers Node.js 20) on Windows or Linux:

```sh
npm ci
npm run build
npm test
```

The pinned `better-sqlite3` version has no Windows Node.js 24 prebuilt binary;
using that runtime may require a local C++ toolchain.

## Usage

```typescript
import { CortexPool } from './src/cortex-pool';

const pool = new CortexPool('./cortexpool.db');

// Add facts
pool.addFact({
  subject: 'William',
  predicate: 'created',
  object: 'OpenLiam',
  content: 'William created OpenLiam as a fork of OpenClaw',
  tier: 'semantic'
});

// Set current conversation topics
pool.setTopics(['OpenLiam', 'memory']);

// Get relevant facts
const facts = pool.retrieve(['OpenLiam', 'memory']);

// Mark as used (boosts importance)
if (facts[0]) pool.useFact(facts[0].id);

// Run reflection (optional maintenance; inside an async function)
await pool.reflect();
pool.close();
```

## Memory lifetime and TPC sync

- Episodic facts default to a seven-day TTL, in milliseconds. `ttl: 0` expires
  immediately; negative or non-finite TTLs are rejected.
- Retrieval, reflection, and bulk TPC sync remove expired episodic facts,
  including their pool and contradiction references. Manual cleanup is available
  through `cleanupExpiredEpisodic()`.
- Pass an HTTP or HTTPS TPC server URL as the second constructor argument.
  Requests reject non-2xx responses and time out after 10 seconds of inactivity.
- `await pool.syncToTPC()` returns `{ synced, failed }` for facts created in the
  last 24 hours. Direct `syncFactToTPC()` rejects failures; callers must handle
  them. Repeated syncs can still create duplicate remote thoughts.
- `fetchFromTPC()` tries `type=thought`, then `type=thoughts` on failure, and
  returns `[]` if both attempts fail.

## Current limitations

Vector embeddings/search are placeholders: `getEmbedding()` returns random
values, `searchByVector()` returns no results, and `retrieve()` currently uses
only graph scoring regardless of `useVectors`. Do not use the embedding output
for semantic similarity. Old-fact summarization is also a truncation heuristic,
not an LLM summary. See [REVIEW.md](REVIEW.md) for prioritized follow-up work.

## Dependencies

- better-sqlite3 (SQLite)
