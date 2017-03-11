/**
 * tia @ 2014
 */
function main() {
    var config = getConfig(),
        downloadTimer,

        /**
         * Static UI elements
         */
        videoCollapse = $('#video-collapse'),
        videoInput = $('#video-id'),
        downloadButton = $('#start-download'),

        downloadPanel = $('#download-panel'),
        downloadCollapse = $('#download-collapse'),
        downloadOutput = $('#download-output'),

        /**
         * Download
         */
        initializePanels = function initializePanels() {
            videoCollapse.on('show.bs.collapse', function () {
                downloadCollapse.collapse('hide');
            });

            videoCollapse.on('hide.bs.collapse', function () {
                //downloadPanel.show();
                downloadCollapse.collapse('show');
            });

            downloadCollapse.on('show.bs.collapse', function () {
                downloadPanel.show();
            });
            downloadCollapse.on('hidden.bs.collapse', function () {
                downloadPanel.hide();
            });
        },

        getVideoId = function getVideoId(videoIdOrUrl) {
            return videoIdOrUrl.replace(/^.*\/(|.*[?&]v=)([^&=]+)(|&.*)$/, "$2");
        },

        initializeEventHandlers = function initializeEventHandlers() {
            var eventHandler = function () {
                var videoId = getVideoId(videoInput.val());

                videoInput.val(videoId);
                downloadButton.button('loading');
                downloadOutput.text("");
                videoCollapse.collapse('hide');

                downloadVideo(videoId, function () {
                    //videoCollapse.collapse('show');
                    downloadButton.button('reset')
                });
            };

            downloadButton.click(eventHandler);
            videoInput.keypress(function (e) {
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
                        downloadOutput.append(htmlText);
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
