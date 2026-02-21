import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { createTarsAgent } from './agents/tars.js';
import { initDb, dbPath } from '../db.js';

initDb();
const tarsAgent = await createTarsAgent();

export const mastra = new Mastra({
  agents: { tars: tarsAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: `file:${dbPath}`,
  }),
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

export { tarsAgent };
