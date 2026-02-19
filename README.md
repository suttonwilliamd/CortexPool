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
- Hybrid retrieval (graph + vectors)

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
pool.useFact(factId);

// Run reflection (optional maintenance)
pool.reflect();
```

## Dependencies

- better-sqlite3 (SQLite)
- LM Studio or similar for vector embeddings (optional)
