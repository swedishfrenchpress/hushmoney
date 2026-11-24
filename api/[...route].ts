import { handle } from 'hono/vercel';
import { app } from '../server/app.js';

// Every /api/* request on Vercel lands here; in dev, vite.config.ts mounts the same app.
export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
