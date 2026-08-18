# api

fastapi app: brand onboarding, news stories, sitmar campaigns.

local:

```bash
cp api/.env.example api/.env
pip install -e .
set -a && source api/.env && set +a
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

open `http://localhost:8000/app`. domain tables need postgres (`DATABASE_URL`) and `psql "$DATABASE_URL" -f api/db/schema.pg.sql`.
