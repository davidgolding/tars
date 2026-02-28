import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { join, basename } from 'node:path';
import fs from 'node:fs';

dotenv.config();

const WORKSPACE_PATH = process.env.WORKSPACE_PATH!;

export const dbPath = join(WORKSPACE_PATH, '/tars.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema immediately so any module-level code in importers
// (e.g. tars.ts calling getAgentContext() during Memory construction)
// always finds the tables present regardless of call order.
initDb();

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

  // Schedules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      task TEXT NOT NULL,
      cron_expression TEXT,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      run_count INTEGER NOT NULL DEFAULT 0
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

    // Load BOOTSTRAP into `bootstrap_prompt` setting
    const bootstrapFile = join(fullPath, 'BOOTSTRAP.md');
    const bootstrapPrompt = fs.existsSync(bootstrapFile) ? fs.readFileSync(bootstrapFile, 'utf-8') : '';

    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    stmt.run('bootstrap_prompt', bootstrapPrompt);

    if (fs.existsSync(fullPath)) {
      const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.md'));
      const insertStmt = db.prepare('INSERT INTO agent_context (category, content) VALUES (?, ?)');
      const insertMany = db.transaction((files: string[]) => {
        for (const file of files) {
          const category = basename(file, '.md');
          //Do not load BOOTSTRAP.md or SYSTEM.md files; would break agentic turns and flow
          if (category == 'BOOTSTRAP' || category == 'SYSTEM') {
            continue;
          }
          const content = fs.readFileSync(join(fullPath, file), 'utf-8');
          insertStmt.run(category, content);
        }
      });
      insertMany(files);
      console.log(`[DB] Seeded ${files.length} context categories.`);
    } else {
      console.warn('[DB] Could not find `agent/` directory to seed context.');
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

// --- Schedules ---

export interface Schedule {
  id: string;
  name: string;
  task: string;
  cron_expression: string | null;
  next_run_at: string;
  last_run_at: string | null;
  enabled: number;
  created_at: string;
  run_count: number;
}

export function createSchedule(schedule: Omit<Schedule, 'last_run_at' | 'created_at' | 'run_count'>): void {
  const stmt = db.prepare(
    'INSERT INTO schedules (id, name, task, cron_expression, next_run_at, enabled) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(schedule.id, schedule.name, schedule.task, schedule.cron_expression, schedule.next_run_at, schedule.enabled);
}

export function getSchedule(id: string): Schedule | null {
  const stmt = db.prepare('SELECT * FROM schedules WHERE id = ?');
  return (stmt.get(id) as Schedule) ?? null;
}

export function listSchedules(): Schedule[] {
  const stmt = db.prepare('SELECT * FROM schedules ORDER BY next_run_at ASC');
  return stmt.all() as Schedule[];
}

export function updateSchedule(id: string, fields: Partial<Pick<Schedule, 'name' | 'task' | 'cron_expression' | 'next_run_at' | 'enabled' | 'last_run_at' | 'run_count'>>): void {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSchedule(id: string): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

export function getDueSchedules(): Schedule[] {
  const stmt = db.prepare("SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= datetime('now')");
  return stmt.all() as Schedule[];
}

export default db;
