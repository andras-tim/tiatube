#!/bin/bash
set -euf -o pipefail

BASEDIR="$(dirname "$0")"
CONFIG="${BASEDIR}/www/js/config.js"
DEFAULT_CONFIG="${BASEDIR}/www/js/config.default.js"

if [ ! -e "${CONFIG}" ]
then
    cp "${DEFAULT_CONFIG}" "${CONFIG}"
fi

apt-get install ffmpeg libmp3lame0
pip install eyed3==0.8.12 iconv pathlib
pip install --upgrade youtube-dl
