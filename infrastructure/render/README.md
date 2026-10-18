# Render deployment (API)

Target: the FastAPI service. **No deployment is done without owner
authorization.** This documents the intended configuration so the choice is
reviewable, not executed.

```yaml
# render.yaml equivalent, for reference only
type: web
name: mdexs-flow-api
runtime: docker
plan: free            # revisit for production
dockerfilePath: services/api/Dockerfile
# Env vars (set in Render dashboard, never in the repo):
#   ENV=production
#   DATABASE_URL=<Neon pooled connection string>
#   CORS_ORIGINS=<exact production origins>
#   LOG_LEVEL=INFO
# Render injects PORT; the container must honor it. The Dockerfile CMD uses
# port 8000 — replace with "$PORT" binding at deploy time (see scripts/).
```

Notes:
- The health check path is `/health` (fast liveness probe, no DB access).
- Neon credentials are backend-only (Render environment), never in the app.
