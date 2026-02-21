import db, { initDb } from './db.js';
import chalk from 'chalk';

console.log(chalk.red('\n[System] Commencing total cortical wipe...'));

try {
    // Clear out short-term conversation logs
    db.exec('DELETE FROM messages;');

    // Clear out long-term FTS5 memories
    db.exec('DELETE FROM memories;');

    // Clear out the seeded agent persona
    db.exec('DELETE FROM agent_context;');

    console.log(chalk.yellow('[System] Short-term memory, long-term RAM, and Persona instructions purged.'));

    // Re-seed the persona from the agent/ templates
    console.log(chalk.cyan('[System] Re-initializing database schemas and pulling factory templates...'));
    initDb();

    console.log(chalk.green('\n[System] Wipe complete. Tars has been reset to an initial state.'));
} catch (error) {
    console.error(chalk.red('\n[Error] Failed to wipe memory core:'), error);
    process.exit(1);
}
