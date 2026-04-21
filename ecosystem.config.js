// PM2 process definitions for Amber's Angels.
// Secrets are loaded from .env by each application at startup — do NOT
// put credentials here.  Copy .env.example → .env and fill in your values
// before running: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "ambers-angels-api",
      script: "/usr/local/bin/uvicorn",
      args: "backend.main:app --host 0.0.0.0 --port 8000",
      cwd: "/home/ambers-angels/proj_dir/ambers-angels",
      autorestart: true,
    },
    {
      name: "ambers-angels-web",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/home/ambers-angels/proj_dir/ambers-angels/web",
      autorestart: true,
    }
  ]
}
