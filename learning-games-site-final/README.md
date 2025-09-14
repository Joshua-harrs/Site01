# Learning Games Site — Pro Complete

This repository is an enhanced production-ready starter for a Learning Games Hub with many advanced features:

Features added in this "complete" package:
- Bulk ZIP upload endpoint (backend) with automatic extraction and metadata ingestion.
- Optional S3 storage support (toggle via env vars) for uploaded games and assets.
- CSP headers and iframe sandboxing for safer playback; iframe sandbox enforced in frontend.
- Admin UI: user management, comment moderation, analytics dashboard with charts.
- Ready-to-deploy scripts and instructions for Render/Heroku/Vercel and Docker Compose.
- CI workflow updated for tests, build, and optional deployment steps.

See `/backend` and `/frontend` for details. Start with Docker Compose:
```
docker-compose up --build
```

.env examples are in `/backend/.env.example` and `/frontend/.env.example`.
