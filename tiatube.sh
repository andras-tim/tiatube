#!/bin/bash
set -euf -o pipefail

FFMPEG_PATH='/usr/local/bin/ffmpeg'
TMP_DIR="/tmp/tiatube_$(date '+%Y%m%d-%H%M%S')_$$"
DOWNLOAD_LIMIT='4M'


######
# FUNCTIONS
#
function print_step()
{
    local name="$1"
    local prefix="${2-\n\n}"

    echo -e "${prefix}=== ${name} ==="
}

function print_status()
{
    local status="$1"
    local prefix="${2-}"

    echo -e "${prefix}# ${status}"
}

function quit()
{
    local err="$1"; shift

    [[ -e "${TMP_DIR}" ]] && rm -rf "${TMP_DIR}"
    [[ $# -gt 0 ]] && echo "$@" >&2
    exit "${err}"
}

function youtube_dl()
{
    youtube-dl --ignore-config -r "${DOWNLOAD_LIMIT}" --no-playlist --restrict-filenames --prefer-ffmpeg --ffmpeg-location "${FFMPEG_PATH}" "$@"
}

function tag_mp3()
{
    eyeD3 --v2 --encoding=latin1 --no-config --no-color "$@"
}

function normalize_image()
{
    local src_image_name="$1"
    local dst_image_name="$2"

    "${FFMPEG_PATH}" -i "${src_image_name}" "converted_${dst_image_name}"

    convert -resize 300x300 -gravity center -extent 300x300 -background black -- "converted_${dst_image_name}" "${dst_image_name}" \
        || return $?

    rm -f -- "converted_${dst_image_name}"
}

function cleanup_title()
{
    tr -d '\r\n' \
        | iconv -f utf-8 -t 'latin1//translit' \
            | tr -cd '[:print:]' \
                | sed -E 's>^\s+>>;s>\s+$>>'
}

function cleanup_filename()
{
    tr ' \t?:/\\"' '_' \
        | sed -E 's>_+>_>g'
}

function main()
{
    if [[ $# -lt 1 ]]
    then
        quit 1 'Missing YouTube Video URL/ID!'
    fi
    local video_id="$1"
    local download_format="${2:-audio}"

    mkdir -p "${TMP_DIR}" \
        || quit $? "Can not create TEMP dir ${TMP_DIR}"
    cd "${TMP_DIR}" \
        || quit $? "Can not enter to TEMP dir ${TMP_DIR}"


    print_step 'INFO' ''
    youtube_dl --list-formats -- "${video_id}" \
        || quit $? "Can not get info about video ${video_id}"


    print_step 'DOWNLOAD'
    echo "Selected format: $(youtube_dl --get-format -- "${video_id}")" \
        || quit $? "Can not getting formats of video ${video_id}"

    local title
    title="$(youtube_dl -o '%(title)s [%(id)s]' --get-filename -- "${video_id}" | cleanup_title)" \
        || quit $? "Can not getting title of video ${video_id}"

    local filename
    filename="$(echo "${title}" | cleanup_filename)" \
        || quit $? "Can not getting filename of video ${video_id}"
    echo -e "Filename: '${filename}'\n"

    case "${download_format}" in
        audio)
            youtube_dl --format bestaudio --extract-audio --audio-format mp3 --audio-quality 0 --write-thumbnail -o "${filename}.%(ext)s" -- "${video_id}" \
                || quit $? "Can not download video ${video_id}"

            print_step 'POST PROCESSING'
            local tag_args
            tag_args=(
                --artist='YouTube'
                --title="${title}"
                --user-url-frame=":http\\://www.youtube.com/watch?v=${video_id}"
            )

            local src_image_name
            src_image_name="${filename}.jpg"
            if [ ! -e "${src_image_name}" ]; then
                src_image_name="${filename}.webp"
            fi
            local dst_image_name
            dst_image_name='front_cover.jpg'

            if [ -e "${src_image_name}" ]; then
                print_status 'Normalize image'
                if normalize_image "${src_image_name}" "${dst_image_name}"; then
                    tag_args+=(
                        "--add-image=${dst_image_name}:FRONT_COVER"
                    )
                else
                    echo '(skipped)'
                fi
            fi

            local mp3_name
            mp3_name="${filename}.mp3"

            if [[ -e "${mp3_name}" ]]; then
                print_status 'Write ID3 info'
                if ! tag_mp3 "${tag_args[@]}" -- "${mp3_name}"; then
                    echo '(skipped)'
                fi
            fi

            rm -f -- "${src_image_name}"
            rm -f -- "${dst_image_name}"
            ;;

        video)
            youtube_dl --format bestvideo+bestaudio --embed-subs --add-metadata --merge-output-format mkv -o "${filename}.%(ext)s" -- "${video_id}" \
                || quit $? "Can not download video ${video_id}"
            ;;

    esac

    print_status 'DONE!' '\n\n'
}

main "$@" >&2
echo "${TMP_DIR}"
exit 0
