"""stripe webhook — handles subscription events from payment links."""

from __future__ import annotations

import logging

import stripe
from fastapi import APIRouter, HTTPException, Request, Response

from api.db.sqlite import db
from commons.config import settings

log = logging.getLogger(__name__)

router = APIRouter()


def _to_plain(value):
    for method in ("to_dict_recursive", "to_dict"):
        fn = getattr(value, method, None)
        if callable(fn):
            return _to_plain(fn())
    if isinstance(value, dict):
        return {k: _to_plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_plain(v) for v in value]
    return value


def _price_ids(*values: str) -> list[str]:
    out: list[str] = []
    for value in values:
        for part in value.split(","):
            price_id = part.strip()
            if price_id:
                out.append(price_id)
    return out


def _price_to_plan() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for price_id in _price_ids(
        settings.stripe_price_starter_monthly,
        settings.stripe_price_starter_annual,
        settings.stripe_price_starter,
    ):
        mapping[price_id] = "starter"
    for price_id in _price_ids(
        settings.stripe_price_pro_monthly,
        settings.stripe_price_pro_annual,
        settings.stripe_price_pro,
    ):
        mapping[price_id] = "pro"
    return mapping


def _plan_from_subscription(sub: dict) -> str | None:
    try:
        price_id = sub["items"]["data"][0]["price"]["id"]
    except (KeyError, IndexError):
        return None
    return _price_to_plan().get(price_id)


def _period_end(sub: dict) -> int | None:
    pe = sub.get("current_period_end")
    if pe is None:
        try:
            pe = sub["items"]["data"][0].get("current_period_end")
        except Exception:
            pass
    return int(pe) if pe is not None else None


async def _handle_checkout_completed(session: dict) -> str | None:
    clerk_user_id = session.get("client_reference_id")
    if not clerk_user_id:
        log.error(
            "checkout.session.completed missing client_reference_id; cannot attribute payment"
        )
        return None

    customer_id = session.get("customer")
    subscription_id = session.get("subscription")

    plan = status = period_end = None
    if subscription_id:
        sub = _to_plain(stripe.Subscription.retrieve(subscription_id))
        plan = _plan_from_subscription(sub)
        status = sub.get("status")
        period_end = _period_end(sub)

    await db.upsert_stripe_checkout(
        clerk_user_id,
        customer_id=customer_id,
        subscription_id=subscription_id,
        plan=plan,
        subscription_status=status,
        current_period_end=period_end,
    )
    return clerk_user_id


async def _handle_subscription_change(sub: dict) -> str | None:
    customer_id = sub.get("customer")
    clerk_user_id = await db.get_clerk_id_by_stripe_customer(customer_id)
    if not clerk_user_id:
        log.error("subscription.updated for unknown customer %s", customer_id)
        return None

    plan = _plan_from_subscription(sub)
    status = sub.get("status")
    await db.upsert_stripe_subscription(
        clerk_user_id,
        subscription_id=sub.get("id"),
        plan=plan,
        subscription_status=status,
        current_period_end=_period_end(sub),
    )
    return clerk_user_id


async def _handle_subscription_deleted(sub: dict) -> str | None:
    customer_id = sub.get("customer")
    clerk_user_id = await db.get_clerk_id_by_stripe_customer(customer_id)
    if not clerk_user_id:
        log.error("subscription.deleted for unknown customer %s", customer_id)
        return None

    await db.cancel_stripe_subscription(clerk_user_id)
    return clerk_user_id


async def _handle_payment_failed(invoice: dict) -> str | None:
    customer_id = invoice.get("customer")
    clerk_user_id = await db.get_clerk_id_by_stripe_customer(customer_id)
    if not clerk_user_id:
        log.error("invoice.payment_failed for unknown customer %s", customer_id)
        return None

    await db.set_stripe_past_due(clerk_user_id)
    return clerk_user_id


_HANDLERS = {
    "checkout.session.completed": _handle_checkout_completed,
    "customer.subscription.updated": _handle_subscription_change,
    "customer.subscription.deleted": _handle_subscription_deleted,
    "invoice.payment_failed": _handle_payment_failed,
}


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request) -> Response:
    secret = settings.stripe_secret_key.strip()
    webhook_secret = settings.stripe_webhook_secret.strip()
    if not secret or not webhook_secret:
        raise HTTPException(status_code=503, detail="stripe not configured")

    stripe.api_key = secret

    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig, webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        log.warning("rejected stripe webhook: %s", exc)
        raise HTTPException(status_code=400, detail="invalid signature")

    event_id = event["id"]
    event_type = event["type"]

    handler = _HANDLERS.get(event_type)
    if handler is None:
        return Response(status_code=200)

    if await db.is_stripe_event_processed(event_id):
        return Response(status_code=200)

    try:
        result = await handler(_to_plain(event["data"]["object"]))
    except Exception:
        log.exception("failed processing stripe event %s", event_id)
        raise HTTPException(status_code=500, detail="processing error")

    await db.mark_stripe_event_processed(event_id, event_type)

    return Response(status_code=200)
