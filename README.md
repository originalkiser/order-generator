# OrderGen

Inventory-driven order planning tool. Upload a spreadsheet, map your columns, review and edit suggested orders, then export a customized order file.

## Quick Start (Local Dev)

```bash
npm install
npm run dev
```

Open http://localhost:5173/ordergen/ in your browser.

---

## Deploy to GitHub Pages (Automatic)

### One-time setup

1. **Create a GitHub repository** — name it whatever you want (e.g. `ordergen`).

2. **Update `vite.config.js`** — set `base` to match your repo name exactly:
   ```js
   base: '/your-repo-name/',
   ```

3. **Push this folder** to your repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

4. **Enable GitHub Pages** in your repo settings:
   - Go to **Settings → Pages**
   - Under *Source*, select **GitHub Actions**
   - Save

5. That's it. Every push to `main` automatically builds and deploys. Your app will be live at:
   ```
   https://YOUR_USERNAME.github.io/YOUR_REPO/
   ```

---

## Deploy to a Custom Domain / Self-Hosted

### Option A — Static file hosting (Netlify, Vercel, Cloudflare Pages, S3, etc.)

1. Update `vite.config.js` to use a root base:
   ```js
   base: '/',
   ```

2. Build:
   ```bash
   npm run build
   ```

3. Upload the contents of the `dist/` folder to your host.

   - **Netlify**: drag the `dist` folder onto netlify.com/drop
   - **Vercel**: `npx vercel --prod` from this folder
   - **Cloudflare Pages**: connect your GitHub repo, set build command to `npm run build`, output to `dist`
   - **Apache/Nginx**: copy `dist/` to your web root (e.g. `/var/www/html/ordergen/`)

### Option B — Nginx on your own server

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /var/www/ordergen/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Copy `dist/` to `/var/www/ordergen/dist` after each build.

---

## Project Structure

```
ordergen/
├── src/
│   ├── App.jsx          # The entire application
│   └── main.jsx         # React entry point
├── index.html           # HTML shell
├── vite.config.js       # Build config (set base here)
├── package.json
└── .github/
    └── workflows/
        └── deploy.yml   # Auto-deploy to GitHub Pages on push
```

## Notes

- All processing happens **in the browser** — no server, no data leaves your machine.
- Product rules and column mappings are saved to **localStorage** in the browser where the app is running.
- Supports `.xlsx`, `.xls`, and `.csv` input files.
- Exports as `.xlsx`, `.csv`, or tab-delimited `.txt`.
