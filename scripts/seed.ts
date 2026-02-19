/**
 * Seed script for CortexPool
 * Run: npx tsx scripts/seed.ts
 */

import { CortexPool } from '../src/cortex-pool';

const pool = new CortexPool('./cortexpool.db');

// Seed with known facts about William and projects
pool.bulkAdd([
  // William - Personal
  { subject: 'William', predicate: 'knows', object: 'Stanford', content: 'William attended Stanford', tier: 'semantic' },
  { subject: 'William', predicate: 'knows', object: '3DBuzz', content: 'William learned from 3DBuzz tutorials', tier: 'semantic' },
  { subject: 'Stanford', predicate: 'teachers', content: 'Jerry Cain, Mehran Sahami, Julie Zelenski taught at Stanford', tier: 'semantic' },
  { subject: '3DBuzz', predicate: 'teachers', content: 'Jason Busby, Dan Bissell, Joel Van Eenwyk taught at 3DBuzz', tier: 'semantic' },
  { subject: 'William', predicate: 'prefers', object: 'tabs', content: 'William prefers tabs over spaces', tier: 'semantic' },
  { subject: 'William', predicate: 'github', content: 'William\'s GitHub is suttonwilliamd', tier: 'semantic' },
  { subject: 'William', predicate: 'email', content: 'William\'s email is suttonwilliamd@gmail.com', tier: 'semantic' },
  { subject: 'William', predicate: 'caregiver', content: 'William is a caregiver for his mother with dementia', tier: 'semantic', confidence: 0.9 },
  { subject: 'William', predicate: 'autistic', content: 'William is likely autistic', tier: 'semantic' },
  
  // Projects
  { subject: 'William', predicate: 'created', object: 'OpenLiam', content: 'William created OpenLiam', tier: 'semantic' },
  { subject: 'OpenLiam', predicate: 'fork-of', object: 'OpenClaw', content: 'OpenLiam is a fork of OpenClaw', tier: 'structural' },
  { subject: 'OpenClaw', predicate: 'created-by', object: 'Pete Steinberger', content: 'OpenClaw was created by Pete Steinberger', tier: 'structural' },
  { subject: 'OpenLiam', predicate: 'used-for', content: 'OpenLiam is used for home automation and AI assistant deployment', tier: 'semantic' },
  
  { subject: 'William', predicate: 'created', object: 'bitbybit', content: 'William created bitbybit, a dumb little idle game', tier: 'semantic' },
  { subject: 'bitbybit', predicate: 'type', content: 'bitbybit is an idle game', tier: 'semantic' },
  
  { subject: 'William', predicate: 'created', object: 'LewtNanny', content: 'William created LewtNanny', tier: 'semantic' },
  { subject: 'LewtNanny', predicate: 'used-for', content: 'LewtNanny tracks loot in Entropia Universe', tier: 'semantic' },
  
  { subject: 'William', predicate: 'created', object: 'l2dj', content: 'William created l2dj', tier: 'semantic' },
  { subject: 'l2dj', predicate: 'used-for', content: 'l2dj helps people learn to DJ for free', tier: 'semantic' },
  
  // Website
  { subject: 'William', predicate: 'created', object: 'william64.com', content: 'William built william64.com', tier: 'semantic' },
  { subject: 'william64.com', predicate: 'has', object: 'aaron', content: 'william64.com has an /aaron blog page', tier: 'semantic' },
  
  // Aaron
  { subject: 'Aaron', predicate: 'runs-on', object: 'OpenClaw', content: 'Aaron runs on OpenClaw framework', tier: 'structural' },
  { subject: 'Aaron', predicate: 'model', object: 'big-pickle', content: 'Aaron uses big-pickle model from OpenCode', tier: 'structural' },
  { subject: 'Aaron', predicate: 'vibe', content: 'Aaron has a casually unhinged vibe', tier: 'semantic' },
  { subject: 'Aaron', predicate: 'created-by', object: 'William', content: 'William created Aaron', tier: 'semantic' },
  
  // LM Studio & Memory
  { subject: 'LM Studio', predicate: 'used-for', object: 'embeddings', content: 'LM Studio runs embedding models locally', tier: 'structural' },
  { subject: 'memory search', predicate: 'uses', object: 'LM Studio', content: 'Memory search uses LM Studio for embeddings', tier: 'structural' },
  { subject: 'CortexPool', predicate: 'is', object: 'memory', content: 'CortexPool is a graph-based memory system', tier: 'structural' },
  { subject: 'CortexPool', predicate: 'created-by', object: 'Aaron', content: 'Aaron created CortexPool', tier: 'semantic' },
  
  // Preferences (high importance)
  { subject: 'William', predicate: 'prefers', object: 'tabs', content: 'William prefers tabs over spaces', tier: 'semantic', confidence: 0.9 },
  { subject: 'William', predicate: 'prefers', object: 'private', content: 'William prefers to keep caregiver status private', tier: 'semantic', confidence: 0.9 },
]);

// Set initial topics and build pool
pool.setTopics(['William', 'OpenLiam', 'Aaron']);
pool.refreshPool();

// Test retrieval
console.log('\n=== Testing Retrieval: "OpenLiam" ===');
const results = pool.retrieve(['OpenLiam']);
console.log(`Found ${results.length} relevant facts:\n`);
results.forEach(r => {
  console.log(`[${r.score.toFixed(2)}] ${r.subject.name} ${r.predicate} ${r.object?.name || ''}`);
  console.log(`       "${r.content}"`);
  console.log(`       (tier: ${r.tier}, confidence: ${r.confidence})`);
  console.log();
});

console.log('\n=== Testing Retrieval: "memory" ===');
const memResults = pool.retrieve(['memory']);
memResults.forEach(r => {
  console.log(`[${r.score.toFixed(2)}] ${r.subject.name} ${r.predicate} → ${r.content.substring(0, 60)}...`);
});

console.log('\n=== Testing Activation Spreading ===');
pool.setTopics(['OpenLiam']);
const spreadResults = pool.retrieve(['OpenLiam']);
console.log('After spreading from OpenLiam:');
spreadResults.slice(0, 5).forEach(r => {
  console.log(`[${r.score.toFixed(2)}] ${r.subject.name}`);
});

console.log('\n=== Seeding Complete! ===');
console.log(`Total entities: ${pool.export().match(/"id":/g)?.length || 0}`);
console.log('Run reflect() periodically to maintain memory.\n');

pool.close();
