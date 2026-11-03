// ecosystem.config.js — PM2 Process Manager Configuration
// Usage on VPS:
//   sudo npm install -g pm2
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup

module.exports = {
  apps: [
    {
      name: 'free-wifi-gateway',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        ADMIN_PORT: 3000,
        USER_PORT: 3001,
        DRY_RUN: 'false'
      }
    }
  ]
};
