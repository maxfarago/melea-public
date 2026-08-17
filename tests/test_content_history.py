from api.features.content_history import bucket_content_history, content_history_bucket


def test_content_history_bucket_rules():
    now = 1_700_000_000.0
    recent = now - 3600
    old = now - 25 * 3600

    assert content_history_bucket({"status": "posted", "updated_at": recent}, now=now) == "active"
    assert content_history_bucket({"status": "posted", "updated_at": old}, now=now) == "inactive"
    assert content_history_bucket({"status": "ready", "created_at": recent}, now=now) == "draft"
    assert content_history_bucket({"status": "thinking", "created_at": old}, now=now) == "archived"


def test_bucket_content_history_order_and_sections():
    now = 1_700_000_000.0
    recent = now - 3600
    old = now - 25 * 3600
    rows = [
        {"id": "inactive", "status": "posted", "updated_at": old, "created_at": old},
        {"id": "draft", "status": "ready", "created_at": recent, "updated_at": recent},
        {"id": "active", "status": "posted", "updated_at": recent, "created_at": old},
        {"id": "archived", "status": "thinking", "created_at": old, "updated_at": old},
    ]
    out = bucket_content_history(rows, now=now)

    assert out["archived_count"] == 1
    assert [c["id"] for c in out["campaigns"]] == ["active", "draft", "inactive"]
    assert out["campaigns"][0]["bucket"] == "active"
    assert out["campaigns"][1]["bucket"] == "draft"
    assert out["campaigns"][2]["bucket"] == "inactive"
    assert len(out["sections"]["active"]) == 1
    assert len(out["sections"]["draft"]) == 1
    assert len(out["sections"]["inactive"]) == 1
