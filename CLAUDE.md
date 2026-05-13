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

## iOS / Android Builds (EAS)

- Mobile config is `mobile/app.config.js` (dynamic) — **`autoIncrement` in eas.json is NOT supported with app.config.js**. Do not add it.
- To submit a new build, bump `ios.buildNumber` in `app.config.js` before each build, then:
  ```
  eas build --platform ios --profile production
  eas submit --platform ios --profile production --latest
  ```
- Increment the buildNumber string by 1 each time ("1" → "2" → "3" etc).
- Never suggest `autoIncrement: true` in eas.json or `--build-number` flag — neither works with app.config.js.

## Pending TODO

- Update `grants/Handoff/amber-angels/project/Technical Deck.html` (and `-print.html`) whenever architecture changes are made — keep speaker notes and slide content in sync with: new alert pollers (FEMA EAS, amber.alert.gov, NCMEC), direct EMS SMS notification via Twilio, role matrix (pilot / coordinator / admin), cancellation pipeline.
