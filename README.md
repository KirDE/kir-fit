# Kir Fit

Mobile-first personal strength-training tracker for `fit.kir-it.de`. It includes a Full Body program, workout logging, rest timer, double-progression suggestions, optional RIR, history, exercise progress, body-weight tracking, machine settings, image upload, PWA installation, and offline protection for in-progress sets.

## Stack

- React + TypeScript + Vite PWA
- Express REST API with Zod validation and JWT authentication
- PostgreSQL + Prisma migrations
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

## Production

Production uses `/opt/kir-fit/repo`, a root-owned `.env`, Docker Compose, and a Plesk/nginx reverse proxy to `127.0.0.1:3210`. GitHub Actions runs type checks, tests, a production build and a Docker build before invoking `deploy/deploy.sh`. The script is locked, migrates before startup, seeds idempotently, restarts only the app stack, and checks the local health endpoint. CI then checks the public HTTPS endpoint.

## Reliability notes

- Every session and set mutation has a client UUID, making retries idempotent.
- The active session is restored on reload.
- Failed set writes are queued locally and synchronized after reconnect.
- Set completion is disabled after the planned count; server uniqueness constraints prevent duplicates.
- Undo removes only the most recent active-workout set.
- User-uploaded images are limited to JPEG/PNG/WebP and 5 MB.
- Exercise archival preserves historical relations.

## PWA installation

On Android Chrome, open the HTTPS site and choose **Install app**. The application has a standalone manifest and offline shell. API read caches use Network First; active write mutations additionally use the local retry queue.
