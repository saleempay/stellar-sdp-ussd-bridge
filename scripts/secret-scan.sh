#!/usr/bin/env sh
# Secret scan, run locally with `npm run secret-scan` and in CI on every
# pull request. It fails the build when:
#   1. any tracked file carries a Stellar secret seed shaped string
#      (S followed by 55 characters from the StrKey alphabet) or a PEM
#      private key header, or
#   1b. any line ADDED by the commits under review carries one of those.
#      The range is $SECRET_SCAN_BASE..HEAD, which CI sets to the pull
#      request base. A secret committed and deleted inside the same pull
#      request passes check 1 but stays in history; this check catches it.
#      Skipped with a note when no base is given or the base is not fetched
#      (CI checks out with fetch-depth 0, so the base is present there).
#   2. a live sdp/.env is present and the public address of the host
#      distribution account or the SEP-10 signing account appears in any
#      tracked file. Those addresses are deployment specific and the house
#      rule is to mask accounts in documents and evidence.
# Check 2 NEVER runs in CI: no sdp/.env exists there, so the masking rule
# is enforced only on a machine that holds a live sdp/.env.
# Binaries are skipped (-I in check 1, text diffs in check 1b): screenshots
# and other images are never scanned and remain a manual check.
# Matches are reported as file names, line numbers and counts only; the
# matching text itself is never printed.
set -u

status=0

seed='\bS[A-Z2-7]{55}\b'
# written in two parts so this script does not match its own pattern
pem='-----BEGIN [A-Z ]*PRIVATE KEY''-----'
pattern="($seed|$pem)"

echo "check 1: secret seed shaped strings and private key headers in tracked files"
hits=$(git grep -nIE "$pattern" -- . | cut -d: -f1,2)
if [ -n "$hits" ]; then
  echo "FAIL: a Stellar secret seed shaped string or a private key header is present in the tree at:"
  echo "$hits" | sed 's/^/  /'
  status=1
else
  echo "clean: no secret seed shaped string or private key header found"
fi

echo "check 1b: lines added by the commits under review"
base="${SECRET_SCAN_BASE:-}"
if [ -z "$base" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
  base="origin/${GITHUB_BASE_REF}"
fi
if [ -z "$base" ]; then
  echo "note: no base given (SECRET_SCAN_BASE or GITHUB_BASE_REF), added-line check skipped"
elif ! git rev-parse --verify --quiet "$base" >/dev/null 2>&1; then
  echo "note: base $base is not present in this clone, added-line check skipped"
else
  found=0
  for commit in $(git rev-list "$base..HEAD"); do
    count=$(git show --no-color --format= -p "$commit" -- . | grep -E '^\+' | grep -vE '^\+\+\+ ' | grep -cE "$pattern" || true)
    if [ "${count:-0}" -gt 0 ]; then
      echo "FAIL: commit $commit adds $count line(s) carrying a secret seed shaped string or a private key header"
      found=1
    fi
  done
  if [ "$found" -eq 1 ]; then
    status=1
  else
    echo "clean: no added line in $base..HEAD carries one"
  fi
fi

echo "check 2: host SDP account addresses in tracked files"
if [ -f sdp/.env ]; then
  for key in DISTRIBUTION_PUBLIC_KEY SEP10_SIGNING_PUBLIC_KEY; do
    value=$(sed -n "s/^${key}=//p" sdp/.env | tr -d '"' | tr -d "'" | tr -d '[:space:]')
    if [ -z "$value" ]; then
      echo "note: ${key} is empty in sdp/.env, nothing to check"
      continue
    fi
    if git grep -lF "$value" -- . ; then
      echo "FAIL: the ${key} address from sdp/.env appears in a tracked file (listed above)"
      status=1
    else
      echo "clean: ${key} address not present in tracked files"
    fi
  done
else
  echo "note: sdp/.env not present, host account address check skipped (it never runs in CI)"
fi

exit $status
