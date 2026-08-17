"""Structured JSON logging + job_id context variable.

Usage
-----
At startup (main.py lifespan):
    from commons.log import configure_logging
    configure_logging()

At the start of each pipeline run:
    from commons.log import job_id_ctx
    job_id_ctx.set(job_id)

Every log line emitted by application loggers will then include "job_id".
"""

from __future__ import annotations

import json
import logging
import time
from contextvars import ContextVar

# set this at the start of each pipeline run; app log lines carry it
job_id_ctx: ContextVar[str] = ContextVar("job_id", default="")

# standard LogRecord attributes — excluded from the "extra" pass-through
_SKIP_ATTRS = frozenset(
    {
        "args",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        d: dict = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # include any extra={} fields passed to the log call
        for key, val in record.__dict__.items():
            if key not in _SKIP_ATTRS:
                d[key] = val
        if jid := job_id_ctx.get():
            d["job_id"] = jid
        if record.exc_info:
            d["exc"] = self.formatException(record.exc_info)
        return json.dumps(d)


def configure_logging() -> None:
    """Attach JSON formatter to the app logger namespace.

    Only configures app loggers — uvicorn access/error logs are left alone
    so they keep their existing format and don't double-emit.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    app_log = logging.getLogger("app")
    app_log.handlers = [handler]
    app_log.propagate = False
    app_log.setLevel(logging.INFO)
