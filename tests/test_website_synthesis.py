import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from llm.profiling import (  # noqa: E402
    _coerce_website_synthesis,
    _normalize_meta_term,
)


def test_normalize_meta_term_trims_noise() -> None:
    assert _normalize_meta_term("  Acme, Inc.!!!  ") == "Acme Inc"


def test_coerce_website_synthesis_dedupes_and_fallbacks() -> None:
    raw = {
        "business_name": "Acme Labs",
        "primary_search_term": "Acme Labs",
        "alternate_terms": [
            "acme labs",
            "Acme Laboratories",
            "Acme-Labs",
            "",
            "Acme Laboratories",
        ],
    }
    terms = _coerce_website_synthesis(
        raw,
        fallback_term="acme",
        fallback_business_name="acme",
    )
    assert terms.business_name == "Acme Labs"
    assert terms.primary_search_term == "Acme Labs"
    assert terms.alternate_terms == ["Acme Laboratories", "Acme-Labs", "acme"]


def test_coerce_website_synthesis_uses_fallback_when_empty() -> None:
    terms = _coerce_website_synthesis(
        {
            "business_name": "",
            "primary_search_term": "",
            "alternate_terms": [],
        },
        fallback_term="drinklmnt",
        fallback_business_name="drinklmnt",
    )
    assert terms.primary_search_term == "drinklmnt"
    assert terms.business_name == "drinklmnt"
    assert terms.alternate_terms == []
