module.exports = {
  apps: [
    {
      name: 'ggrd-rewards-bot',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
