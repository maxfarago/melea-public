#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../.env}"
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
# base profile dir; scrape_news.py appends a per-account <member_id> subdir
USER_DATA_DIR="${USER_DATA_DIR:-$HOME/.melea/playwright-x}"
MAX_STORIES="${MAX_STORIES:-50}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if [[ "${PYTHON_BIN}" == "python3" && -x "$HOME/.pyenv/shims/python3" ]]; then
  PYTHON_BIN="$HOME/.pyenv/shims/python3"
fi

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
SNS_TOPIC_ARN="${SNS_TOPIC_ARN:-}"
AWS_REGION="${AWS_REGION:-eu-central-1}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing env file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
SNS_TOPIC_ARN="${SNS_TOPIC_ARN:-}"

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "python interpreter not found: ${PYTHON_BIN}" >&2
  exit 1
fi
RUN_ID="$(date -u +"%Y%m%dT%H%M%SZ")-${RANDOM}"

notify_failure_and_exit() {
  local reason="$1"
  local stage="${2:-startup}"
  local host now_utc body
  host="$(hostname)"
  now_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  body=$(
    cat <<EOF
[trends-twitter-news] failure
run_id: ${RUN_ID}
host: ${host}
stage: ${stage}
time_utc: ${now_utc}
reason: ${reason}
EOF
  )
  slack_notify "${body}"
  sns_notify "trends-twitter-news failure (${host})" "${body}"
  exit 1
}

slack_notify() {
  local text="$1"
  if [[ -z "${SLACK_WEBHOOK_URL}" || "${SLACK_WEBHOOK_URL}" == "replace_me" ]]; then
    echo "SLACK_WEBHOOK_URL not set; skipping slack notification" >&2
    return 0
  fi
  local payload
  payload="$("${PYTHON_BIN}" -c "import json,sys; print(json.dumps({'text': sys.stdin.read()}))" <<<"${text}")"
  curl -sS -X POST \
    -H "Content-Type: application/json" \
    --data "${payload}" \
    "${SLACK_WEBHOOK_URL}" >/dev/null || echo "slack notification failed" >&2
}

sns_notify() {
  local subject="$1"
  local text="$2"
  if [[ -z "${SNS_TOPIC_ARN}" || "${SNS_TOPIC_ARN}" == "replace_me" ]]; then
    echo "SNS_TOPIC_ARN not set; skipping sns notification" >&2
    return 0
  fi
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    AWS_PROFILE="${AWS_PROFILE}" aws sns publish \
      --region "${AWS_REGION}" \
      --topic-arn "${SNS_TOPIC_ARN}" \
      --subject "${subject}" \
      --message "${text}" >/dev/null || echo "sns notification failed" >&2
    return 0
  fi
  aws sns publish \
    --region "${AWS_REGION}" \
    --topic-arn "${SNS_TOPIC_ARN}" \
    --subject "${subject}" \
    --message "${text}" >/dev/null || echo "sns notification failed" >&2
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  notify_failure_and_exit "DATABASE_URL must be set in ${ENV_FILE}" "env_check"
fi

cd "${SCRIPT_DIR}"
# ensure api package is importable (repo installed via pip install -e . or PYTHONPATH)
export PYTHONPATH="${REPO_ROOT}:${PYTHONPATH:-}"
START_EPOCH="$(date +%s)"
START_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

ARGS=(
  --user-data-dir "${USER_DATA_DIR}"
  --max-stories "${MAX_STORIES}"
)

if [[ "${NO_PROXY:-0}" == "1" ]]; then
  ARGS+=(--no-proxy)
fi

TMP_OUTPUT="$(mktemp)"
set +e
"${PYTHON_BIN}" scrape_news.py "${ARGS[@]}" >"${TMP_OUTPUT}" 2>&1
EXIT_CODE=$?
set -e
OUTPUT="$(<"${TMP_OUTPUT}")"
rm -f "${TMP_OUTPUT}"
printf "%s\n" "${OUTPUT}"

while IFS= read -r line; do
  if [[ "${line}" != PROXY_DEACTIVATED_JSON=* ]]; then
    continue
  fi
  event_json="${line#PROXY_DEACTIVATED_JSON=}"
  message="$(
    _EVENT_JSON="${event_json}" "${PYTHON_BIN}" - <<'PYEOF'
import json
import os

event = json.loads(os.environ["_EVENT_JSON"])
print("[trends-twitter-news] proxy deactivated")
print(f"time_utc: {event.get('time_utc') or '?'}")
print(f"proxy: {event.get('proxy_label') or event.get('proxy_server') or '?'}")
print(f"proxy_server: {event.get('proxy_server') or '?'}")
print(f"error_class: {event.get('error_class') or '?'}")
print(f"retry_delay_seconds: {event.get('retry_delay_seconds')}")
print(f"deactivated_count: {event.get('deactivated_count')}")
print(f"trigger_member_id: {event.get('member_id') or '?'}")
print(f"trigger_handle: {event.get('handle') or '?'}")
print(f"trigger_email: {event.get('email') or '?'}")
print(f"audience_id: {event.get('audience_id') or '?'}")
PYEOF
  )"
  slack_notify "$(printf '<!here>\n%s' "${message}")"
  sns_notify "trends-twitter-news proxy deactivated" "${message}"
