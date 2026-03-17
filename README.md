# Cardex — Loyalty Wallet

A PWA loyalty card wallet with passkey (WebAuthn) + magic link auth and Cloudflare KV sync.

```
cardex/
├── src/                  # Vite + TypeScript frontend
│   ├── api.ts            # All Worker fetch calls
│   ├── types.ts          # Shared types
│   ├── main.ts           # App entry, event wiring
│   ├── auth/
│   │   ├── passkey.ts    # WebAuthn register / login
│   │   ├── magic.ts      # Magic link send / verify
│   │   └── session.ts    # JWT storage & restore
│   ├── cards/
│   │   ├── store.ts      # In-memory state + localStorage
│   │   ├── sync.ts       # Push / pull against Worker
│   │   └── merge.ts      # Merge strategy (remote-wins)
│   ├── ui/
│   │   ├── auth.ts       # Auth screen, panel switching
│   │   ├── cards.ts      # Card grid, detail, add/edit
│   │   ├── barcode.ts    # JsBarcode + QRCode rendering
│   │   └── toast.ts      # Toast + sync indicator
│   └── scanner/
│       └── scanner.ts    # Camera scan stub (roadmap)
├── worker/               # Cloudflare Worker (TypeScript)
│   └── src/
│       ├── index.ts      # Router
│       ├── cards.ts      # GET/POST /cards
│       ├── types.ts      # Env + KV value types
│       ├── auth/
│       │   ├── passkey.ts # WebAuthn ceremonies
│       │   ├── magic.ts   # Magic link + Brevo email
│       │   └── jwt.ts     # HS256 issue / verify
│       └── lib/
│           ├── cbor.ts    # Minimal CBOR decoder
│           ├── cose.ts    # COSE sig verification
│           ├── encoding.ts# base64url helpers
│           ├── http.ts    # CORS + jsonResponse
│           └── kv.ts      # Typed KV helpers
├── public/               # Static assets + PWA icons
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── deploy.yml            # → copy to .github/workflows/
```

---

## Prerequisites

- Node.js 20+
- A [Cloudflare](https://cloudflare.com) account
- A [Brevo](https://brevo.com) account (free tier is fine)

---

## 1 — Worker setup

```bash
cd worker
npm install

# Create the KV namespace
wrangler kv:namespace create CARDEX_KV
# Copy the returned id into worker/wrangler.toml → kv_namespaces[0].id

# Edit wrangler.toml [vars] — set your Pages domain:
#   FRONTEND_ORIGIN = "https://your-project.pages.dev"
#   FRONTEND_RP_ID  = "your-project.pages.dev"
#   EMAIL_FROM      = "noreply@yourdomain.com"
#   EMAIL_FROM_NAME = "Cardex"

# Set secrets (never committed)
wrangler secret put JWT_SECRET      # paste any long random string
wrangler secret put BREVO_API_KEY   # xkeysib-... from app.brevo.com
```

---

## 2 — Frontend setup

```bash
# In the repo root
npm install

cp .env.example .env.local
# Edit .env.local:
#   VITE_API_URL=https://cardex-api.YOUR-SUBDOMAIN.workers.dev
```

---

## 3 — Local development

```bash
# Terminal 1 — Worker
cd worker && npm run dev    # http://localhost:8787

# Terminal 2 — Frontend
npm run dev                 # http://localhost:5173
```

> Passkeys are domain-bound. For local dev, Chrome on localhost works fine.  
> Make sure `VITE_API_URL=http://localhost:8787` in `.env.local`.

---

## 4 — Deploy

```bash
# Worker
cd worker && npm run deploy

# Frontend
npm run build
wrangler pages deploy dist --project-name=your-project
```

Or push to `master` — GitHub Actions (`deploy.yml`) handles both automatically.

### GitHub Actions secrets needed

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers + Pages permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `VITE_API_URL` | Your deployed Worker URL |

---

## Roadmap

- [ ] **Camera barcode scanning** — `src/scanner/scanner.ts` is stubbed, ready for `BarcodeDetector` implementation
- [ ] **Family / shared sync** — update `src/cards/merge.ts` with `updatedAt` conflict resolution
- [ ] **PWA install prompt** — Vite PWA plugin already configured, just needs an install button wired in `main.ts`
- [ ] **Multi-device passkey management** — list + revoke credentials via new Worker endpoints

---

## KV key schema

| Key | Value |
|---|---|
| `user:{userId}` | `{ id, username, email, createdAt }` |
| `cred:{credentialId}` | `{ userId, publicKeyCose, counter, transports }` |
| `challenge:{token}` | `{ userId?, email?, type }` — TTL 5 min |
| `magiclink:{token}` | `{ userId, email, expires }` — TTL 15 min |
| `email:{email}` | `userId` |
| `cards:{userId}` | `Card[]` |
