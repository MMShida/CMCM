// Bootstraps a persistent pool worker with the tsx TypeScript loader.
import { tsImport } from 'tsx/esm/api';
await tsImport('./pool-worker.ts', import.meta.url);
