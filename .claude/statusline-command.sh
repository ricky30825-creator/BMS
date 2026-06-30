#!/usr/bin/env bash

# Claude Code Status Line Script
# Displays: Model | Progress Bar | Rate Limits | Git Branch | Project Name

input=$(cat)

# --- ANSI Colors ---
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
BLUE='\033[34m'
GRAY='\033[90m'
RESET='\033[0m'

TOP_LINE="${GRAY}────────────────────────────────────────────────────────────────────────────────${RESET}"

# --- Model Name ---
model=$(echo "$input" | jq -r '.model.display_name // empty')

# --- Context Window ---
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# --- Rate Limits ---
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
week_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# --- Git Branch (from cwd) ---
cwd=$(echo "$input" | jq -r '.cwd // empty')
git_branch=""
if [ -n "$cwd" ]; then
  git_branch=$(git -C "$cwd" --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null)
fi

# --- Project Name (basename of project_dir or current_dir) ---
project_dir=$(echo "$input" | jq -r '.workspace.project_dir // .workspace.current_dir // empty')
project_name=""
if [ -n "$project_dir" ]; then
  project_name=$(basename "$project_dir")
fi

build_bar() {
  local pct="$1"

  if [ -z "$pct" ]; then
    printf "${GRAY}[----------]${RESET}"
    return
  fi

  local pct_int
  pct_int=$(printf "%.0f" "$pct")
  local filled=$(( pct_int / 10 ))
  local empty=$(( 10 - filled ))
  local bar=""
  local i

  for (( i=0; i<filled; i++ )); do bar+="#"; done
  for (( i=0; i<empty; i++ )); do bar+="-"; done

  printf "${GRAY}[%s]${RESET}" "$bar"
}

format_reset_time() {
  local epoch="$1"
  if [ -z "$epoch" ]; then return; fi

  local now
  now=$(date +%s)
  local diff=$(( epoch - now ))
  if [ "$diff" -le 0 ]; then
    echo "곧"
    return
  fi

  local h=$(( diff / 3600 ))
  local m=$(( (diff % 3600) / 60 ))
  if [ "$h" -gt 0 ]; then
    printf "%dh%02dm" "$h" "$m"
  else
    printf "%dm" "$m"
  fi
}

parts=()

if [ -n "$model" ]; then
  parts+=("$(printf "${CYAN}%s${RESET}" "$model")")
fi

if [ -n "$used_pct" ]; then
  parts+=("$(build_bar "$used_pct")")
else
  parts+=("$(build_bar "")")
fi

if [ -n "$five_pct" ] || [ -n "$week_pct" ]; then
  rate_str=""

  if [ -n "$five_pct" ]; then
    five_int=$(printf "%.0f" "$five_pct")
    if [ "$five_int" -ge 75 ]; then rc="$RED"
    elif [ "$five_int" -ge 50 ]; then rc="$YELLOW"
    else rc="$GREEN"; fi

    reset_str=$(format_reset_time "$five_reset")
    if [ -n "$reset_str" ]; then
      rate_str+="$(printf "5h:${rc}%d%%${RESET}${GRAY}(→%s)${RESET}" "$five_int" "$reset_str")"
    else
      rate_str+="$(printf "5h:${rc}%d%%${RESET}" "$five_int")"
    fi
  fi

  if [ -n "$week_pct" ]; then
    [ -n "$rate_str" ] && rate_str+=" "
    week_int=$(printf "%.0f" "$week_pct")
    if [ "$week_int" -ge 75 ]; then wc="$RED"
    elif [ "$week_int" -ge 50 ]; then wc="$YELLOW"
    else wc="$GREEN"; fi

    wreset_str=$(format_reset_time "$week_reset")
    if [ -n "$wreset_str" ]; then
      rate_str+="$(printf "7d:${wc}%d%%${RESET}${GRAY}(→%s)${RESET}" "$week_int" "$wreset_str")"
    else
      rate_str+="$(printf "7d:${wc}%d%%${RESET}" "$week_int")"
    fi
  fi

  parts+=("$rate_str")
fi

if [ -n "$git_branch" ] && [ "$git_branch" != "HEAD" ]; then
  parts+=("$(printf "${GREEN}%s${RESET}" "$git_branch")")
fi

if [ -n "$project_name" ]; then
  parts+=("$(printf "${BLUE}%s${RESET}" "$project_name")")
fi

result=""
for part in "${parts[@]}"; do
  if [ -z "$result" ]; then
    result="$part"
  else
    result="$result$(printf "${GRAY} | ${RESET}")$part"
  fi
done

printf "%b\n%b\n" "$TOP_LINE" "$result"
