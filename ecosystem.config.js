module.exports = {
  apps: [
    {
      name: "ambers-angels-api",
      script: "/usr/local/bin/uvicorn",
      args: "backend.main:app --host 0.0.0.0 --port 8000",
      cwd: "/home/ambers-angels/proj_dir/ambers-angels",
      autorestart: true,
      env: {
        DATABASE_URL: "postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels",
        JWT_SECRET: "6fd3d6ee34525198873092d44b300f99312d0aeefb664f7395c1517f0e9cd084",
        ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/1487118233978015809/x4vC4bi56xCJmWzAZIORinokhE6q9Utc5kKAIraaqcj0ubRd3ZDRi91tSV3QEGbh84ic",
      }
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
