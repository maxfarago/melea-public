from __future__ import annotations

from api.routes import stripe as stripe_routes
from commons.config import settings


def test_price_to_plan_maps_monthly_and_annual(monkeypatch):
    monkeypatch.setattr(settings, "stripe_price_starter", "")
    monkeypatch.setattr(settings, "stripe_price_pro", "")
    monkeypatch.setattr(settings, "stripe_price_starter_monthly", "price_rise_m")
    monkeypatch.setattr(settings, "stripe_price_starter_annual", "price_rise_a")
    monkeypatch.setattr(settings, "stripe_price_pro_monthly", "price_grow_m")
    monkeypatch.setattr(settings, "stripe_price_pro_annual", "price_grow_a")

    mapping = stripe_routes._price_to_plan()
    assert mapping == {
        "price_rise_m": "starter",
        "price_rise_a": "starter",
        "price_grow_m": "pro",
        "price_grow_a": "pro",
    }


def test_plan_from_subscription_uses_mapping(monkeypatch):
    monkeypatch.setattr(settings, "stripe_price_starter", "")
    monkeypatch.setattr(settings, "stripe_price_pro", "")
    monkeypatch.setattr(settings, "stripe_price_starter_monthly", "")
    monkeypatch.setattr(settings, "stripe_price_starter_annual", "price_rise_a")
    monkeypatch.setattr(settings, "stripe_price_pro_monthly", "")
    monkeypatch.setattr(settings, "stripe_price_pro_annual", "")

    sub = {"items": {"data": [{"price": {"id": "price_rise_a"}}]}}
    assert stripe_routes._plan_from_subscription(sub) == "starter"
