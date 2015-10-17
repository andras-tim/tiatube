#!/bin/bash -e
BASEDIR="$(dirname "$0")"
CONFIG="${BASEDIR}/www/js/config.js"
DEFAULT_CONFIG="${BASEDIR}/www/js/config.default.js"

if [ ! -e "${CONFIG}" ]
then
    cp "${DEFAULT_CONFIG}" "${CONFIG}"
fi

apt-get install ffmpeg libmp3lame0
pip install --upgrade youtube_dl eyed3 iconv
