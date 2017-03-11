#!/bin/bash
TMP_DIR="/tmp/tiatube_$(date '+%Y%m%d-%H%M%S')_$$"


######
# FUNCTIONS
#
function quit()
{
    err="$1"; shift

    [[ -e "${TMP_DIR}" ]] && rm -rf "${TMP_DIR}"
    [[ $# -gt 0 ]] && echo "$@" >&2
    exit "${err}"
}

function youtube_dl()
{
    youtube-dl --ignore-config -r 4M --no-playlist --format best --audio-format mp3 --audio-quality 0 "$@"
}

function tag_mp3()
{
    eyeD3 --v2 --encoding=latin1 --no-config --no-color "$@"
}

function resize_image()
{
    local image="$1"

    convert -resize 300x300 -gravity center -extent 300x300 -background black "${image}" "resized_${image}" \
        || return $?
    mv "resized_${image}" "${image}"
}

function cleanup_filename()
{
    tr -d '\r\n' \
        | iconv -f utf-8 -t 'ascii//translit' \
            | tr '[:space:]' '_' \
                | tr -cd '[:print:]' \
                    | sed -E 's>_+>_>g'
}

function main()
{
    if [[ $# -lt 1 ]]
    then
        quit 1 'Missing YouTube Video URL/ID!'
    fi
    video_id="$1"

    mkdir -p "${TMP_DIR}" \
        || quit $? "Can not create TEMP dir ${TMP_DIR}"
    cd "${TMP_DIR}" \
        || quit $? "Can not enter to TEMP dir ${TMP_DIR}"


    echo '=== INFO ==='
    youtube_dl --list-formats -- "${video_id}" \
        || quit $? "Can not get info about video ${video_id}"


    echo -e '\n=== DOWNLOAD ==='
    echo "Selected format: $(youtube_dl --get-format -- "${video_id}")" \
        || quit $? "Can not getting formats of video ${video_id}"
    title="$(youtube_dl -o '%(title)s [%(id)s]' --get-filename -- "${video_id}")" \
        || quit $? "Can not getting title of video ${video_id}"
    filename="$(echo "${title}" | cleanup_filename)" \
        || quit $? "Can not getting filename of video ${video_id}"
    echo -e "Filename: ${filename}\n"

    youtube_dl --extract-audio --write-thumbnail -o "${filename}.%(ext)s" -- "${video_id}" \
        || quit $? "Can not download video ${video_id}"


    echo -e '\n=== POST PROCESSING ==='
    mp3_name="${filename}.mp3"
    image_name="${filename}.jpg"

    echo 'Resize image'
    if [[ -e "${image_name}" ]]
    then
        resize_image "${image_name}"
        if [[ -e "${mp3_name}" ]]
        then
            tag_mp3  --artist='YouTube' --title="${title}" --add-image="${image_name}:FRONT_COVER" --user-url-frame=":http\\://www.youtube.com/watch?v=${video_id}" -- "${mp3_name}" \
                || quit $? "Can not set META info for video ${video_id}"
        else
            echo '(skipped)'
        fi
        rm -- "${image_name}"
    else
        echo '(skipped)'
    fi

    echo -e '\nDONE!'
}

main "$@" >&2
echo "${TMP_DIR}"
exit 0