done <<<"${OUTPUT}"

HOST="$(hostname -s)"
NOW_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
END_EPOCH="$(date +%s)"
RUNTIME_S="$((END_EPOCH - START_EPOCH))"

SLACK_TEXT="$(
  _OUTPUT="${OUTPUT}" _EXIT="${EXIT_CODE}" _RUN_ID="${RUN_ID}" \
  _HOST="${HOST}" _RUNTIME="${RUNTIME_S}" \
  _START="${START_UTC}" _NOW="${NOW_UTC}" \
  "${PYTHON_BIN}" - <<'PYEOF'
import re, json, os

output    = os.environ["_OUTPUT"]
exit_code = int(os.environ["_EXIT"])
run_id    = os.environ["_RUN_ID"]
host      = os.environ["_HOST"]
runtime_s = os.environ["_RUNTIME"]
start_utc = os.environ["_START"]
now_utc   = os.environ["_NOW"]

if exit_code == 0:
    skip_m = re.search(
        r"no eligible member, skipping reason=(\S+) assigned=(\d+) active=(\d+) eligible_now=(\d+)",
        output,
    )
    if skip_m:
        reason, assigned, active, eligible = skip_m.groups()
        print(
            f"*trends-twitter-news* ⏭️  no eligible member · reason=`{reason}` "
            f"· assigned={assigned} active={active} eligible_now={eligible} · `{runtime_s}s`"
        )
        print(f"_{start_utc} → {now_utc}_")
    elif "no eligible member, skipping" in output:
        print(f"*trends-twitter-news* ⏭️  no eligible member · `{runtime_s}s`")
        print(f"_{start_utc} → {now_utc}_")
    else:
        m = re.search(
            r"wrote\s+(\d+)\s+new\s+\+\s+(\d+)\s+updated stories\s+across\s+(\d+)\s+topic categories\s+capture_id=(\S+)",
            output,
        )
        tab_lines = re.findall(r"tab\s+(\w+):\s+kept\s+(\d+)\s+new stories", output)
        parsed = re.search(r"Parsed\s+(\d+)\s+news stories", output)
        observed = (
            str(sum(int(n) for _, n in tab_lines))
            if tab_lines
            else parsed.group(1)
            if parsed
            else "?"
        )
        new_global = m.group(1) if m else "?"
        updated_global = m.group(2) if m else "?"
        cats = m.group(3) if m else "?"
        capture_id = m.group(4) if m else "?"
        tab_summary = "  ".join(f"`{cat}: {n}`" for cat, n in tab_lines)
        skip_json_m = re.search(r"STORIES_SKIPPED_JSON=(\{.+?\})", output)
        skip_summary = ""
        if skip_json_m:
            try:
                skip_data = json.loads(skip_json_m.group(1))
                missing_id = int(skip_data.get("missing_x_trend_id") or 0)
                missing_summary = int(skip_data.get("missing_summary") or 0)
                budget_skips = int(skip_data.get("budget_skips") or 0)
                persisted = skip_data.get("persisted")
                skipped_total = missing_id + missing_summary
                if skipped_total or budget_skips:
                    skip_summary = (
                        f" · skipped `{skipped_total}` "
                        f"(missing x_trend_id={missing_id}, summary={missing_summary}"
                        f"{f', budget={budget_skips}' if budget_skips else ''})"
                    )
                if persisted is not None:
                    skip_summary += f" · persisted `{persisted}`"
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        a = re.search(r"selected member \S+ audience=\S+ \(([^)]+)\) proxy=(.+?) last_run=", output)
        acct_email = a.group(1) if a else "?"
        acct_proxy = a.group(2) if a else "?"
        print(
            f"*trends-twitter-news* ✅  `observed {observed} stories` "
            f"· `{new_global} new global` · `{updated_global} updated` "
            f"· `{cats} topics` · capture `{capture_id}` · `{runtime_s}s`{skip_summary}"
        )
        if tab_summary:
            print(f"tabs: {tab_summary}")
        print(f"account: `{acct_email}`  proxy: `{acct_proxy}`")
        print(f"_{start_utc} → {now_utc}_")
else:
    lines = [ln.strip() for ln in output.splitlines() if ln.strip()]
    err = next((ln for ln in lines if ln.startswith("ERROR:")), "")
    err = err.removeprefix("ERROR:").strip() if err else (lines[-1] if lines else "unknown error")
    is_auth = any(x in err.lower() for x in ("no tweet articles visible", "auth gate", "selector drift", "no articles loaded"))
    hint = "update selected `audience_members` auth_token/ct0 and retry" if is_auth else "check runner logs for selector/auth changes"
    tail = "\n".join(lines[-8:])
    print(f"*trends-twitter-news* ❌  exit `{exit_code}` · `{runtime_s}s`")
    print(f"`{err}`")
    print(f"> {hint}")
    print(f"```{tail}```")
    print(f"_run_id: {run_id}_")
PYEOF
)"

slack_notify "${SLACK_TEXT}"
if [[ ${EXIT_CODE} -ne 0 ]]; then
  sns_notify "trends-twitter-news failure (${HOST})" "${SLACK_TEXT}"
fi
exit "${EXIT_CODE}"
