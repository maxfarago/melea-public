FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

COPY pyproject.toml ./
COPY api ./api
COPY llm ./llm
COPY commons ./commons
COPY ui ./ui
COPY ingestion/linkedin ./ingestion/linkedin
COPY ingestion/web ./ingestion/web
RUN pip install --upgrade pip && pip install .

RUN useradd --create-home --uid 1000 reaction && \
    chown -R reaction:reaction /srv
USER reaction

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
