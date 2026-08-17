"""
clerk session-token verification.

clerk is the source of truth: the browser holds a short-lived clerk session
jwt and sends it as a bearer token. we verify it networklessly against the
instance jwks (public keys), so revocation/expiry take effect within the
token lifetime and there is no second long-lived server session.

two parallel verifiers exist: `customer` (the existing app.melea.ai Clerk
app) and `ops` (a separate Clerk app for ops.melea.ai operators). Each
holds its own publishable key, issuer, jwks cache, and authorized_parties
allowlist. The customer verifier is built eagerly on first use; the ops
verifier is optional — if `CLERK_OPS_PUBLISHABLE_KEY` is empty, ops auth
is disabled (and `/api/ops/*` endpoints will 503).
"""

from __future__ import annotations

import base64

import jwt
from jwt import PyJWKClient

from commons.config import settings


class ClerkAuthError(Exception):
    """raised when a clerk token is missing, malformed, or fails verification."""


def _decode_frontend_api(publishable_key: str) -> str:
    """decode the frontend api host from a publishable key.

    pk_test_<base64> / pk_live_<base64> encode "<host>$" in base64.
    """
    pk = publishable_key.strip()
    parts = pk.split("_", 2)
    if len(parts) != 3 or not parts[2]:
        raise ClerkAuthError("publishable key is not set or malformed")
    encoded = parts[2]
    # pad base64 to a multiple of 4
    decoded = base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8")
    return decoded.rstrip("$")


class ClerkVerifier:
    """verifies clerk session jwts against one specific clerk instance.

    Holds the frontend api host, issuer, jwks client, and azp allowlist for
    that instance. Stateless thread-safe; safe to share across requests.
    """

    def __init__(self, publishable_key: str, authorized_parties: str):
        self._frontend_api = _decode_frontend_api(publishable_key)
        self._issuer = "https://" + self._frontend_api
        self._jwks = PyJWKClient(self._issuer + "/.well-known/jwks.json")
        self._allowed_parties = {
            party.strip() for party in (authorized_parties or "").split(",") if party.strip()
        }

    @property
    def issuer(self) -> str:
        return self._issuer

    def verify(self, token: str) -> dict:
        """verify a clerk session jwt and return its claims.

        checks signature (instance jwks), issuer, exp/nbf, and `azp` against
        the allowlist (if configured). raises ClerkAuthError on any failure.
        performs (cached) network i/o on first use to fetch the jwks, so
        callers should run it off the event loop.
        """
        if not token:
            raise ClerkAuthError("missing token")
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                issuer=self._issuer,
                leeway=60,
                options={"verify_aud": False},
            )
            if self._allowed_parties:
                azp = str(claims.get("azp") or "").strip().rstrip("/")
                allowed = {party.rstrip("/") for party in self._allowed_parties}
                if azp not in allowed:
                    raise ClerkAuthError("token authorized party is not allowed")
        except ClerkAuthError:
            raise
        except Exception as e:  # jwt errors + jwks fetch errors
            raise ClerkAuthError(f"token verification failed: {e}") from e

        return claims


# lazy module-level singletons. Built on first use so the app boots even
# when CLERK_* env vars are not set (local dev without auth, tests).
_customer_verifier: ClerkVerifier | None = None
_ops_verifier: ClerkVerifier | None = None
_ops_verifier_built: bool = False


def get_customer_verifier() -> ClerkVerifier:
    global _customer_verifier
    if _customer_verifier is None:
        _customer_verifier = ClerkVerifier(
            settings.clerk_publishable_key,
            settings.clerk_authorized_parties,
        )
    return _customer_verifier


def get_ops_verifier() -> ClerkVerifier | None:
    """return the ops verifier, or None if CLERK_OPS_PUBLISHABLE_KEY is empty.

    Callers (e.g. `require_ops_auth`) should 503 when this returns None.
    """
    global _ops_verifier, _ops_verifier_built
    if not _ops_verifier_built:
        if settings.clerk_ops_publishable_key.strip():
            _ops_verifier = ClerkVerifier(
                settings.clerk_ops_publishable_key,
                settings.clerk_ops_authorized_parties,
            )
        _ops_verifier_built = True
    return _ops_verifier


def verify_token(token: str) -> dict:
    """customer-clerk verify shim (legacy entrypoint).

    All existing call sites (`require_auth`, `require_claims`,
    `optional_bearer_claims`) assume customer Clerk. They keep working
    via this shim. New ops code uses `get_ops_verifier().verify()` directly.
    """
    return get_customer_verifier().verify(token)
