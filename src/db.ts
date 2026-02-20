import Database from 'better-sqlite3';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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

export default db;
