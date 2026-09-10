/**
 * InterDash - PM2 Production Ecosystem Configuration
 * https://github.com/xRosieRose/InterDash
 */
module.exports = {
  apps: [
    {
      name: 'interdash',
      script: 'serve',
      env: {
        PM2_SERVE_PATH: './dist',
        PM2_SERVE_PORT: process.env.PORT || 5173,
        PM2_SERVE_SPA: 'true',
        PM2_SERVE_HOMEPAGE: '/index.html'
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      max_memory_restart: '500M'
    }
  ]
};
