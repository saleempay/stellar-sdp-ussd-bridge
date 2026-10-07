#!/usr/bin/env sh
# Secret scan, run locally with `npm run secret-scan` and in CI on every
# pull request. It fails the build when:
#   1. any tracked file carries a Stellar secret seed shaped string
#      (S followed by 55 characters from the StrKey alphabet), or
#   2. a live sdp/.env is present and the public address of the host
#      distribution account or the SEP-10 signing account appears in any
#      tracked file. Those addresses are deployment specific and the house
#      rule is to mask accounts in documents and evidence.
# Check 2 is skipped with a note when sdp/.env is absent (the normal case
# in CI, where no secrets exist).
set -u

status=0

echo "check 1: secret seed shaped strings in tracked files"
if git grep -nIE '\bS[A-Z2-7]{55}\b' -- . ; then
  echo "FAIL: a Stellar secret seed shaped string is present in the tree"
  status=1
else
  echo "clean: no secret seed shaped string found"
fi

echo "check 2: host SDP account addresses in tracked files"
if [ -f sdp/.env ]; then
  for key in DISTRIBUTION_PUBLIC_KEY SEP10_SIGNING_PUBLIC_KEY; do
    value=$(sed -n "s/^${key}=//p" sdp/.env | tr -d '"' | tr -d "'" | tr -d '[:space:]')
    if [ -z "$value" ]; then
      echo "note: ${key} is empty in sdp/.env, nothing to check"
      continue
    fi
    if git grep -nF "$value" -- . ; then
      echo "FAIL: the ${key} address from sdp/.env appears in a tracked file"
      status=1
    else
      echo "clean: ${key} address not present in tracked files"
    fi
  done
else
  echo "note: sdp/.env not present, host account address check skipped"
fi

exit $status
