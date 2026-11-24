import { handle } from 'hono/vercel';
import { app } from '../../server/app.js';

// /api/admin/* on Vercel. api/[...route].ts only matches one path segment there.
export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
