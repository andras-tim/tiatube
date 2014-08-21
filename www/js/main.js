/*
 * tia @ 2014
 */
function main()
{
    /*
     * Download
     */
    function initialize_panels()
    {
        var video_panel = $('#video-panel');
        var download = $('#download');
        var download_panel = $('#download-panel');

        video_panel.on('show.bs.collapse', function () {
            download_panel.collapse('hide');
        });

        video_panel.on('hide.bs.collapse', function () {
            //download.show();
            download_panel.collapse('show');
        });

        download_panel.on('show.bs.collapse', function () {
            download.show();
        });
        download_panel.on('hidden.bs.collapse', function () {
            download.hide();
        });
    }

    function getVideoId(video_id_or_url)
    {
        return video_id_or_url.replace(/^.*\/(|.*[?&]v=)([^&=]+)(|&.*)$/, "$2");
    }

    function initialize_event_handlers()
    {
        var event_handler = function () {
            var video_id = getVideoId($('#video-id').val());
            $('#video-id').val(video_id);

            var btn = $(this);
            btn.button('loading');
            $('#download-output').text("");
            $('#video-panel').collapse('hide');

            download_video(video_id, function () {
                //$('#video-panel').collapse('show');
                btn.button('reset')
            });
        };

        $('#start-download').click(event_handler);
        $('#video-id').keypress(function (e) {
            if (e.keyCode === 13) {
                event_handler();
            }
        });
    }

    var download_timer;
    function download_video(video_id, callback)
    {
        download_timer = setTimeout(function () {
            download_video(video_id, callback);
        }, 2000);
        update_video_download_state(video_id, callback);
    }

    function update_video_download_state(video_id, callback)
    {
        $.ajax({
            url: 'download.php?v=' + encodeURIComponent(video_id),
            cache: false,
            contentType: 'application/json',
        })
        .fail(function(jqXHR, textStatus, errorThrown)
        {
            alert("Download error: " + textStatus);
            clearTimeout(download_timer);
            callback();
        })
        .done(function(data, textStatus, jqXHR)
        {
            if (data['status-tail'] != "")
            {
                var html_text = String($('<div/>').text(data['status-tail']).html())
                    .replace(/\\n/g, "<br />");
                $('#download-output').append(html_text);
                window.scrollTo(0, document.body.scrollHeight);
            }
            if (data['done'] == true)
            {
                clearTimeout(download_timer);
                if (data['ret'] == 0)
                    window.location.assign('download.php?v=' + video_id + '&dl=1');
                callback();
            }
        });
    }

    /*
     * Google Analytics
     */
    function initialize_google_analytics()
    {
        (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
        (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
        m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
        })(window,document,'script','//www.google-analytics.com/analytics.js','ga');

        ga('create','UA-30855365-1', 'dras.hu');
        ga('send', 'pageview');
    }

    /*
     * Initialize
     */
    this.initialize = function ()
    {
        /*$(document).ready(function() {
        });*/

        initialize_panels();
        initialize_event_handlers();

        if ("file:" != document.location.protocol)
        {
            initialize_google_analytics();
        }
    }

    return this;
}


main().initialize();
