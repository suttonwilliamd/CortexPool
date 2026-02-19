/**
 * CortexPool - Graph-Based Memory System with Relevance Pooling
 * 
 * Upgrades from basic Graph Pool:
 * - Memory stratification (episodic, semantic, structural)
 * - Edge confidence with source tracking
 * - Time decay
 * - Hybrid retrieval (graph + vectors)
 * - Entity resolution with aliases
 * - Activation spreading
 * - Reflection loop
 * 
 * Enhanced with:
 * - Fuzzy matching (Levenshtein distance)
 * - Co-reference tracking
 * - Entity merging suggestions
 * - Vector embedding integration
 * - Improved activation spreading with edge distance attenuation
 * - Activation decay over time
 * - Activation history tracking
 * - Memory compression (summarization, fact merging, edge pruning)
 * - TTL for episodic memories
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export type MemoryTier = 'episodic' | 'semantic' | 'structural';
export type PredicateType = 
  | 'knows' | 'created' | 'fork-of' | 'prefers' | 'uses' 
  | 'learned' | 'teachers' | 'runs-on' | 'model' | 'github'
  | 'caregiver' | 'autistic' | 'used-for' | 'created-by' 
  | 'is' | 'has' | 'affiliated-with' | 'related-to'
  | 'mentioned' | 'discussed' | 'queried' | 'recalled';

export interface Entity {
  id: number;
  name: string;
  canonicalName: string;
  type: 'person' | 'project' | 'concept' | 'tool' | 'preference' | 'website' | 'other';
  aliases: string[];
  confidence: number;
  createdAt: number;
}

export interface Fact {
  id: number;
  subjectId: number;
  predicate: PredicateType;
  objectId: number | null;
  content: string;
  tier: MemoryTier;
  importance: number;
  confidence: number;
  source: string;
  lastUsed: number;
  useCount: number;
  createdAt: number;
  ttl?: number;
}

export interface PoolEntry {
  factId: number;
  relevanceScore: number;
  addedAt: number;
}

export interface ActivationHistoryEntry {
  entityId: number;
  activation: number;
  timestamp: number;
  source: string;
}

export interface CoReferenceEntry {
  pronoun: string;
  entityId: number;
  context: string;
  lastSeen: number;
}

export interface EntityMergeSuggestion {
  entity1Id: number;
  entity2Id: number;
  similarity: number;
  reason: string;
}

export interface VectorEmbedding {
  id: number;
  vector: number[];
  text: string;
}

export interface VectorSearchResult {
  factId: number;
  score: number;
}

const TIER_CONFIG = {
  episodic: { decayRate: 0.1, baseImportance: 0.3, maxAge: 24 * 60 * 60 * 1000 },
  semantic: { decayRate: 0.01, baseImportance: 0.6, maxAge: 365 * 24 * 60 * 60 * 1000 },
  structural: { decayRate: 0.001, baseImportance: 0.8, maxAge: Infinity }
};

export class CortexPool {
  private db: Database.Database;
  private poolSize: number = 15;
  private currentTopics: string[] = [];
  private activationLevels: Map<number, number> = new Map();
  private activationHistory: ActivationHistoryEntry[] = [];
  private coReferences: Map<string, CoReferenceEntry> = new Map();
  private maxActivationHistory: number = 1000;
  
  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        canonicalName TEXT NOT NULL,
        type TEXT DEFAULT 'other',
        aliases TEXT DEFAULT '[]',
        confidence REAL DEFAULT 0.5,
        createdAt INTEGER NOT NULL,
        UNIQUE(canonicalName)
      );
      
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subjectId INTEGER NOT NULL,
        predicate TEXT NOT NULL,
        objectId INTEGER,
        content TEXT NOT NULL,
        tier TEXT DEFAULT 'semantic',
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.5,
        source TEXT DEFAULT 'conversation',
        lastUsed INTEGER NOT NULL,
        useCount INTEGER DEFAULT 0,
        createdAt INTEGER NOT NULL,
        ttl INTEGER,
        FOREIGN KEY (subjectId) REFERENCES entities(id),
        FOREIGN KEY (objectId) REFERENCES entities(id)
      );
      
      CREATE TABLE IF NOT EXISTS contradictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact1Id INTEGER NOT NULL,
        fact2Id INTEGER NOT NULL,
        detectedAt INTEGER NOT NULL,
        FOREIGN KEY (fact1Id) REFERENCES facts(id),
        FOREIGN KEY (fact2Id) REFERENCES facts(id)
      );
      
      CREATE TABLE IF NOT EXISTS pool (
        factId INTEGER PRIMARY KEY,
        relevanceScore REAL DEFAULT 0,
        addedAt INTEGER NOT NULL,
        FOREIGN KEY (factId) REFERENCES facts(id)
      );
      
      CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL UNIQUE,
        canonicalTopic TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        lastSeen INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS co_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pronoun TEXT NOT NULL,
        entityId INTEGER NOT NULL,
        context TEXT,
        lastSeen INTEGER NOT NULL,
        FOREIGN KEY (entityId) REFERENCES entities(id)
      );

      CREATE TABLE IF NOT EXISTS activation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entityId INTEGER NOT NULL,
        activation REAL NOT NULL,
        source TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (entityId) REFERENCES entities(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subjectId);
      CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(objectId);
      CREATE INDEX IF NOT EXISTS idx_facts_tier ON facts(tier);
      CREATE INDEX IF NOT EXISTS idx_facts_importance ON facts(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_entities_canonical ON entities(canonicalName);
      CREATE INDEX IF NOT EXISTS idx_facts_ttl ON facts(tier, ttl);
      CREATE INDEX IF NOT EXISTS idx_activation_history_entity ON activation_history(entityId);
    `);
  }

  private normalizeName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  // ===== Fuzzy Matching (Levenshtein Distance) =====

  private levenshteinDistance(s1: string, s2: string): number {
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;

    const matrix: number[][] = [];
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[s2.length][s1.length];
  }

  private calculateSimilarity(s1: string, s2: string): number {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - this.levenshteinDistance(s1, s2) / maxLen;
  }

  findFuzzyMatches(query: string, threshold: number = 0.7): Entity[] {
    const normalizedQuery = this.normalizeName(query);
    const entities = this.db.prepare('SELECT * FROM entities').all() as any[];
    const matches: Array<{ entity: Entity; similarity: number }> = [];

    for (const row of entities) {
      const entity = this.hydrateEntity(row);
      let maxSimilarity = 0;

      maxSimilarity = Math.max(maxSimilarity, this.calculateSimilarity(normalizedQuery, entity.canonicalName));

      for (const alias of entity.aliases) {
        maxSimilarity = Math.max(maxSimilarity, this.calculateSimilarity(normalizedQuery, this.normalizeName(alias)));
      }

      if (maxSimilarity >= threshold) {
        matches.push({ entity, similarity: maxSimilarity });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity).map(m => m.entity);
  }

  // ===== Co-reference Tracking =====

  addCoReference(pronoun: string, entityId: number, context: string = '') {
    const normalizedPronoun = pronoun.toLowerCase().trim();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO co_references (pronoun, entityId, context, lastSeen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(pronoun) DO UPDATE SET entityId = ?, context = ?, lastSeen = ?
    `).run(normalizedPronoun, entityId, context, now, entityId, context, now);

    this.coReferences.set(normalizedPronoun, {
      pronoun: normalizedPronoun,
      entityId,
      context,
      lastSeen: now
    });
  }

  resolveCoReference(pronoun: string, currentContext: string[] = []): Entity | null {
    const normalizedPronoun = pronoun.toLowerCase().trim();

    const recentPronouns = ['he', 'she', 'it', 'they', 'him', 'her', 'them', 'this', 'that', 'the project', 'the file'];
    if (!recentPronouns.includes(normalizedPronoun)) {
      return null;
    }

    const cached = this.coReferences.get(normalizedPronoun);
    if (cached && Date.now() - cached.lastSeen < 30 * 60 * 1000) {
      const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(cached.entityId) as any;
      if (entity) return this.hydrateEntity(entity);
    }

    const row = this.db.prepare(`
      SELECT e.* FROM co_references cr
      JOIN entities e ON e.id = cr.entityId
      WHERE cr.pronoun = ? AND cr.lastSeen > ?
      ORDER BY cr.lastSeen DESC LIMIT 1
    `).get(normalizedPronoun, Date.now() - 30 * 60 * 1000) as any;

    if (row) {
      return this.hydrateEntity(row);
    }

    for (const contextEntity of currentContext) {
      const entity = this.resolveEntity(contextEntity);
      if (entity) {
        this.addCoReference(normalizedPronoun, entity.id, currentContext.join(', '));
        return entity;
      }
    }

    return null;
  }

  // ===== Entity Merging Suggestions =====

  suggestEntityMerges(similarityThreshold: number = 0.8): EntityMergeSuggestion[] {
    const entities = this.db.prepare('SELECT * FROM entities').all() as any[];
    const suggestions: EntityMergeSuggestion[] = [];

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const entity1 = this.hydrateEntity(entities[i]);
        const entity2 = this.hydrateEntity(entities[j]);

        let maxSimilarity = this.calculateSimilarity(entity1.canonicalName, entity2.canonicalName);

        for (const alias1 of entity1.aliases) {
          for (const alias2 of entity2.aliases) {
            maxSimilarity = Math.max(maxSimilarity, this.calculateSimilarity(
              this.normalizeName(alias1),
              this.normalizeName(alias2)
            ));
          }
        }

        if (maxSimilarity >= similarityThreshold) {
          let reason = 'High name similarity';
          
          const facts1 = this.db.prepare('SELECT predicate, objectId FROM facts WHERE subjectId = ?').all(entity1.id) as any[];
          const facts2 = this.db.prepare('SELECT predicate, objectId FROM facts WHERE subjectId = ?').all(entity2.id) as any[];
          
          const predicates1 = new Set(facts1.map(f => f.predicate));
          const predicates2 = new Set(facts2.map(f => f.predicate));
          
          const commonPredicates = [...predicates1].filter(p => predicates2.has(p));
          if (commonPredicates.length > 0) {
            reason = `Shared relationships: ${commonPredicates.join(', ')}`;
          }

          suggestions.push({
            entity1Id: entity1.id,
            entity2Id: entity2.id,
            similarity: maxSimilarity,
            reason
          });
        }
      }
    }

    return suggestions.sort((a, b) => b.similarity - a.similarity);
  }

  // ===== Vector Embedding Integration (Placeholder) =====

  async getEmbedding(text: string): Promise<number[]> {
    return new Array(384).fill(0).map(() => Math.random() * 2 - 1);
  }

  async searchByVector(query: string, limit: number = 10): Promise<VectorSearchResult[]> {
    return [];
  }

  private async hybridRetrieval(topics: string[], poolSize: number): Promise<Array<Fact & { subject: Entity; object: Entity | null; score: number }>> {
    const graphResults = this.retrieve(topics, { poolSize, useVectors: false });
    
    try {
      const queryText = topics.join(' ');
      const vectorResults = await this.searchByVector(queryText, poolSize);
      
      if (vectorResults.length === 0) {
        return graphResults;
      }

      const vectorFactIds = new Map(vectorResults.map(r => [r.factId, r.score]));
      const mergedResults = new Map<number, { fact: Fact; subject: Entity; object: Entity | null; score: number }>();

      for (const result of graphResults) {
        const vectorScore = vectorFactIds.get(result.id) || 0;
        const combinedScore = result.score * 0.7 + vectorScore * 0.3;
        mergedResults.set(result.id, { ...result, score: combinedScore });
      }

      for (const [factId, vectorScore] of vectorFactIds) {
        if (!mergedResults.has(factId)) {
          const fact = this.getFact(factId);
          if (fact) {
            const subject = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(fact.subjectId) as any;
            const object = fact.objectId ? this.db.prepare('SELECT * FROM entities WHERE id = ?').get(fact.objectId) as any : null;
            mergedResults.set(factId, {
              ...fact,
              subject: this.hydrateEntity(subject),
              object: object ? this.hydrateEntity(object) : null,
              score: vectorScore * 0.3
            });
          }
        }
      }

      return Array.from(mergedResults.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, poolSize);
    } catch {
      return graphResults;
    }
  }

  // ===== Improved Activation Spreading =====

  private async spreadActivation(depth: number = 2, decay: number = 0.5) {
    const now = Date.now();

    for (let d = 0; d < depth; d++) {
      const newLevels = new Map<number, number>();
      
      for (const [entityId, activation] of this.activationLevels) {
        if (activation < 0.01) continue;
        
        const edgeAttenuation = Math.pow(decay, d + 1);
        
        const related = this.db.prepare(`
          SELECT subjectId, objectId, predicate FROM facts 
          WHERE subjectId = ? OR objectId = ?
        `).all(entityId, entityId) as any[];
        
        for (const row of related) {
          const neighborId = row.subjectId === entityId ? row.objectId : row.subjectId;
          if (neighborId && neighborId !== entityId) {
            const distanceWeight = row.predicate === 'related-to' ? 0.7 : 1.0;
            const attenuatedActivation = activation * edgeAttenuation * distanceWeight;
            
            const current = newLevels.get(neighborId) || 0;
            newLevels.set(neighborId, Math.max(current, attenuatedActivation));
          }
        }
      }
      
      for (const [id, level] of newLevels) {
        const current = this.activationLevels.get(id) || 0;
        this.activationLevels.set(id, Math.max(current, level));
      }
    }

    this.applyActivationDecay(now);
    this.recordActivationHistory();
  }

  private applyActivationDecay(now: number) {
    const decayRate = 0.05;
    
    for (const [entityId, activation] of this.activationLevels) {
      const recentActivations = this.activationHistory
        .filter(e => e.entityId === entityId && now - e.timestamp < 60 * 60 * 1000);
      
      if (recentActivations.length === 0) {
        const decayed = activation * (1 - decayRate);
        if (decayed < 0.01) {
          this.activationLevels.delete(entityId);
        } else {
          this.activationLevels.set(entityId, decayed);
        }
      }
    }
  }

  private recordActivationHistory() {
    const now = Date.now();
    
    for (const [entityId, activation] of this.activationLevels) {
      this.activationHistory.push({
        entityId,
        activation,
        timestamp: now,
        source: 'spread'
      });
    }

    if (this.activationHistory.length > this.maxActivationHistory) {
      this.activationHistory = this.activationHistory.slice(-this.maxActivationHistory);
    }

    const stmt = this.db.prepare(`
      INSERT INTO activation_history (entityId, activation, source, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    
    for (const entry of this.activationHistory.slice(-100)) {
      stmt.run(entry.entityId, entry.activation, entry.source, entry.timestamp);
    }
  }

  getActivationHistory(entityId: number, since: number = 0): ActivationHistoryEntry[] {
    return this.activationHistory.filter(
      e => e.entityId === entityId && e.timestamp > since
    );
  }

  // ===== Memory Compression =====

  private async compressMemory(): Promise<number> {
    let compressed = 0;

    compressed += await this.mergeSimilarFacts();
    compressed += this.pruneRedundantEdges();
    compressed += await this.summarizeOldFacts();

    return compressed;
  }

  private async mergeSimilarFacts(): Promise<number> {
    const facts = this.db.prepare('SELECT * FROM facts WHERE tier = ?').all('semantic') as Fact[];
    let merged = 0;

    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const f1 = facts[i];
        const f2 = facts[j];

        if (f1.subjectId !== f2.subjectId || f1.predicate !== f2.predicate) continue;

        const similarity = this.calculateSimilarity(f1.content, f2.content);
        
        if (similarity > 0.85) {
          const newConfidence = Math.min(1.0, f1.confidence + f2.confidence);
          const newImportance = Math.max(f1.importance, f2.importance);
          const newUseCount = f1.useCount + f2.useCount;

          this.db.prepare(`
            UPDATE facts SET confidence = ?, importance = ?, useCount = ?, lastUsed = ?
            WHERE id = ?
          `).run(newConfidence, newImportance, newUseCount, Math.max(f1.lastUsed, f2.lastUsed), f1.id);

          this.db.prepare('DELETE FROM facts WHERE id = ?').run(f2.id);
          merged++;
        }
      }
    }

    return merged;
  }

  private pruneRedundantEdges(): number {
    const facts = this.db.prepare(`
      SELECT subjectId, predicate, objectId, COUNT(*) as cnt
      FROM facts
      WHERE objectId IS NOT NULL
      GROUP BY subjectId, predicate, objectId
      HAVING cnt > 1
    `).all() as any[];
    
    let pruned = 0;

    for (const row of facts) {
      const duplicates = this.db.prepare(`
        SELECT id FROM facts
        WHERE subjectId = ? AND predicate = ? AND objectId = ?
        ORDER BY importance DESC, useCount DESC
      `).all(row.subjectId, row.predicate, row.objectId) as any[];

      for (let i = 1; i < duplicates.length; i++) {
        this.db.prepare('DELETE FROM facts WHERE id = ?').run(duplicates[i].id);
        pruned++;
      }
    }

    return pruned;
  }

  private async summarizeOldFacts(): Promise<number> {
    const oldFacts = this.db.prepare(`
      SELECT * FROM facts
      WHERE tier = 'semantic'
        AND importance > 0.3
        AND useCount > 3
        AND createdAt < ?
      ORDER BY createdAt ASC
    `).all(Date.now() - 90 * 24 * 60 * 60 * 1000) as Fact[];
    
    let summarized = 0;

    for (const fact of oldFacts) {
      if (fact.content.length < 50) continue;

      const summary = `[Summarized: ${fact.content.substring(0, 100)}...]`;
      
      this.db.prepare('UPDATE facts SET content = ? WHERE id = ?').run(summary, fact.id);
      summarized++;
    }

    return summarized;
  }

  // ===== TTL for Episodic Memories =====

  addFact(params: {
    subject: string;
    predicate: PredicateType;
    object?: string | null;
    content: string;
    tier?: MemoryTier;
    confidence?: number;
    source?: string;
    ttl?: number;
  }): number {
    const { subject, predicate, object, content, tier = 'semantic', confidence = 0.7, source = 'conversation', ttl } = params;
    
    const subjectId = this.addEntity(subject, this.inferType(predicate), confidence);
    let objectId: number | null = null;
    if (object) objectId = this.addEntity(object, 'other', confidence);
    
    let effectiveTtl = ttl;
    if (tier === 'episodic' && !ttl) {
      effectiveTtl = 7 * 24 * 60 * 60 * 1000;
    }
    
    const result = this.db.prepare(`
      INSERT INTO facts (subjectId, predicate, objectId, content, tier, importance, confidence, source, lastUsed, useCount, createdAt, ttl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(subjectId, predicate, objectId, content, tier, TIER_CONFIG[tier].baseImportance, confidence, source, Date.now(), Date.now(), effectiveTtl || null);
    
    return result.lastInsertRowid as number;
  }

  cleanupExpiredEpisodic(): number {
    const now = Date.now();
    
    const expired = this.db.prepare(`
      SELECT id FROM facts
      WHERE tier = 'episodic'
        AND ttl IS NOT NULL
        AND createdAt + ttl < ?
    `).all(now) as any[];
    
    for (const row of expired) {
      this.db.prepare('DELETE FROM facts WHERE id = ?').run(row.id);
    }
    
    return expired.length;
  }

  // ===== Core Entity Operations =====

  addEntity(name: string, type: Entity['type'] = 'other', confidence: number = 0.5): number {
    const canonicalName = this.normalizeName(name);
    const existing = this.db.prepare('SELECT id, aliases, confidence FROM entities WHERE canonicalName = ?').get(canonicalName) as any;
    
    if (existing) {
      const aliases = JSON.parse(existing.aliases || '[]');
      if (!aliases.includes(name)) {
        aliases.push(name);
        this.db.prepare('UPDATE entities SET aliases = ? WHERE id = ?').run(JSON.stringify(aliases), existing.id);
      }
      const newConfidence = (existing.confidence + confidence) / 2;
      this.db.prepare('UPDATE entities SET confidence = ? WHERE id = ?').run(newConfidence, existing.id);
      return existing.id;
    }
    
    const result = this.db.prepare(`
      INSERT INTO entities (name, canonicalName, type, aliases, confidence, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, canonicalName, type, JSON.stringify([name]), confidence, Date.now());
    
    return result.lastInsertRowid as number;
  }

  resolveEntity(query: string): Entity | null {
    const normalized = this.normalizeName(query);
    const byCanonical = this.db.prepare('SELECT * FROM entities WHERE canonicalName = ?').get(normalized) as any;
    if (byCanonical) return this.hydrateEntity(byCanonical);
    
    const byAlias = this.db.prepare('SELECT * FROM entities WHERE aliases LIKE ?').get(`%${query}%`) as any;
    if (byAlias) return this.hydrateEntity(byAlias);
    
    const fuzzyMatches = this.findFuzzyMatches(query, 0.8);
    if (fuzzyMatches.length > 0) return fuzzyMatches[0];
    
    return null;
  }

  private hydrateEntity(row: any): Entity {
    return { ...row, aliases: JSON.parse(row.aliases || '[]') };
  }

  private inferType(predicate: PredicateType): Entity['type'] {
    const typeMap: Record<string, Entity['type']> = {
      'knows': 'person', 'created': 'project', 'fork-of': 'project', 'prefers': 'preference',
      'uses': 'tool', 'learned': 'person', 'teachers': 'person', 'runs-on': 'concept',
      'model': 'concept', 'github': 'website', 'caregiver': 'person', 'autistic': 'person',
      'used-for': 'concept', 'created-by': 'person', 'is': 'concept', 'has': 'concept',
      'affiliated-with': 'person', 'related-to': 'concept'
    };
    return typeMap[predicate] || 'other';
  }

  getFact(id: number): Fact | null {
    return this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as Fact | null;
  }

  // ===== Topics & Activation =====

  setTopics(topics: string[]) {
    this.currentTopics = topics;
    this.activationLevels.clear();
    
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO topics (topic, canonicalTopic, weight, lastSeen) VALUES (?, ?, 1.0, ?)
      ON CONFLICT(topic) DO UPDATE SET weight = weight * 0.9 + 1.0, lastSeen = ?
    `);
    
    for (const topic of topics) {
      stmt.run(topic, this.normalizeName(topic), now, now);
      const entity = this.resolveEntity(topic);
      if (entity) this.activationLevels.set(entity.id, 1.0);
    }
  }

  // ===== Relevance Calculation =====

  private calculateRelevance(fact: Fact): number {
    const config = TIER_CONFIG[fact.tier];
    let score = fact.importance * fact.confidence;
    
    const subject = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(fact.subjectId) as any;
    if (!subject) return score;
    
    for (const topic of this.currentTopics) {
      const normTopic = this.normalizeName(topic);
      if (subject.canonicalName.includes(normTopic) || normTopic.includes(subject.canonicalName)) {
        score += 0.4;
      }
      const aliases = JSON.parse(subject.aliases || '[]');
      for (const alias of aliases) {
        if (this.normalizeName(alias).includes(normTopic)) {
          score += 0.3;
          break;
        }
      }
    }
    
    const activation = this.activationLevels.get(fact.subjectId) || 0;
    score += activation * 0.3;
    
    const typeWeights: Record<string, number> = { person: 0.15, project: 0.15, preference: 0.2, tool: 0.1, concept: 0.05 };
    score += typeWeights[subject.type] || 0;
    
    const hoursSinceUse = (Date.now() - fact.lastUsed) / (1000 * 60 * 60);
    score += Math.max(0, 0.2 - hoursSinceUse * 0.01);
    
    return Math.min(1.0, score);
  }

  // ===== Retrieval =====

  retrieve(topics: string[], options: { useVectors?: boolean; poolSize?: number } = {}): Array<Fact & { subject: Entity; object: Entity | null; score: number }> {
    const { poolSize = this.poolSize } = options;
    
    this.setTopics(topics);
    this.spreadActivation(2, 0.5);
    
    const facts = this.db.prepare('SELECT * FROM facts').all() as Fact[];
    
    const scored = facts.map(fact => ({
      fact,
      score: this.calculateRelevance(fact)
    })).sort((a, b) => b.score - a.score);
    
    this.db.prepare('DELETE FROM pool').run();
    const insertStmt = this.db.prepare('INSERT INTO pool (factId, relevanceScore, addedAt) VALUES (?, ?, ?)');
    const now = Date.now();
    
    const results: Array<Fact & { subject: Entity; object: Entity | null; score: number }> = [];
    
    for (const { fact, score } of scored.slice(0, poolSize)) {
      insertStmt.run(fact.id, score, now);
      
      const subject = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(fact.subjectId) as any;
      let object: Entity | null = null;
      if (fact.objectId) {
        object = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(fact.objectId) as any;
      }
      
      results.push({
        ...fact,
        subject: this.hydrateEntity(subject),
        object: object ? this.hydrateEntity(object) : null,
        score
      });
    }
    
    return results;
  }

  // ===== Usage Tracking =====

  useFact(factId: number) {
    const fact = this.getFact(factId);
    if (!fact) return;
    
    const config = TIER_CONFIG[fact.tier];
    const newImportance = Math.min(1.0, fact.importance + 0.1);
    
    this.db.prepare(`
      UPDATE facts SET importance = ?, lastUsed = ?, useCount = useCount + 1 WHERE id = ?
    `).run(newImportance, Date.now(), factId);
  }

  // ===== Time Decay =====

  applyDecay() {
    const now = Date.now();
    const facts = this.db.prepare('SELECT * FROM facts').all() as Fact[];
    
    for (const fact of facts) {
      const config = TIER_CONFIG[fact.tier];
      const hoursSinceUse = (now - fact.lastUsed) / (1000 * 60 * 60);
      const decay = Math.exp(-config.decayRate * hoursSinceUse);
      const newImportance = config.baseImportance + (fact.importance - config.baseImportance) * decay;
      
      if (newImportance < 0.1) {
        this.db.prepare('DELETE FROM facts WHERE id = ?').run(fact.id);
      } else {
        this.db.prepare('UPDATE facts SET importance = ? WHERE id = ?').run(newImportance, fact.id);
      }
    }
    
    this.db.prepare('INSERT INTO reflections (action, details, createdAt) VALUES (?, ?, ?)')
      .run('decay', JSON.stringify({ pruned: facts.length }), now);
  }

  // ===== Contradiction Detection =====

  detectContradictions() {
    const facts = this.db.prepare(`
      SELECT f1.id as f1id, f1.content as f1content, f2.id as f2id, f2.content as f2content
      FROM facts f1, facts f2
      WHERE f1.subjectId = f2.subjectId AND f1.predicate = f2.predicate AND f1.id < f2.id
    `).all() as any[];
    
    const now = Date.now();
    const insert = this.db.prepare('INSERT INTO contradictions (fact1Id, fact2Id, detectedAt) VALUES (?, ?, ?)');
    
    for (const row of facts) {
      if (row.f1content !== row.f2content) {
        insert.run(row.f1id, row.f2id, now);
      }
    }
    
    return facts.length;
  }

  // ===== Reflection Loop =====

  async reflect() {
    const now = Date.now();
    
    this.applyDecay();
    
    const contradictions = this.detectContradictions();
    
    const entities = this.db.prepare('SELECT * FROM entities').all() as any[];
    const canonicalMap = new Map<string, any>();
    
    for (const entity of entities) {
      const canonical = entity.canonicalName;
      if (canonicalMap.has(canonical)) {
        const existing = canonicalMap.get(canonical);
        const existingAliases = JSON.parse(existing.aliases || '[]');
        const newAliases = JSON.parse(entity.aliases || '[]');
        const mergedAliases = [...new Set([...existingAliases, ...newAliases])];
        
        this.db.prepare('UPDATE facts SET subjectId = ? WHERE subjectId = ?').run(existing.id, entity.id);
        if (entity.objectId) {
          this.db.prepare('UPDATE facts SET objectId = ? WHERE objectId = ?').run(existing.id, entity.id);
        }
        
        this.db.prepare('DELETE FROM entities WHERE id = ?').run(entity.id);
        
        this.db.prepare('UPDATE entities SET aliases = ?, confidence = ? WHERE id = ?')
          .run(JSON.stringify(mergedAliases), (existing.confidence + entity.confidence) / 2, existing.id);
      } else {
        canonicalMap.set(canonical, entity);
      }
    }

    const compressed = await this.compressMemory();
    
    this.refreshPool();
    
    this.db.prepare('INSERT INTO reflections (action, details, createdAt) VALUES (?, ?, ?)')
      .run('reflect', JSON.stringify({ contradictions, compressed }), now);
    
    return { contradictions, entities: entities.length, compressed };
  }

  refreshPool() {
    if (this.currentTopics.length > 0) {
      this.retrieve(this.currentTopics);
    }
  }

  // ===== Bulk Operations =====

  bulkAdd(facts: Array<{
    subject: string;
    predicate: PredicateType;
    object?: string | null;
    content: string;
    tier?: MemoryTier;
    ttl?: number;
  }>) {
    for (const fact of facts) {
      this.addFact(fact);
    }
  }

  // ===== Export =====

  export() {
    return JSON.stringify({
      entities: this.db.prepare('SELECT * FROM entities').all(),
      facts: this.db.prepare('SELECT * FROM facts').all(),
      pool: this.db.prepare('SELECT * FROM pool').all(),
      topics: this.db.prepare('SELECT * FROM topics').all(),
      coReferences: Array.from(this.coReferences.entries()),
      activationHistory: this.activationHistory.slice(-100)
    }, null, 2);
  }

  close() {
    this.db.close();
  }
}
