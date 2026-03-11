#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

for tool in opencode; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

AGENT="${AGENT:-build}"
MODEL="${MODEL:-}"
VARIANT="${VARIANT:-minimal}"
MAX_PARALLEL="${MAX_PARALLEL:-1}"
SPAWN_DELAY_SECONDS="${SPAWN_DELAY_SECONDS:-2}"
DRY_RUN="${DRY_RUN:-0}"
WAIT_FOR_COMPLETION="${WAIT_FOR_COMPLETION:-1}"
WORKER_TIMEOUT_SECONDS="${WORKER_TIMEOUT_SECONDS:-1800}"

PROMPT_DIR="${PROMPT_DIR:-$REPO_ROOT/tmp/prompts/issue-alternatives}"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/tmp/issue-alternative-workers}"
REPORT_DIR="${REPORT_DIR:-$LOG_DIR/reports}"
SPAWN_LOG="$LOG_DIR/spawn.log"
PIDS_FILE="$LOG_DIR/pids.txt"

mkdir -p "$PROMPT_DIR" "$LOG_DIR" "$REPORT_DIR"
: > "$PIDS_FILE"

normalize_key() {
  local value="$1"
  echo "$value" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+//g'
}

slugify() {
  local value="$1"
  value="$(echo "$value" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
  if [[ -z "$value" ]]; then
    value="suggestion"
  fi
  echo "$value"
}

running_jobs() {
  jobs -pr | wc -l | tr -d ' '
}

build_prompt() {
  local issue_number="$1"
  local issue_url="$2"
  local suggestion="$3"
  local report_file="$4"

  local prompt
  prompt="$(cat <<'PROMPT_TEMPLATE'
You are working in this repository: __REPO_ROOT__

Task:
- Process alternative suggestion "__SUGGESTION__" from open issue #__ISSUE_NUMBER__:
  __ISSUE_URL__

Goal:
- Decide exactly one outcome:
  A) ACCEPT_INCLUDE_PENDING
  B) DENY
  C) US_VENDOR_ONLY

Mandatory workflow:
1) Read the full issue body and all comments first.
2) Read and apply:
   - DECISION_MATRIX.md
   - DENIED_ALTERNATIVES.md
3) Run duplicate checks against the MySQL database via the PHP API at /api/catalog/entries.php?status=alternative
   (all alternatives, US vendors, and denied entries live in the database, not in TypeScript files).
4) Do BIG web research before editing anything:
   - Use at least 4 sources.
   - Must include official website plus official docs/repo or legal/about page.
   - Include independent corroborating sources where relevant.
5) Do an internal 2-pass process:
   - Pass 1: Researcher (collect facts + proposed outcome)
   - Pass 2: Reviewer (challenge facts and decision)
   - If tooling does not support separate agents, emulate this with an explicit self-review section in your report.
6) Apply gateway checks G1-G8 and choose exactly one outcome:
   - ACCEPT_INCLUDE_PENDING:
     - All alternative data is stored in the MySQL database (table: catalog_entries, plus entry_categories, entry_tags, entry_replacements).
     - You cannot directly insert into the database from this worker. Instead, document the full entry details in your report (all fields: id/slug, name, description, country, category, replacesUS, pricing, isOpenSource, etc.) so it can be added to the database.
     - Add logo in public/logos/<id>.svg when feasible; if not feasible, document why.
     - Keep trust score pending only.
   - DENY:
     - Do not add the alternative to the database.
     - Explain the exact failing gateway criteria and cite sources.
   - US_VENDOR_ONLY:
     - Use this when the suggestion is not an eligible alternative but is a US product that should appear in replacements.
     - US vendors are stored as catalog_entries with status='us' in the MySQL database (same tables: catalog_entries, reservations, positive_signals, scoring_metadata). Document the vendor details in your report so it can be added to the database.
     - Do not add as an alternative entry in the database.
