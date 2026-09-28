#!/bin/sh
# Fails when the core names a launcher or asks a host for a function. A
# host sets each value through mvmz_core.h. The core must never reach up
# to a name that the host defines.
#
# Two things fail:
#   - The launcher names "empo" and "mkxp-ios" anywhere in the repo.
#   - A weak declaration or a weak import in src/. A weak name is how a
#     library calls a function that the host may define.
set -eu

cd "$(dirname "$0")/.."

status=0

if git grep -niIE '(^|[^[:alnum:]_])(empo|mkxp-ios)([^[:alnum:]_]|$)' -- . ':!scripts/check-no-host-code.sh'
then
    echo "error: the lines above name a launcher" >&2
    status=1
fi

if git grep -nE '__attribute__ *\(\( *weak|weak_import|#pragma weak' -- src
then
    echo "error: src/ has a weak name" >&2
    status=1
fi

exit "$status"
