#!/usr/bin/env bash
# End-to-end test for the Cloud Run A2A Docker image.
#
# Builds the image with podman, starts a container, verifies the agent-card
# endpoint, sends a real message via the A2A JSON-RPC streaming protocol,
# and validates the response.
#
# Requirements:
#   - podman installed
#   - GEMINI_API_KEY set in the environment
#
# Usage:
#   GEMINI_API_KEY=... ./deploy/cloudrun/test-e2e.sh

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
IMAGE_NAME="gemini-a2a-e2e-test"
CONTAINER_NAME="gemini-a2a-e2e-$$"
HOST_PORT="${TEST_PORT:-9090}"
TIMEOUT_SECS=120
STARTUP_TIMEOUT=60

# ── Colours / helpers ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  FAILURES=$((FAILURES + 1))
}
info() { echo -e "${YELLOW}→${NC} $1"; }
header() { echo -e "\n${BOLD}── $1 ──${NC}"; }

FAILURES=0

cleanup() {
  header "Cleanup"
  if podman container exists "$CONTAINER_NAME" 2>/dev/null; then
    info "Stopping container $CONTAINER_NAME"
    podman stop "$CONTAINER_NAME" --time 5 2>/dev/null || true
    podman rm -f "$CONTAINER_NAME" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Pre-flight checks ───────────────────────────────────────────────────────
header "Pre-flight checks"

if ! command -v podman &>/dev/null; then
  echo "ERROR: podman is not installed" >&2
  exit 1
fi
pass "podman found"

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "ERROR: GEMINI_API_KEY is not set" >&2
  exit 1
fi
pass "GEMINI_API_KEY is set"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ ! -f "$REPO_ROOT/deploy/cloudrun/Dockerfile" ]]; then
  echo "ERROR: cannot find Dockerfile at $REPO_ROOT/deploy/cloudrun/Dockerfile" >&2
  exit 1
fi
pass "Dockerfile found at repo root"

# ── Step 1: Build the image ─────────────────────────────────────────────────
header "Step 1: Build image"
info "Building $IMAGE_NAME (this may take several minutes)..."

podman build \
  --tag "$IMAGE_NAME" \
  --file deploy/cloudrun/Dockerfile \
  "$REPO_ROOT"

pass "Image built successfully"

# ── Step 2: Start the container ──────────────────────────────────────────────
header "Step 2: Start container"
info "Starting container on port $HOST_PORT"

podman run -d \
  --name "$CONTAINER_NAME" \
  --publish "${HOST_PORT}:8080" \
  --env "GEMINI_API_KEY=${GEMINI_API_KEY}" \
  --env "GEMINI_FOLDER_TRUST=true" \
  --env "GEMINI_YOLO_MODE=true" \
  --env "CODER_AGENT_WORKSPACE_PATH=/workspace" \
  "$IMAGE_NAME"

pass "Container started"

# ── Step 3: Wait for the A2A server to be ready ─────────────────────────────
header "Step 3: Wait for server readiness"
info "Waiting up to ${STARTUP_TIMEOUT}s for agent-card endpoint..."

READY=false
for i in $(seq 1 "$STARTUP_TIMEOUT"); do
  if curl -sf "http://localhost:${HOST_PORT}/.well-known/agent-card.json" >/dev/null 2>&1; then
    READY=true
    break
  fi
  # Check container is still running
  if ! podman container exists "$CONTAINER_NAME" 2>/dev/null ||
    [[ "$(podman inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null)" != "true" ]]; then
    echo ""
    fail "Container exited before server was ready"
    info "Container logs:"
    podman logs "$CONTAINER_NAME" 2>&1 | tail -50
    exit 1
  fi
  printf "."
  sleep 1
done
echo ""

if [[ "$READY" != "true" ]]; then
  fail "Server did not become ready within ${STARTUP_TIMEOUT}s"
  info "Container logs:"
  podman logs "$CONTAINER_NAME" 2>&1 | tail -50
  exit 1
fi
pass "Server is ready"

# ── Step 4: Validate agent-card ──────────────────────────────────────────────
header "Step 4: Validate agent-card"

AGENT_CARD=$(curl -sf "http://localhost:${HOST_PORT}/.well-known/agent-card.json")

# Check required fields
for field in name description url capabilities; do
  if echo "$AGENT_CARD" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
    pass "agent-card has '$field' field"
  else
    fail "agent-card missing '$field' field"
  fi
