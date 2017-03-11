/**
 * tia @ 2014
 */
function main() {
    var config = getConfig(),
        downloadTimer,

        /**
         * Download
         */
        initializePanels = function initializePanels() {
            var videoPanel = $('#video-panel'),
                download = $('#download'),
                downloadPanel = $('#download-panel');

            videoPanel.on('show.bs.collapse', function () {
                downloadPanel.collapse('hide');
            });

            videoPanel.on('hide.bs.collapse', function () {
                //download.show();
                downloadPanel.collapse('show');
            });

            downloadPanel.on('show.bs.collapse', function () {
                download.show();
            });
            downloadPanel.on('hidden.bs.collapse', function () {
                download.hide();
            });
        },

        getVideoId = function getVideoId(videoIdOrUrl) {
            return videoIdOrUrl.replace(/^.*\/(|.*[?&]v=)([^&=]+)(|&.*)$/, "$2");
        },

        initializeEventHandlers = function initializeEventHandlers() {
            var eventHandler = function () {
                var videoInput = $('#video-id'),
                    downloadButton = $('#start-download'),
                    videoId = getVideoId(videoInput.val());

                videoInput.val(videoId);
                downloadButton.button('loading');
                $('#download-output').text("");
                $('#video-panel').collapse('hide');

                downloadVideo(videoId, function () {
                    //$('#video-panel').collapse('show');
                    downloadButton.button('reset')
                });
            };

            $('#start-download').click(eventHandler);
            $('#video-id').keypress(function (e) {
                if (e.keyCode === 13) {
                    eventHandler();
                }
            });
        },

        downloadVideo = function downloadVideo(videoId, callback) {
            downloadTimer = setTimeout(function () {
                downloadVideo(videoId, callback);
            }, 2000);
            updateVideoDownloadState(videoId, callback);
        },

        updateVideoDownloadState = function updateVideoDownloadState(videoId, callback) {
            var htmlText,
                url = 'download.php?v=' + encodeURIComponent(videoId);

            $.ajax({
                url: url,
                cache: false,
                contentType: 'application/json'
            })
                .fail(function (jqXHR, textStatus, errorThrown) {
                    alert("Download error: " + textStatus);
                    clearTimeout(downloadTimer);
                    callback();
                })
                .done(function (data, textStatus, jqXHR) {
                    if (data['status-tail'] != "") {
                        htmlText = String($('<div/>').text(data['status-tail']).html())
                            .replace(/\\n/g, "<br />");
                        $('#download-output').append(htmlText);
                        window.scrollTo(0, document.body.scrollHeight);
                    }
                    if (data['done'] == true) {
                        clearTimeout(downloadTimer);
                        if (data['ret'] == 0) {
                            window.location.assign(url + '&dl=1');
                        }
                        callback();
                    }
                });
        },

        /**
         * Google Analytics
         */
        initializeGoogleAnalytics = function initializeGoogleAnalytics() {
            (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
            (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
            m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
            })(window,document,'script','//www.google-analytics.com/analytics.js','ga');

            ga('create', config.googleAnalytics.id, config.googleAnalytics.site);
            ga('send', 'pageview');
        };

    /**
     * Initialize
     */
    this.initialize = function () {
        initializePanels();
        initializeEventHandlers();

        if (config.googleAnalytics.id && config.googleAnalytics.site && window.location.protocol !== "file:") {
            initializeGoogleAnalytics();
        }
    };

    return this;
}


main().initialize();
