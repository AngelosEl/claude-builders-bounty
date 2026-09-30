# WORKFLOW: n8n + Claude Code — Automated Weekly Dev Summary

A self-contained n8n workflow that runs weekly, gathers the week's git activity, and uses Claude Code (headless) to produce a structured developer summary, then posts it to a configurable destination (Slack, Discord, or a file/PR comment).

## Files

### 1. `workflows/weekly-dev-summary.json` (import into n8n)

```json
{
  "name": "Weekly Dev Summary (Claude Code)",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            { "field": "cronExpression", "expression": "0 9 * * 1" }
          ]
        }
      },
      "id": "schedule",
      "name": "Every Monday 09:00",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [220, 300]
    },
    {
      "parameters": {
        "command": "=bash scripts/collect-week.sh {{ $now.minus({days: 7}).toFormat('yyyy-MM-dd') }}"
      },
      "id": "collect",
      "name": "Collect Git Activity",
      "type": "n8n-nodes-base.executeCommand",
      "typeVersion": 1,
      "position": [460, 300]
    },
    {
      "parameters": {
        "command": "=claude -p \"$(cat scripts/prompt.md)\n\n=== RAW GIT LOG ===\n{{ $json.stdout }}\" --output-format text",
        "options": {}
      },
      "id": "summarize",
      "name": "Claude Code Summarize",
      "type": "n8n-nodes-base.executeCommand",
      "typeVersion": 1,
      "position": [700, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $env.SUMMARY_WEBHOOK_URL }}",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ text: $json.stdout }) }}",
        "options": {}
      },
      "id": "publish",
      "name": "Publish Summary",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [940, 300]
    }
  ],
  "connections": {
    "Every Monday 09:00": { "main": [[{ "node": "Collect Git Activity", "type": "main", "index": 0 }]] },
    "Collect Git Activity": { "main": [[{ "node": "Claude Code Summarize", "type": "main", "index": 0 }]] },
    "Claude Code Summarize": { "main": [[{ "node": "Publish Summary", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" },
  "versionId": "1.0.0"
}
```

### 2. `scripts/collect-week.sh` — gather the week's activity

```bash
#!/usr/bin/env bash
# Collect git activity since $1 (yyyy-mm-dd). Prints a compact raw log to stdout.
set -euo pipefail

SINCE="${1:-$(date -d '7 days ago' +%Y-%m-%d)}"

echo "## Commits since ${SINCE}"
git log --since="${SINCE}" --pretty=format:'%h|%an|%ad|%s' --date=short

echo ""
echo "## Files changed (numstat)"
git log --since="${SINCE}" --numstat --pretty=format:'' | awk 'NF==3 {add[$3]+=$1; del[$3]+=$2} END {for (f in add) printf "%s +%d -%d\n", f, add[f], del[f]}' | sort -k2 -nr | head -40

echo ""
echo "## Contributors"
git shortlog -sne --since="${SINCE}"

echo ""
echo "## Open PRs (requires gh)"
gh pr list --state open --limit 50 --json number,title,author,createdAt 2>/dev/null || echo "(gh not available)"
```

### 3. `scripts/prompt.md` — the Claude Code instruction

```markdown
You are a senior engineering lead writing a WEEKLY DEV SUMMARY for the team.

Input: a raw git log (commits, file churn, contributors, open PRs) below.

Produce a concise Markdown report with EXACTLY these sections:

## 🚀 Highlights
3–5 bullets of the most impactful changes (features, fixes, refactors). Group related commits.

## 📊 Activity
- Commits: <n>
- Contributors: <list>
- Files touched: <n>
- Top churn: <top 3 files>

## 🧭 Themes
2–3 bullets identifying patterns (e.g. "auth hardening", "perf work on the API layer").

## ⚠️ Risks / Follow-ups
Any large deletions, long-open PRs, or single-author hotspots worth attention.

## 🗓️ Next Week Focus
1–3 suggested priorities derived from the themes.

Rules:
- Be factual; never invent commits.
- Keep the whole report under 400 words.
- Use the contributor handles from the log.
```

### 4. `README.md` — setup

```markdown
# Weekly Dev Summary (n8n + Claude Code)

## Prerequisites
- n8n (self-hosted or cloud)
- `claude` CLI installed and authenticated (`npm i -g @anthropic-ai/claude-code`)
- `git`, `gh` (optional, for PR data)

## Setup
1. Import `workflows/weekly-dev-summary.json` into n8n.
2. Set env var `SUMMARY_WEBHOOK_URL` (Slack/Discord incoming webhook).
3. Ensure the workflow runs in a working directory that is a git checkout.
4. Adjust the cron in the Schedule node as desired (default: Mondays 09:00).

## Manual run
```bash
bash scripts/collect-week.sh 2026-03-20 | claude -p "$(cat scripts/prompt.md)"
```

## Customization
- Change the destination by editing the "Publish Summary" node.
- Swap Slack→Discord by setting `SUMMARY_WEBHOOK_URL` to a Discord webhook and
  changing the JSON body to `{ "content": "..." }`.
```

## Notes
- Zero external paid dependencies beyond Claude Code + n8n.
- Fully deterministic: same git history ⇒ same report structure.
- Failure-safe: if `gh` is absent the collector degrades gracefully.
