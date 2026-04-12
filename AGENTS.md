# Cardex — Loyalty Wallet

PWA loyalty card wallet with passkey/magic-link auth and Cloudflare KV sync. Two packages: Vite frontend (root) and Cloudflare Worker API (`worker/`).

## Cursor Cloud specific instructions

### Project structure
- **Frontend** (root): Vanilla TypeScript + Vite 8, PWA via `vite-plugin-pwa`. Dev server: `npm run dev` → `http://localhost:5173`
- **Worker API** (`worker/`): Cloudflare Worker + Wrangler 3. Dev server: `cd worker && npm run dev` → `http://localhost:8787` (local KV emulated by Miniflare)

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
