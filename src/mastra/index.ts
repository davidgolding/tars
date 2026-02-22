import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { Memory } from '@mastra/memory';
import { LibSQLVector } from '@mastra/libsql';
import { google } from '@ai-sdk/google';
import { createAgents, builtinTools } from './agents/tars.js';
import { initDb, dbPath } from '../db.js';

initDb();
const { tarsAgent, bootstrapAgent } = await createAgents();

const globalMemory = new Memory({
  storage: new LibSQLStore({
    id: 'global-memory-storage',
    url: `file:${dbPath}`,
  }),
  vector: new LibSQLVector({
    id: 'global-vector',
    url: `file:${dbPath}`,
  }),
  embedder: google.textEmbeddingModel('gemini-embedding-001'),
});

if (typeof (globalMemory as any).__setLogger !== 'function') {
  (globalMemory as any).__setLogger = () => { };
}

export const mastra = new Mastra({
  agents: { tars: tarsAgent, bootstrap: bootstrapAgent },
  tools: builtinTools,
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: `file:${dbPath}`,
  }),
  memory: {
    default: globalMemory
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(),
          new CloudExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});

export { tarsAgent, bootstrapAgent };
