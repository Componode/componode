#!/usr/bin/env bash
# cutover-branch-settings.sh — apply the repository settings half of the
# two-branch cutover (specs/084-branch-release-strategy).
#
# These are REAL repository settings changes. The script prints each step
# and asks for one confirmation before applying anything.
#
# Prerequisites: gh CLI authenticated with admin access to the repository.
#
# Known platform limitation: GitHub rulesets cannot restrict merge types
# per branch. "Merge commits only on main" is enforced by reviewer practice
# and documented in docs/branching-and-releasing.md — not by settings.

set -euo pipefail

REPO="${1:-Componode/componode}"

echo "BEFORE RUNNING: create a fine-grained PAT secret named RELEASE_TOKEN on the"
 echo "repository (contents:write + pull-requests:write on this repo only). The release"
 echo "automation falls back to GITHUB_TOKEN without it, but token-created PRs may not"
 echo "trigger CI — unattended releases REQUIRE this secret."
 echo ""
 echo "This script will modify repository settings for ${REPO}:"
echo "  1. Set the default branch to 'develop' (the branch must already exist)"
echo "  2. Create/update branch rulesets for 'develop' and 'main'"
echo "  3. Enable auto-merge"
echo "  4. Disable the repository-level CodeQL default setup (replaced by the in-repo advanced workflow)"
echo
read -r -p "Type 'yes' to proceed: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo "==> 1. Setting default branch to develop"
gh api "repos/${REPO}" -X PATCH -f default_branch=develop --jq '.default_branch'

echo "==> 2. Creating branch rulesets"

DEVELOP_RULESET=$(cat <<'JSON'
{
  "name": "develop protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/develop"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "check" },
          { "context": "e2e" },
          { "context": "dependency-review" },
          { "context": "Analyze (javascript-typescript)" },
          { "context": "Analyze (actions)" }
        ]
      }
    }
  ]
}
JSON
)

MAIN_RULESET=$(cat <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "check" },
          { "context": "e2e" },
          { "context": "dependency-review" },
          { "context": "main-guard" },
          { "context": "Analyze (javascript-typescript)" },
          { "context": "Analyze (actions)" }
        ]
      }
    }
  ]
}
JSON
)

upsert_ruleset() {
  local name="$1" json="$2"
  local existing_id
  existing_id=$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${name}\") | .id" 2>/dev/null | head -1 || true)
  if [ -n "$existing_id" ]; then
    echo "    updating existing ruleset '${name}' (id ${existing_id})"
    gh api "repos/${REPO}/rulesets/${existing_id}" -X PUT --input - <<< "$json" --jq '.id'
  else
    echo "    creating ruleset '${name}'"
    gh api "repos/${REPO}/rulesets" -X POST --input - <<< "$json" --jq '.id'
  fi
}

upsert_ruleset "develop protection" "$DEVELOP_RULESET"
upsert_ruleset "main protection" "$MAIN_RULESET"

echo "==> 3. Enabling auto-merge"
gh api "repos/${REPO}" -X PATCH -F allow_auto_merge=true --jq '.allow_auto_merge'

echo "==> 4. Disabling CodeQL default setup"
STATE=$(gh api "repos/${REPO}/code-scanning/default-setup" --jq '.state' 2>/dev/null || echo "not-configured")
if [ "$STATE" = "configured" ]; then
  if gh api "repos/${REPO}/code-scanning/default-setup" -X PATCH -f state=not-configured --jq '.state' 2>/dev/null; then
    echo "    default setup disabled"
  else
    echo "    WARNING: repo-level disable failed — the default setup is controlled by an"
    echo "    ORGANIZATION security configuration. An org admin must remove this repo from"
    echo "    the configuration (or detach the config) at:"
    echo "    https://github.com/organizations/Componode/settings/security_products"
    echo "    Until then, advanced-codeql SARIF uploads are REJECTED and CodeQL checks fail."
  fi
else
  echo "    default setup already in state '${STATE}' — nothing to do"
fi

echo
echo "Cutover settings applied. Remaining manual validation:"
echo "  - Open a trivial PR to develop and verify gates block/allow merge (quickstart.md scenario in specs/084-branch-release-strategy)"
echo "  - NOTE: merging the cutover PR itself will tag and publish v1.0.0 as the"
echo "    bootstrap baseline release — the repo has never been tagged before."
echo "    This is deliberate; see docs/branching-and-releasing.md."
