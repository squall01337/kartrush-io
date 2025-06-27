module.exports = {
  apps: [{
    name: 'kartrush-io',
    script: './backend/server.js',
    cwd: '/root/kartrush-io',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
