/**
 * InterDash - PM2 Production Ecosystem Configuration
 *
 * Runs the Express.js server (with auth) instead of static file serving.
 * The Express server handles:
 * - Server-side authentication enforcement
 * - Session management with HTTP-only cookies
 * - Protected API routes
 * - Static file serving for the Vite SPA
 */
module.exports = {
  apps: [
    {
      name: 'interdash',
      script: 'npx',
      args: 'tsx server/index.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 5173,
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      max_memory_restart: '500M'
    }
  ]
};
