#!/usr/bin/env bash
# oh-git-guard.sh — ObraHaus PreToolUse hook for the Bash tool (Claude Code).
#
# Policy (playbook §10): git/gh commands run AUTONOMOUSLY, EXCEPT operations
# whose target is a protected branch (main/master) or that rewrite shared
# history — those escalate to a human ("ask"; "deny" in bypassPermissions,
# where prompts may be suppressed).
#
# Decisions:
#   - "ask"  → human approval required (reason explains why)
#   - no output / exit 0 → no decision; permission rules + auto-mode classifier apply
#
# The hook never returns "allow": autonomy comes from the allow rules in
# settings.local.json; this script only ESCALATES. It is deterministic
# enforcement — the playbook text is advisory, this is the guard.
# Red-teamed 2026-07-11: quoted targets, $VAR/$( ) indirection, subshells,
# path-prefixed binaries, eval/sh -c/xargs wrappers, and backslash-newline
# continuations all escalate (fail closed).

set -u

PROTECTED='main|master'

PERM_MODE=""

ask() {
  local decision="ask"
  # In bypassPermissions prompts may be suppressed — fail closed to a hard deny.
  [ "$PERM_MODE" = "bypassPermissions" ] && decision="deny"
  jq -cn --arg d "$decision" --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}

INPUT="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  # Without jq we cannot parse tool input reliably; crude fail-safe grep.
  if printf '%s' "$INPUT" | grep -qE "git[^\"]*push[^\"]*(main|master)"; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"jq missing; command looks like a push to main/master"}}\n'
  fi
  exit 0
fi

CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
PERM_MODE="$(printf '%s' "$INPUT" | jq -r '.permission_mode // empty' 2>/dev/null)"
[ -z "$CMD" ] && exit 0
case "$CMD" in *git*|*gh*) ;; *) exit 0 ;; esac

# Join backslash-newline line continuations into one logical line.
CMD="${CMD//\\$'\n'/ }"

current_branch() { git -C "${1:-$CWD}" symbolic-ref --quiet --short HEAD 2>/dev/null || true; }
is_protected() { printf '%s' "$1" | grep -qxE "$PROTECTED"; }
# Strip quote characters (word-splitting via `read` keeps them attached).
dequote() { printf '%s' "${1//[\"\']/}"; }

guard_git() {
  # $@ = tokens after `git`
  local gdir="$CWD" tokens=("$@") i=0 sub=""
  # global flags: -C <path>, -c <cfg>, --git-dir=…, etc.
  while [ $i -lt ${#tokens[@]} ]; do
    case "${tokens[$i]}" in
      -C) gdir="$(dequote "${tokens[$((i+1))]:-$CWD}")"; i=$((i+2)) ;;
      -c|--exec-path|--work-tree|--namespace) i=$((i+2)) ;;
      --*=*|-*) i=$((i+1)) ;;
      *) sub="${tokens[$i]}"; i=$((i+1)); break ;;
    esac
  done
  [ -z "$sub" ] && return 0
  local rest=("${tokens[@]:$i}")

  case "$sub" in
    push)
      local nonflag=0 force=0 tok t
      for tok in ${rest[@]+"${rest[@]}"}; do
        case "$tok" in
          -f|--force|--force-with-lease|--force-with-lease=*|--force-if-includes)
            force=1; continue ;;
          --mirror|--all|--branches)
            ask "git push ${tok} can update main/master — needs human approval" ;;
          --delete|-d) continue ;;
          -*) continue ;;
        esac
        nonflag=$((nonflag+1))
        t="$(dequote "$tok")"
        case "$t" in
          *'$'*|*'`'*)
            ask "git push target '${tok}' is not statically resolvable (variable/substitution) — needs human approval" ;;
        esac
        t="${t#+}"
        case "$t" in
          main|master|refs/heads/main|refs/heads/master|:main|:master)
            ask "git push targets protected branch ('${tok}') — needs human approval" ;;
          *:main|*:master|*:refs/heads/main|*:refs/heads/master)
            ask "git push refspec targets protected branch ('${tok}') — needs human approval" ;;
        esac
      done
      [ $force -eq 1 ] && ask "force push (history rewrite) — needs human approval on any branch"
      if [ $nonflag -le 1 ]; then
        # bare `git push` / `git push <remote>` → pushes the CURRENT branch
        local br; br="$(current_branch "$gdir")"
        if [ -n "$br" ] && is_protected "$br"; then
          ask "bare 'git push' while on '${br}' — pushes a protected branch; needs human approval"
        fi
      fi
      ;;
    commit|merge|rebase|cherry-pick|revert|am|reset)
      local br; br="$(current_branch "$gdir")"
      if [ -n "$br" ] && is_protected "$br"; then
        ask "'git ${sub}' while checked out on protected branch '${br}' — needs human approval (work on a feature branch)"
      fi
      ;;
    branch)
      local tok t prev=""
      for tok in ${rest[@]+"${rest[@]}"}; do
        t="$(dequote "$tok")"
        if [ "$prev" = "-D" ] || [ "$prev" = "-d" ]; then
          is_protected "$t" && ask "deleting protected branch '${tok}' — needs human approval"
          case "$t" in *'$'*|*'`'*)
            ask "git branch delete target '${tok}' is not statically resolvable — needs human approval" ;;
          esac
        fi
        prev="$t"
      done
      ;;
  esac
  return 0
}

