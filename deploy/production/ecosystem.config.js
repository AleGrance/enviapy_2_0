const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const logsDir = path.join(rootDir, 'logs');

module.exports = {
  apps: [
    {
      name: 'whatsapp-platform-backend',
      cwd: rootDir,
      script: './deploy/production/scripts/start-backend.sh',
      interpreter: '/bin/bash',
      env: {
        NODE_ENV: 'production',
      },
      out_file: path.join(logsDir, 'pm2-backend.out.log'),
      error_file: path.join(logsDir, 'pm2-backend.err.log'),
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
    {
      name: 'whatsapp-platform-frontend',
      cwd: rootDir,
      script: './deploy/production/scripts/start-frontend.sh',
      interpreter: '/bin/bash',
      env: {
        NODE_ENV: 'production',
      },
      out_file: path.join(logsDir, 'pm2-frontend.out.log'),
      error_file: path.join(logsDir, 'pm2-frontend.err.log'),
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
    },
  ],
};
