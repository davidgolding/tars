import Database from 'better-sqlite3';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../tars.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

/**
 * Initialize the database schema
 */
export function initDb() {
  // Messages table for short-term conversation history
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Memories table for long-term searchable facts using FTS5
  // We use a contentless-delete table or standard FTS5 table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
      content,
      category UNINDEXED,
      created_at UNINDEXED
    )
  `);

  // Agent Persona Context table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_context (
      category TEXT PRIMARY KEY,
      content TEXT NOT NULL
    )
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Initial settings
  db.exec(`
    INSERT INTO settings (key, value) VALUES ('bootstrapped', 'false')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);

  // Seeding logic for Agent Context
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM agent_context');
  const { count } = countStmt.get() as { count: number };

  if (count === 0) {
    console.log('[DB] Seeding agent context from file system...');
    const promptsPath = process.env.AGENT_PROMPTS_PATH || 'agent';
    let fullPath = join(process.cwd(), promptsPath.replace(/^\//, ''));

    // Fallback to local default if custom path not found
    if (!fs.existsSync(fullPath)) {
      fullPath = join(process.cwd(), 'agent');
    }

    if (fs.existsSync(fullPath)) {
      const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.md'));
      const insertStmt = db.prepare('INSERT INTO agent_context (category, content) VALUES (?, ?)');
      const insertMany = db.transaction((files: string[]) => {
        for (const file of files) {
          const category = basename(file, '.md');
          const content = fs.readFileSync(join(fullPath, file), 'utf-8');
          insertStmt.run(category, content);
        }
      });
      insertMany(files);
      console.log(`[DB] Seeded ${files.length} context categories.`);
    } else {
      console.warn('[DB] Could not find agent/ directory to seed context.');
    }
  }
  console.log('[DB] Database initialized at', dbPath);
}

/**
 * Short-term: Save a message
 */
export function saveMessage(sender: string, text: string) {
  const stmt = db.prepare('INSERT INTO messages (sender, text) VALUES (?, ?)');
  stmt.run(sender, text);
}

/**
 * Short-term: Get recent messages for context
 */
export function getRecentMessages(limit: number = 10) {
  const stmt = db.prepare('SELECT sender, text FROM messages ORDER BY timestamp DESC LIMIT ?');
  const messages = stmt.all(limit) as { sender: string; text: string }[];
  return messages.reverse();
}

/**
 * Long-term: Save a memory
 */
export function saveMemory(content: string, category: string = 'general') {
  const stmt = db.prepare('INSERT INTO memories (content, category, created_at) VALUES (?, ?, ?)');
  stmt.run(content, category, new Date().toISOString());
}

/**
 * Long-term: Search memories
 */
export function searchMemories(query: string, limit: number = 5) {
  const stmt = db.prepare('SELECT content, category FROM memories WHERE memories MATCH ? ORDER BY rank LIMIT ?');
  // FTS5 match syntax usually requires quoting if the query has multiple words or special chars
  // For simplicity, we'll just pass the query through for now
  try {
    return stmt.all(query, limit) as { content: string; category: string }[];
  } catch (err) {
    console.warn('[DB] Memory search failed (likely syntax error):', err);
    return [];
  }
}

/**
 * Persona: Get context category length
 */
export function getAgentContext(category: string): string | null {
  const stmt = db.prepare('SELECT content FROM agent_context WHERE category = ?');
  const row = stmt.get(category) as { content: string } | undefined;
  return row ? row.content : null;
}

/**
 * Setting: Get a given setting
 */
export function getSetting(key: string): string | null {
  const stmt = db.prepare('SELECT key, value FROM settings WHERE key = ?');
  const row = stmt.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

/**
 * Persona: Get all available context categories
 */
export function getAllAgentContextCategories(): string[] {
  const stmt = db.prepare('SELECT category FROM agent_context');
  const rows = stmt.all() as { category: string }[];
  return rows.map(r => r.category);
}

/**
 * Persona: Update or create context
 */
export function updateAgentContext(category: string, content: string): void {
  const stmt = db.prepare('INSERT INTO agent_context (category, content) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET content=excluded.content');
  stmt.run(category, content);
}

/**
 * Setting: Update or create setting
 */
export function updateSetting(key: string, value: string): void {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  stmt.run(key, value);
}

/**
 * Persona: Delete context
 */
export function deleteAgentContext(category: string): void {
  const stmt = db.prepare('DELETE FROM agent_context WHERE category = ?');
  stmt.run(category);
}

export default db;