guard_gh() {
  # $@ = tokens after `gh`
  local a b
  a="$(dequote "${1:-}")"; b="$(dequote "${2:-}")"
  if [ "$a" = "pr" ] && [ "$b" = "merge" ]; then
    shift 2
    local sel="" tok
    for tok in "$@"; do case "$tok" in -*) : ;; *) sel="$(dequote "$tok")"; break ;; esac; done
    local base
    base="$(cd "$CWD" 2>/dev/null && gh pr view ${sel:+"$sel"} --json baseRefName --jq .baseRefName 2>/dev/null)" || base=""
    if [ -z "$base" ]; then
      ask "gh pr merge: could not resolve the PR's base branch — needs human approval"
    fi
    if is_protected "$base"; then
      ask "gh pr merge targets protected branch '${base}' — needs human approval"
    fi
    # base is a non-protected branch → enforce the CI gate (OH Defender) before autonomous merge
    ( cd "$CWD" 2>/dev/null && gh pr checks ${sel:+"$sel"} >/dev/null 2>&1 )
    local rc=$?
    if [ $rc -eq 8 ]; then
      ask "gh pr merge into '${base}': checks still PENDING — wait for green (OH Defender) or get approval"
    elif [ $rc -ne 0 ]; then
      ask "gh pr merge into '${base}': checks FAILING or none reported — resolve findings or get approval"
    fi
  elif [ "$a" = "repo" ] && [ "$b" = "delete" ]; then
    ask "gh repo delete — destructive; needs human approval"
  elif [ "$a" = "api" ]; then
    if printf '%s\n' "$*" | grep -qE 'git/refs/heads/(main|master)|pulls/[0-9]+/merge|/merges'; then
      ask "gh api call touches main/master refs or a merge endpoint — needs human approval"
    fi
  fi
  return 0
}

# Split compound commands on shell operators, subshells, and command groups,
# then analyze each fragment.
mapfile -t SUBS < <(printf '%s\n' "$CMD" | sed -E 's/\|\||&&|;|\||&|\(|\)|\{|\}/\n/g')

for SUB in "${SUBS[@]}"; do
  # trim leading whitespace
  SUB="${SUB#"${SUB%%[![:space:]]*}"}"
  [ -z "$SUB" ] && continue
  read -r -a TOK <<<"$SUB" || continue
  [ ${#TOK[@]} -eq 0 ] && continue

  # skip env assignments + process wrappers (with their immediate numeric/flag args)
  j=0
  while [ $j -lt ${#TOK[@]} ]; do
    case "${TOK[$j]}" in
      *=*) j=$((j+1)) ;;
      sudo|command|exec|nohup|time|nice|stdbuf|timeout|env)
        w="${TOK[$j]}"; j=$((j+1))
        # consume wrapper args: numbers (timeout 30), option flags (nice -n 5, stdbuf -oL)
        while [ $j -lt ${#TOK[@]} ]; do
          case "${TOK[$j]}" in [0-9]*|-*) j=$((j+1)) ;; *) break ;; esac
          [ "$w" = "timeout" ] || [ "$w" = "nice" ] || [ "$w" = "stdbuf" ] || break
        done
        ;;
      *) break ;;
    esac
  done
  [ $j -ge ${#TOK[@]} ] && continue

  # Normalize the program token: quotes, leading backslash, path prefix.
  PROG="$(dequote "${TOK[$j]}")"
  PROG="${PROG#\\}"
  PROG="${PROG##*/}"
  ARGS=("${TOK[@]:$((j+1))}")
  case "$PROG" in
    git) guard_git ${ARGS[@]+"${ARGS[@]}"} ;;
    gh)  guard_gh  ${ARGS[@]+"${ARGS[@]}"} ;;
    eval|sh|bash|zsh|dash|ksh|xargs)
      # Cannot inspect what the wrapper will run — fail closed if it mentions git/gh.
      if printf '%s ' ${ARGS[@]+"${ARGS[@]}"} | grep -qE "(^|[[:space:]\"'(=/])(git|gh)([[:space:]\"']|$)"; then
        ask "git/gh wrapped in '${PROG}' — cannot inspect the target branch; needs human approval"
      fi
      ;;
  esac
done

exit 0
