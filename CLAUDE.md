# Amber's Angels — Claude Instructions

## SSH / Server Access

- Server: `root@157.245.125.103`
- SSH key: `~/.ssh/ambers_angels_deploy`
- SSH password: `Ambers1Angels`
- **Never prompt the user for the SSH password. Use it directly.**
- PM2 is installed under the `ambers-angels` user:
  `/home/ambers-angels/.local/bin/pm2`
- Always run PM2 commands as that user:
  `su -l ambers-angels -c '/home/ambers-angels/.local/bin/pm2 ...'`
- App lives at: `/home/ambers-angels/proj_dir/ambers-angels/`
- DB: `postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels`
  - Connect via psql: `psql -h 127.0.0.1 -U postgres ambersangels`
- Use `DEBIAN_FRONTEND=noninteractive` to suppress interactive prompts