done

# Check streaming capability
if echo "$AGENT_CARD" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['capabilities']['streaming']==True" 2>/dev/null; then
  pass "agent-card reports streaming=true"
else
  fail "agent-card does not report streaming capability"
fi

# ── Step 5: Send A2A message and validate response ──────────────────────────
header "Step 5: Send A2A streaming message"
info "Sending a simple prompt via JSON-RPC message/stream..."

REQUEST_BODY=$(
  cat <<'JSONEOF'
{
  "jsonrpc": "2.0",
  "id": "e2e-test-1",
  "method": "message/stream",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "parts": [{"kind": "text", "text": "Respond with exactly: hello-e2e"}],
      "messageId": "msg-e2e-001"
    },
    "metadata": {
      "coderAgent": {
        "kind": "agent-settings",
        "workspacePath": "/workspace"
      }
    }
  }
}
JSONEOF
)

# Capture SSE response with a timeout
SSE_OUTPUT=$(curl -sf \
  --max-time "$TIMEOUT_SECS" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY" \
  "http://localhost:${HOST_PORT}/" 2>&1) || true

if [[ -z "$SSE_OUTPUT" ]]; then
  fail "No response received from message/stream"
  info "Container logs:"
  podman logs "$CONTAINER_NAME" 2>&1 | tail -50
  exit 1
fi
pass "Received SSE response"

# Check that we got valid SSE data lines
SSE_DATA_LINES=$(echo "$SSE_OUTPUT" | grep "^data:" | wc -l | tr -d ' ')
if [[ "$SSE_DATA_LINES" -gt 0 ]]; then
  pass "Response contains $SSE_DATA_LINES SSE data events"
else
  fail "Response contains no SSE data events"
  info "Raw response (first 2000 chars):"
  echo "$SSE_OUTPUT" | head -c 2000
fi

# Validate JSON-RPC structure in at least one event
VALID_JSONRPC=false
while IFS= read -r line; do
  json="${line#data: }"
  if echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('jsonrpc') == '2.0'
assert 'result' in d or 'error' in d
" 2>/dev/null; then
    VALID_JSONRPC=true
    break
  fi
done <<<"$(echo "$SSE_OUTPUT" | grep "^data:")"

if [[ "$VALID_JSONRPC" == "true" ]]; then
  pass "SSE events contain valid JSON-RPC 2.0 responses"
else
  fail "Could not find valid JSON-RPC 2.0 structure in SSE events"
fi

# Check for a task-creation event (kind: "task")
HAS_TASK_EVENT=$(echo "$SSE_OUTPUT" | grep "^data:" | while IFS= read -r line; do
  json="${line#data: }"
  echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result', {})
if r.get('kind') == 'task':
    print('yes')
" 2>/dev/null
done | head -1)

if [[ "$HAS_TASK_EVENT" == "yes" ]]; then
  pass "Received task-creation event"
else
  fail "No task-creation event found in SSE stream"
fi

# Check for agent text response containing our marker
HAS_TEXT_RESPONSE=$(echo "$SSE_OUTPUT" | grep "^data:" | while IFS= read -r line; do
  json="${line#data: }"
  echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result', {})
status = r.get('status', {})
msg = status.get('message', {})
parts = msg.get('parts', [])
for p in parts:
    text = p.get('text', '')
    if 'hello' in text.lower():
        print('yes')
        break
" 2>/dev/null
done | head -1)

if [[ "$HAS_TEXT_RESPONSE" == "yes" ]]; then
  pass "Agent response contains expected text"
else
  # Not a hard failure — the model may phrase it differently
  info "Note: agent response did not contain 'hello' marker (model output varies)"
fi

# Check for a final event (final: true)
HAS_FINAL_EVENT=$(echo "$SSE_OUTPUT" | grep "^data:" | while IFS= read -r line; do
  json="${line#data: }"
  echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result', {})
if r.get('final') == True:
    print('yes')
" 2>/dev/null
done | head -1)

if [[ "$HAS_FINAL_EVENT" == "yes" ]]; then
  pass "Received final event (agent turn complete)"
else
  fail "No final event found in SSE stream"
fi

# ── Results ──────────────────────────────────────────────────────────────────
header "Results"

if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}${FAILURES} test(s) failed${NC}"
  exit 1
fi
