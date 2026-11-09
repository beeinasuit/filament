# Filament Inventory (PWA)

A static, offline filament tracker for iPhone. There's no backend, no account, and no spool limit. Data is stored in IndexedDB on the device.

Files: `index.html`, `style.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`. There's no build step.

## Run locally
```
python3 -m http.server 8765
```
Then open http://localhost:8765.

## Deploy: Netlify (easiest)
1. Go to https://app.netlify.com/drop.
2. Drag this whole folder onto the page.
3. You get an `https://<name>.netlify.app` URL. To update later, drag the folder again from Site → Deploys.

## Deploy: GitHub Pages
```
git init && git add . && git commit -m "Filament inventory"
gh repo create filament --public --source=. --push
```
Then on GitHub, open the repo → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`. The site will be at `https://<user>.github.io/filament/`. All paths are relative, so the subfolder works.

## Updating the app
When you change any file, bump `VERSION` in `sw.js` (e.g. `filament-v2`) and redeploy. On the phone, open the app, close it fully, and reopen it to pick up the new version.

## Add to iPhone home screen
1. Open the deployed URL in **Safari**.
2. Tap **Share** (the square with an up arrow), then **Add to Home Screen**, then **Add**.
3. Launch it from the icon. It runs full-screen and works offline.

The home-screen app has its own storage, separate from Safari tabs. Seed data loads on first launch there.

## Logging a print
Tap **Log a print**, then take a photo of the slicer's estimate or pick a screenshot. The app reads the grams on the phone itself, with no server or account. The first time, it downloads a ~4 MB text reader. It's built for the Bambu Studio / OrcaSlicer filament table, where it uses each filament's **Total** column, and it also understands PrusaSlicer and Cura totals. Check the numbers it read against the photo, fix any misreads, pick the spool for each filament, and tap **Apply**. Every print is saved under History (the clock icon), and you can undo it there.

Screenshots read much more reliably than photos of a monitor.

## Backup
Use Settings (⚙︎) → **Export JSON backup** to save the file to Files or AirDrop it. Restore it with **Import JSON backup**. Deleting the home-screen icon, or iOS clearing site data, erases the inventory, so export now and then.
