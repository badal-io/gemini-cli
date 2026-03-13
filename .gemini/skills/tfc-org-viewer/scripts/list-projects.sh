#!/bin/bash
set -euo pipefail

# Check for org argument
ORG="${1:-}"

if [[ -z "$ORG" ]]; then
  echo "Usage: $0 <organization_name>" >&2
  exit 1
fi

TOKEN_FILE="${HOME}/.terraform.d/credentials.tfrc.json"
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Error: TFC credentials not found at $TOKEN_FILE" >&2
  exit 1
fi

TFC_TOKEN=$(jq -r '.credentials."app.terraform.io".token' "$TOKEN_FILE")
if [[ "$TFC_TOKEN" == "null" || -z "$TFC_TOKEN" ]]; then
    echo "Error: Could not extract token from $TOKEN_FILE" >&2
    exit 1
fi

PAGE=1
while [[ "$PAGE" != "null" && -n "$PAGE" ]]; do
  RESPONSE=$(curl -s \
    --header "Authorization: Bearer $TFC_TOKEN" \
    --header "Content-Type: application/vnd.api+json" \
    "https://app.terraform.io/api/v2/organizations/$ORG/projects?page%5Bsize%5D=100&page%5Bnumber%5D=$PAGE")
  
  echo "$RESPONSE" | jq -c '.data[]? | {id: .id, name: .attributes.name}' || true
  PAGE=$(echo "$RESPONSE" | jq -r '.meta.pagination["next-page"]')
done
