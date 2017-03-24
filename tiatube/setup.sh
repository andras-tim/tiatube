#!/bin/bash
set -euf -o pipefail

BASEDIR="$(dirname "$0")"
CONFIG="${CONFIG:-${BASEDIR}/www/js/config.js}"
DEFAULT_CONFIG="${BASEDIR}/www/js/config.default.js"

if [ ! -e "${CONFIG}" ]
then
    cp "${DEFAULT_CONFIG}" "${CONFIG}"
fi
