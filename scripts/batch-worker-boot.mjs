// Bootstraps a worker thread with the tsx TypeScript loader.
import { tsImport } from 'tsx/esm/api';
await tsImport('./batch-worker.ts', import.meta.url);
