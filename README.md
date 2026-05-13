# A&J California Builders — Field App
### T&M Tags & Change Orders | iPad • Phone • Desktop

Built for A&J California Builders, Inc. (CSLB #949668)

## Quick Start (Local)
```bash
cd server
npm install
cp .env.example .env   # fill in your values
node index.js
```
Then open `client/public/index.html` in your browser.

## Deploy
See `DEPLOY.md` for full step-by-step deployment instructions.

## Features
- T&M Tag form (date, job, GC, address, foreman, crew, hours, work description, materials, costs)
- Change Order form (same core + extra work description — office receives fillable PDF to add CO#)
- Auto-calculating totals
- Job dropdown with write-in option for unassigned jobs
- Admin panel to add/edit/remove jobs (no coding required)
- Office receives branded email on every submission
- Submitter gets optional confirmation email
- Works on iPad, iPhone, Android, desktop
- ~$8/month to run reliably with no usage limits
