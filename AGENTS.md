# Cardex — Loyalty Wallet

PWA loyalty card wallet with passkey/magic-link auth and Cloudflare KV sync. Two packages: Vite frontend (root) and Cloudflare Worker API (`worker/`).

## Cursor Cloud specific instructions

### Project structure
- **Frontend** (root): Vanilla TypeScript + Vite 8, PWA via `vite-plugin-pwa`. Dev server: `npm run dev` → `http://localhost:5173`
- **Worker API** (`worker/`): Cloudflare Worker + Wrangler 4. Dev server: `cd worker && npm run dev` → `http://localhost:8787` (local KV emulated by Miniflare). Note: existing `wrangler.toml` and dev/deploy scripts are v4-compatible and require no changes.

### Local environment files (not committed)
- `.env.local` at root — must contain `VITE_API_URL=http://localhost:8787`
- `worker/.dev.vars` — must contain `JWT_SECRET=<any-random-string>` (and optionally `BREVO_API_KEY` for magic-link email flow)

### Running dev servers
Start both servers — order doesn't matter:
```
# Terminal 1 — Worker API
cd worker && npm run dev

# Terminal 2 — Frontend
npm run dev
```
The worker uses `wrangler dev` which emulates KV locally in `.wrangler/` — no Cloudflare account needed for local dev.

### Lint / type-check
- Frontend: `npm run type-check` — note: there is a pre-existing TS error in `vite.config.ts` (`manualChunks` object form vs Rolldown's function expectation). This does not block `npm run dev`.
- Worker: `cd worker && npm run type-check` — clean pass.
- No ESLint or Prettier configured in this repo.

### Build
- `npm run build` (`tsc && vite build`) — currently fails due to the same Vite 8 / Rolldown `manualChunks` issue described above. The dev server is unaffected.

### CORS for local dev
The worker reads `Origin` header and reflects it in CORS responses. `http://localhost:5173` works automatically with `wrangler dev`.

### Dependencies
- `npm install --legacy-peer-deps` is required at root due to `vite-plugin-pwa@1.x` peer-dep not covering `vite@8`.
- `npm install` in `worker/` works without flags.

### Passkey auth on localhost
Chrome allows WebAuthn on `localhost` without HTTPS. The worker's `FRONTEND_RP_ID` in `wrangler.toml` points to production; passkey registration will fail locally with an RP ID mismatch. Card management (add/edit/delete) works fully in offline/localStorage mode without authentication.

### Releasing to production
Production deploys are **tag-driven**, not branch pushes. Pushing to `main` alone does not release.

**Always use the release script** — do not create tags manually with `git tag`:
```bash
git checkout main && git pull
npm run release
```
This runs `npm version patch`, which:
1. Bumps `version` in `package.json` (and `package-lock.json`)
2. Commits that bump (e.g. message `2.1.5`)
3. Creates a matching git tag (e.g. `v2.1.5`)
4. Pushes `main` and the tag

The tag push triggers `.github/workflows/release.yml`, which deploys the Worker and frontend (via `wrangler pages deploy`) to production.

The in-app version shown in Settings comes from `package.json` at build time (`__APP_VERSION__` in `vite.config.ts`), so skipping the version bump leaves the UI on the old version even after deploy.

**Ignore `pages-build-deployment` in GitHub Actions** — that is Cloudflare Pages' optional Git-integration build on `main` pushes. Production frontend deploys go through the **Release to Production** workflow on `v*` tags, not that job.

For a specific version instead of the next patch: `npm version 2.2.0 -m "2.2.0" && git push && git push --tags`