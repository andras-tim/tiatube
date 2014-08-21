#!/bin/bash
TMPDIR="/tmp/tiatube_$(date '+%Y%m%d-%H%M%S')_$$"

######
# FUNCTIONS
#
function quit()
{
    err=$1; shift

    [ -e "${TMPDIR}" ] && rm -rf "${TMPDIR}"
    [ $# -gt 0 ] && echo "$@" >&2
    exit $err
}

function YoutubeDl()
{
    youtube-dl --ignore-config -r 4M --no-playlist --format best --audio-format mp3 --audio-quality 0 "$@"
}

function tagMp3()
{
    eyeD3 --v2 --encoding=latin1 --no-config --no-color "$@"
}

function resizeImage()
{
    local image="$1"

    convert -resize 300x300 -gravity center -extent 300x300 -background black "${image}" "resized_${image}" || return $?
    mv "resized_${image}" "${image}"
}

function cleanupFilename()
{
    cat - |
        tr -d '\r\n' |
        iconv -f utf-8 -t 'ascii//translit' |
        tr '[:space:]' '_' |
        tr -cd '[:print:]' |
        sed -E 's>_+>_>g'
}

function main()
{
    if [ $# -lt 1 ]; then
        quit 1 "Missing YouTube Video URL/ID!"
    fi
    videoid="$1"
    mkdir -p "${TMPDIR}" || quit $? "Can not create TEMP dir ${TMPDIR}"
    cd "${TMPDIR}" || quit $? "Can not enter to TEMP dir ${TMPDIR}"

    echo '=== INFO ==='
    YoutubeDl --list-formats -- "${videoid}" || quit $? "Can not get info about video ${videoid}"


    echo -e '\n=== DOWNLOAD ==='
    echo "Selected format: $(YoutubeDl --get-format -- "${videoid}")" || quit $? "Can not getting formats of video ${videoid}"
    title="$(YoutubeDl -o '%(title)s [%(id)s]' --get-filename -- "${videoid}")" || quit $? "Can not getting title of video ${videoid}"
    filename="$(echo "${title}" | cleanupFilename)" || quit $? "Can not getting filename of video ${videoid}"
    echo -e "Filename: ${filename}\n"

    YoutubeDl --extract-audio --write-thumbnail -o "${filename}.%(ext)s" -- "${videoid}" || quit $? "Can not download video ${videoid}"


    echo -e '\n=== POST PROCESSING ==='
    mp3name="${filename}.mp3"
    imagename="${filename}.jpg"

    echo "Resize image"
    if [ -e "${imagename}" ]; then
        resizeImage "${imagename}"
        if [ -e "${mp3name}" ]; then
            tagMp3  --artist='YouTube' --title="${title}" --add-image="${imagename}:FRONT_COVER" --user-url-frame=":http\\://www.youtube.com/watch?v=${videoid}" -- "${mp3name}" || quit $? "Can not set META info for video ${videoid}"
        else
            echo "(skipped)"
        fi
        rm -- "${imagename}"
    else
        echo "(skipped)"
    fi

    echo -e "\nDONE!"
}

main "$@" >&2
echo "${TMPDIR}"
exit 0
