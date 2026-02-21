import Database from 'better-sqlite3';
import { join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    // Skip package.json inside Mastra's build artifact directories
    const isArtifact = dir.includes(`${sep}.mastra${sep}`) || dir.endsWith(`${sep}.mastra`);
    if (!isArtifact && fs.existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Cannot find project root (no package.json found)');
    dir = parent;
  }
}

const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
export const dbPath = join(projectRoot, 'src/mastra/public/tars.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

/**
 * Initialize the database schema
 */
export function initDb() {
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
  // Ensure bootstrapped is unset if it was the legacy 'false' value
  db.exec(`
    DELETE FROM settings WHERE key = 'bootstrapped' AND value = 'false'
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