7) Trust-scoring constraints (hard rule):
   - Keep the result Trust Score Pending.
   - Do NOT add scoring metadata, positive signals, reservations, or vetted worksheets.
   - Scoring metadata, positive signals, and reservations are stored in the MySQL database — do NOT attempt to insert or modify them.
   - Do NOT create files in tmp/vetted/*.
8) Report verification (mandatory):
   - Verify your report contains all required fields for the proposed entry (see catalog_entries schema: slug, name, description, country_code, category, replacesUS, pricing, isOpenSource, etc.).
   - If a logo was added to public/logos/, verify the file exists.
   - If any required information could not be determined, mark outcome as FAILED (not ADDED) and explain why.
9) Save report to:
   __REPORT_FILE__
10) Commit rule:
   - If outcome is ACCEPT_INCLUDE_PENDING or US_VENDOR_ONLY and you added files (e.g. logo in public/logos/ or the report), create exactly one commit for this suggestion only.
   - The commit must include only files related to this single suggestion (logo/report), nothing unrelated.
   - Commit message: `add pending suggestion: <id> (issue #__ISSUE_NUMBER__)`
   - If outcome is DENY or FAILED, do not commit.

Batch-mode execution note:
- Do NOT run global repo validation commands (`npm run build`, `npm run lint`, `tsc`) in this worker.
- Focus only on the issue analysis, research, and targeted file edits/reporting.
- Do not perform broad refactors or formatting-only rewrites.

Report format:
- Issue and suggestion
- Decision (ACCEPT_INCLUDE_PENDING, DENY, or US_VENDOR_ONLY)
- Gateway check summary (G1-G8)
- Changed files
- Evidence links used
- Reviewer pass / validation notes
PROMPT_TEMPLATE
)"

  prompt="${prompt//__REPO_ROOT__/$REPO_ROOT}"
  prompt="${prompt//__SUGGESTION__/$suggestion}"
  prompt="${prompt//__ISSUE_NUMBER__/$issue_number}"
  prompt="${prompt//__ISSUE_URL__/$issue_url}"
  prompt="${prompt//__REPORT_FILE__/$report_file}"

  printf '%s\n' "$prompt"
}

# Snapshot date: 2026-03-11
# Source: unresolved alternative suggestions from currently open issues in
# TheMorpheus407/european-alternatives (duplicates already in the catalog excluded)
readarray -t RAW_SUGGESTIONS <<'EOF'
228|CalyxOS
229|iodéOS
230|AXP.OS
231|SHIFT OS Light
232|crDroid
233|ginlo Private
235|ViaMichelin
238|LuLu
239|Dokku
241|FreshRSS
244|Piper
244|Solaar
244|Input Remapper
245|dns.sb
246|AntennaPod
248|Saber
249|Mammouth AI
250|tokeneurope.ai
251|GNU Taler
253|fckaf.de Mail
257|Finanzfluss Copilot
258|Forge 4D
259|UpCloud
260|Lettermint
261|Ente Photos
262|Fairlytics
EOF

declare -A seen
declare -a SUGGESTIONS=()

for row in "${RAW_SUGGESTIONS[@]}"; do
  [[ -z "$row" ]] && continue
  IFS='|' read -r issue_number suggestion <<< "$row"
  if [[ -z "${issue_number:-}" || -z "${suggestion:-}" ]]; then
    continue
  fi
  key="$(normalize_key "$suggestion")"
  if [[ -n "${seen[$key]:-}" ]]; then
    continue
  fi
  seen[$key]="$issue_number"
  SUGGESTIONS+=("${issue_number}|${suggestion}")
done

total="${#SUGGESTIONS[@]}"
if [[ "$total" -eq 0 ]]; then
  echo "No suggestions to process."
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Spawning $total opencode workers (agent=$AGENT, max_parallel=$MAX_PARALLEL)" | tee -a "$SPAWN_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] wait_for_completion=$WAIT_FOR_COMPLETION timeout=${WORKER_TIMEOUT_SECONDS}s" | tee -a "$SPAWN_LOG"
if [[ "$WAIT_FOR_COMPLETION" == "1" && "$MAX_PARALLEL" -gt 1 ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: parallel writes to shared files may cause edit conflicts." | tee -a "$SPAWN_LOG"
fi

for idx in "${!SUGGESTIONS[@]}"; do
  display_index=$((idx + 1))
  IFS='|' read -r issue_number suggestion <<< "${SUGGESTIONS[$idx]}"
  issue_url="https://github.com/TheMorpheus407/european-alternatives/issues/${issue_number}"
  slug="$(slugify "$suggestion")"
  if [[ -z "$slug" ]]; then
    slug="issue-${issue_number}-${display_index}"
  fi

  prompt_file="$PROMPT_DIR/$(printf '%03d' "$display_index")-issue-${issue_number}-${slug}.txt"
  worker_log="$LOG_DIR/$(printf '%03d' "$display_index")-issue-${issue_number}-${slug}.log"
  report_file="$REPORT_DIR/issue-${issue_number}-${slug}.md"

  build_prompt "$issue_number" "$issue_url" "$suggestion" "$report_file" > "$prompt_file"

  echo "[$display_index/$total] #$issue_number -> $suggestion" | tee -a "$SPAWN_LOG"

  if [[ "$DRY_RUN" == "1" ]]; then
    continue
  fi

  if [[ "$WAIT_FOR_COMPLETION" == "1" ]]; then
    while (( $(running_jobs) >= MAX_PARALLEL )); do
      wait -n || true
    done
  fi

  cmd=(opencode run "$(cat "$prompt_file")" --dir "$REPO_ROOT" --title "issue-${issue_number}-${slug}" --agent "$AGENT")
  if [[ -n "$MODEL" ]]; then
    cmd+=(--model "$MODEL")
  fi
  if [[ -n "$VARIANT" ]]; then
    cmd+=(--variant "$VARIANT")
  fi

  (
    exit_code=0
    if timeout "$WORKER_TIMEOUT_SECONDS" "${cmd[@]}" >"$worker_log" 2>&1; then
      exit_code=0
    else
      exit_code=$?
    fi

    if [[ "$exit_code" -eq 124 ]]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] TIMEOUT #$issue_number -> $suggestion (${WORKER_TIMEOUT_SECONDS}s)" >> "$SPAWN_LOG"
    elif [[ "$exit_code" -eq 0 ]]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] DONE #$issue_number -> $suggestion (exit=0)" >> "$SPAWN_LOG"
    else
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAILED #$issue_number -> $suggestion (exit=$exit_code)" >> "$SPAWN_LOG"
    fi
  ) &
  pid=$!
  echo "$pid|$issue_number|$suggestion|$worker_log" >> "$PIDS_FILE"
  echo "  pid=$pid log=$worker_log" | tee -a "$SPAWN_LOG"
  sleep "$SPAWN_DELAY_SECONDS"
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run complete. No workers were started."
  exit 0
fi

if [[ "$WAIT_FOR_COMPLETION" != "1" ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Spawned all workers in fire-and-forget mode." | tee -a "$SPAWN_LOG"
  echo "PIDs: $PIDS_FILE"
  echo "Logs: $LOG_DIR"
  exit 0
fi

wait
echo "[$(date '+%Y-%m-%d %H:%M:%S')] All workers finished." | tee -a "$SPAWN_LOG"
