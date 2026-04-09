
1) npm run extract && npm run build-index

2) python3 -m http.server 8080

3) http://localhost:8080/


----


A. Prepare superficialTension as a deployable site
Confirm it runs locally as static files (e.g. python3 -m http.server from the project root, open index.html). Fix anything that breaks before deploying.

Ensure production assets exist in that folder: index.html, css/, js/, frames-index.json, frames/out/…, CENTER.png (idle static), etc. (whatever your app actually loads). If you use the extract pipeline, run your usual extract + build-index before deploy.

Put the project in Git (if it isn’t already): git init, .gitignore for junk (you may still ignore huge folders if you use another strategy; for a full static deploy you usually commit the frames you need).

Create a GitHub repo (e.g. superficial-tension) and push this project to main (or your default branch).
---


B. Deploy only this project on Vercel
Log in at vercel.com and Add New → Project.

Import the GitHub repo you just created.

Framework preset: Other (or “No framework”) — it’s static HTML/JS.

Build command: leave empty (or echo "no build" if the UI forces one).

Output directory: set to . (project root), i.e. the folder that contains index.html at the top level.

If index.html were in a subfolder, you’d set that subfolder — yours should be root.
Deploy. Wait until Vercel gives you a URL like https://something.vercel.app.

Open that URL in the browser and test: intro, click, fullscreen, gaze, no 404s on frames-index.json or images.

Optional but recommended: in Vercel → Project → Domains, attach a custom subdomain (e.g. tension.yourdomain.com) so the URL stays stable if you ever move projects.

C. Point the portfolio at Vercel (so you don’t redeploy the whole site for piece updates)
In websiteDesign, change the Artwork iframe src from /superficial-tension/index.html to your full Vercel URL, e.g.
https://your-project.vercel.app/index.html
(or your custom domain + path if applicable).

Redeploy the portfolio once after this change (so production uses the new iframe URL). After that, routine updates to superficialTension = only Vercel, not the portfolio.

Optional: use a Vite env variable (e.g. VITE_SUPERFICIAL_TENSION_URL) for that URL so you can switch dev/prod without hunting strings — still one portfolio deploy when the URL changes.

D. Iframe / browser details (quick checks)
Keep allow="fullscreen" (and autoplay if needed) on the iframe in the portfolio — you already use something like that.

If something fails only when embedded: open the Vercel URL alone in a tab. If it works there but not in the iframe, it’s usually mixed content, X-Frame-Options, or CORS — static files on Vercel are normally fine for a simple iframe.

E. Cleanup (optional, avoids duplicate huge assets)
Remove the copied public/superficial-tension/ bundle from websiteDesign if you no longer need same-origin hosting — shrinks the repo and deploy. Only do this after the iframe points at Vercel and you’ve verified production.
F. Your ongoing workflow
Change superficialTension → commit → push to GitHub → Vercel auto-deploys (if you left auto-deploy on).

Change portfolio layout (navbar, Artwork page chrome) → that’s the only time you touch websiteDesign again.