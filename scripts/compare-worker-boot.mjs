// Bootstraps a comparison worker thread with the tsx TypeScript loader.
import { tsImport } from 'tsx/esm/api';
await tsImport('./compare-worker.ts', import.meta.url);
