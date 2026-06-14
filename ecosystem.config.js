/** PM2 process config — run with: pm2 start ecosystem.config.js --env production */
module.exports = {
  apps: [
    {
      name: 'sports-betting-bot',
      script: 'npx',
      args: 'tsx src/sports-betting/bot.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Restart on crash, but not in a tight loop
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      // Keep logs manageable
      out_file: 'logs/bot-out.log',
      error_file: 'logs/bot-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      // Graceful shutdown — let Telegram deregister polling
      kill_timeout: 5000,
    },
  ],
};
