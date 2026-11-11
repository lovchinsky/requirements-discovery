import path from 'node:path';
import { runHook } from './hook.mjs';
runHook(path.resolve(__dirname, '..'));
