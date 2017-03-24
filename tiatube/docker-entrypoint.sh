#!/bin/bash
set -euf -o pipefail

BASEDIR="$(dirname "$0")"
CONFIG='/etc/tiatube/config.js' "${BASEDIR}/setup.sh"

php -S 0.0.0.0:80 -t "${BASEDIR}/www"
