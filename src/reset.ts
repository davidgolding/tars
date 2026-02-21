import db, { initDb } from './db.js';
import chalk from 'chalk';

console.log(chalk.red('\n[System] Commencing total cortical wipe...'));

try {
    // Clear Mastra memory tables (messages, threads, vector embeddings)
    // These tables may not exist on a fresh install, so we ignore errors
    const mastraTables = [
        'mastra_messages',
        'mastra_threads',
        'mastra_resources',
        'mastra_memory_text_embedding_004',
    ];

    for (const table of mastraTables) {
        try {
            db.exec(`DELETE FROM "${table}";`);
        } catch (_err) {
            // Table may not exist yet — that's fine
        }
    }

    // Clear out the seeded agent persona
    db.exec('DELETE FROM agent_context;');

    // Clear out the settings
    db.exec('DELETE FROM settings;');

    console.log(chalk.yellow('[System] Memory, threads, and persona instructions purged.'));

    // Re-seed the persona from the agent/ templates
    console.log(chalk.cyan('[System] Re-initializing database schemas and pulling factory templates...'));
    initDb();

    console.log(chalk.green('\n[System] Wipe complete. Tars has been reset to an initial state.'));
} catch (error) {
    console.error(chalk.red('\n[Error] Failed to wipe memory core:'), error);
    process.exit(1);
}
