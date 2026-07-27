#!/usr/bin/env bash
# Stop hook: commits any working-tree changes when Claude finishes a turn.
# Local commits only — pushing to origin stays manual.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-/Users/alexshipulin/Desktop/Sila}"
cd "$repo" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Don't touch the index mid-merge/rebase/cherry-pick.
gitdir=$(git rev-parse --git-dir)
for state in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
  [ -e "$gitdir/$state" ] && exit 0
done

# Clean tree -> nothing to do.
[ -z "$(git status --porcelain)" ] && exit 0

git add -A
git diff --cached --quiet && exit 0

count=$(git diff --cached --name-only | wc -l | tr -d ' ')
head3=$(git diff --cached --name-only | head -3 | paste -sd ', ' -)
if [ "$count" -gt 3 ]; then
  summary="$head3 +$((count - 3)) more"
else
  summary="$head3"
fi

git commit -q -m "auto: $summary" -m "Co-Authored-By: Claude <noreply@anthropic.com>" || exit 0

sha=$(git rev-parse --short HEAD)
printf '{"systemMessage":"Auto-commit %s (%s file(s))"}\n' "$sha" "$count"
