# A&J Field App — Deployment Guide
## From Zero to Live in ~30 Minutes

---

## WHAT YOU'LL NEED
- GitHub account (free) — github.com
- Render account (free to sign up) — render.com
- Netlify account (free) — netlify.com
- Resend account (free) — resend.com

---

## STEP 1 — Set Up Resend (Email Service)
1. Go to resend.com → Create free account
2. Add your domain OR use their test domain for now
3. Go to **API Keys** → Create API Key → Copy it (you'll need this)
4. Go to **Domains** → Verify your domain (ajcaliforniabuilders.com) — optional but makes emails look professional

---

## STEP 2 — Push Code to GitHub
1. Go to github.com → New repository → Name it `aj-field-app` → Create
2. On your Mac, open Terminal:
```bash
cd ~/Desktop  # or wherever you saved the aj-field-app folder
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/aj-field-app.git
git push -u origin main
```

---

## STEP 3 — Deploy Backend on Render
1. Go to render.com → New → **Web Service**
2. Connect your GitHub repo → Select `aj-field-app`
3. Settings:
   - **Name:** aj-field-app-server
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** Starter ($7/mo — IMPORTANT: pick paid tier)
4. Click **Advanced** → Add Environment Variables:
   ```
   RESEND_API_KEY    =  re_your_key_here
   OFFICE_EMAIL      =  kathie@ajcaliforniabuilders.com
   ADMIN_PASSWORD    =  YourSecurePassword2025
   FRONTEND_URL      =  https://aj-field-app.netlify.app
   PORT              =  3001
   ```
5. Add a **Disk** (for SQLite persistence):
   - Click **Add Disk**
   - Name: `data`
   - Mount Path: `/data`
   - Size: 1 GB ($1/mo)
   - Add env var: `DB_PATH = /data/ajfield.db`
6. Click **Create Web Service**
7. Wait ~3 minutes → Copy your Render URL (e.g. `https://aj-field-app-xxxx.onrender.com`)

---

## STEP 4 — Update Frontend with Your Render URL
In the `client/public/index.html` file, find this line near the bottom:
```javascript
: 'https://aj-field-app.onrender.com'; // Update with your Render URL
```
Replace with your actual Render URL, then push to GitHub again:
```bash
git add .
git commit -m "Update API URL"
git push
```

---

## STEP 5 — Deploy Frontend on Netlify
1. Go to netlify.com → Add new site → **Import from Git**
2. Connect GitHub → Select `aj-field-app`
3. Settings:
   - **Base directory:** `client/public`
   - **Publish directory:** `client/public`
   - **Build command:** (leave blank)
4. Click **Deploy site**
5. Optional: Go to **Domain settings** → Add custom domain (e.g. `field.ajcaliforniabuilders.com`)

---

## STEP 6 — Test It!
1. Open your Netlify URL on your iPad
2. Submit a test T&M tag
3. Check that Kathie's email receives the formatted email
4. Submit a test Change Order
5. Check that Kathie receives the email with PDF attached

---

## ADMIN PANEL
- Tap **Admin** button (top right of app)
- Login: username `admin` / password = whatever you set in `ADMIN_PASSWORD`
- Add, edit, remove job names & numbers anytime
- Changes reflect immediately in the job dropdowns

---

## MONTHLY COST SUMMARY
| Service | Cost |
|---------|------|
| Render Web Service (Starter) | $7/mo |
| Render Disk (1 GB) | $1/mo |
| Netlify (frontend) | Free |
| Resend (up to 3,000 emails/mo) | Free |
| **Total** | **~$8/mo** |

---

## QUESTIONS?
If you get stuck on any step, just ask Claude — paste the error message and we'll fix it.
