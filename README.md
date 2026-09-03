# Kir Fit

Mobile-first personal strength-training tracker for `fit.kir-it.de`. It includes a Full Body program, workout logging, rest timer, double-progression suggestions, optional RIR, history, exercise progress, body-weight tracking, machine settings, image upload, PWA installation, and offline protection for in-progress sets.

## Stack

- React + TypeScript + Vite PWA
- Express REST API with Zod validation and JWT authentication
- Plesk-managed PostgreSQL + Prisma migrations
- Docker Compose

The domains are separated in the data model (`workouts`, `body weight`, machines and future modules) so nutrition and other health modules can be added without coupling them to workout sessions. Workout records snapshot template settings and names so historical data stays correct when programs change.

## Local development

1. Copy `.env.example` to `.env` and set strong values.
2. Start PostgreSQL: `docker compose up -d db`.
3. Install dependencies: `npm ci`.
4. Run migrations and seed: `npm run db:migrate && npm run db:seed`.
5. Start API and web app in separate terminals: `npm run dev -w @kir-fit/api` and `npm run dev -w @kir-fit/web`.

For the production-shaped setup:

```bash
cp .env.example .env
# edit .env
docker compose up -d db
docker compose run --rm seed
docker compose up -d app
```

Open `http://localhost:3210`. Uploaded images and PostgreSQL data live in named Docker volumes.

### Private nutrition photos

Meal photos use the separate `nutrition_private` volume mounted at
`/app/private/nutrition`; it must never be mounted below the web root or served
with `express.static`. Uploads are decoded from content (not their filename or
request MIME), orientation-normalized, resized and re-encoded without metadata.
The analysis derivative is deleted after every completed or failed provider
attempt. A private thumbnail remains for a pending/saved journal entry and is
only served through an authenticated ownership-checking API route. Unattached
analysis jobs expire after 24 hours.

Production backup jobs should include the `nutrition_private` Docker volume
together with PostgreSQL. Restore it with owner-only permissions (`0700` on the
directory and `0600` on manifests) and never copy it to `/app/uploads`. A restore
test consists of mounting the restored volume into a non-public test container,
reading a thumbnail through the authenticated route as its owner, and verifying
that another account receives `403` without any bytes.

`OPENAI_API_KEY` is a server-only deployment secret. It must not use a `VITE_`
prefix, be passed as a Docker build argument, or be included in frontend config.
`OPENAI_VISION_MODEL`, `NUTRITION_AI_RATE_LIMIT` and `NUTRITION_PRIVATE_DIR` are
non-secret runtime settings.

## Production

Google sign-in uses Google Identity Services. Create an OAuth 2.0 **Web application** client, add `https://fit.kir-it.de` as an authorized JavaScript origin, and set `GOOGLE_CLIENT_ID` in `.env`. The same ID is injected into the frontend at build time and verified by the API.

Without an account the app runs fully in guest mode. Workouts, history, exercise progress, body weight and nutrition entries are stored in browser `localStorage`; the UI permanently warns that browser-local data can be lost. Guest meal-photo analysis is rate-limited by IP and an opaque device identifier. Its server-side photo and AI result are deleted before the request completes; only a compact thumbnail selected by the user can remain in local browser storage.

Production uses `/opt/kir-fit/repo`, a root-owned `.env`, Docker Compose for the application, the PostgreSQL server managed by Plesk, and a Plesk/nginx reverse proxy to `127.0.0.1:3210`. The Compose network has a fixed private subnet so PostgreSQL can grant narrowly scoped access only to the Fit database user. The old containerized database remains behind the `legacy-db` profile for rollback and is not started during normal deploys. GitHub Actions runs type checks, tests, a production build and a Docker build before invoking `deploy/deploy.sh`. The script is locked, migrates before startup, seeds idempotently, restarts only the app stack, and checks the local health endpoint. CI then checks the public HTTPS endpoint.

## Reliability notes

- Every session and set mutation has a client UUID, making retries idempotent.
- The active session is restored on reload.
- Failed set writes are queued locally and synchronized after reconnect. Authenticated API responses are never placed in the shared service-worker cache.
- Set completion is disabled after the planned count; server uniqueness constraints prevent duplicates.
- Undo removes only the most recent active-workout set.
- User-uploaded images are limited to JPEG/PNG/WebP and 5 MB.
- Exercise archival preserves historical relations.

## PWA installation

On Android Chrome, open the HTTPS site and choose **Install app**. The application has a standalone manifest and offline shell. Authenticated API calls remain network-only; active write mutations use the local retry queue without exposing one account's data through a shared cache.
