"""shared sqs long-poll runner."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

import boto3

from commons.config import settings

log = logging.getLogger(__name__)


def _receive_batch(sqs_client: Any, queue_url: str) -> list[dict[str, Any]]:
    resp = sqs_client.receive_message(
        QueueUrl=queue_url,
        MaxNumberOfMessages=10,
        WaitTimeSeconds=20,
    )
    return resp.get("Messages") or []


def delete_message(sqs_client: Any, queue_url: str, receipt_handle: str) -> None:
    sqs_client.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)


async def run_consumer(
    *,
    queue_url: str,
    handler: Callable[[Any, str, str, str], Awaitable[None]],
    name: str,
) -> None:
    sqs = boto3.client("sqs", region_name=settings.aws_region)
    log.info("%s started queue=%s", name, queue_url)
    while True:
        try:
            messages = await asyncio.to_thread(_receive_batch, sqs, queue_url)
            if not messages:
                continue
            for msg in messages:
                body = msg.get("Body") or ""
                receipt = msg.get("ReceiptHandle") or ""
                if not receipt:
                    continue
                try:
                    await handler(sqs, queue_url, body, receipt)
                except Exception:
                    log.exception("%s message processing failed", name)
        except asyncio.CancelledError:
            log.info("%s shutting down", name)
            raise
        except Exception:
            log.exception("%s poll failed", name)
            await asyncio.sleep(5)
