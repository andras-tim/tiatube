function main() {
    var config = getConfig(),

        /**
         * Static UI elements
         */
        sourceCollapse = $('#source-collapse'),
        videoInput = $('#url-id'),
        downloadAudioButton = $('#start-download-audio'),
        downloadVideoButton = $('#start-download-video'),

        downloadPanel = $('#download-panel'),
        stateDoneSpan = $('#status-done'),
        downloadCollapse = $('#download-collapse'),
        downloadOutput = $('#download-output'),

        statusRefreshTimer = null,

        /**
         * Download
         */
        initializePanels = function initializePanels() {
            sourceCollapse.on('show.bs.collapse', function () {
                downloadCollapse.collapse('hide');
            });

            sourceCollapse.on('hide.bs.collapse', function () {
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

        initializeVideoUrl = function initializeVideoUrl() {
            videoInput.val(getVideoIdFromUrl());
        },

        getVideoIdFromUrl = function getVideoIdFromUrl() {
            var hashSearch = $.deparam(window.location.hash.substring(1)),
                videoId = hashSearch['v'];

            return videoId === undefined ? '' : videoId;
        },

        getVideoId = function getVideoId(videoIdOrUrl) {
            return videoIdOrUrl.replace(/^.*\/(|.*[?&]v=)([^&=]+)(|&.*)$/, "$2");
        },

        initializeEventHandlers = function initializeEventHandlers() {
            var getEventHandler = function (downloadFormat) {
                return function () {
                    var stateDownloadingSpan = $('#status-downloading-' + downloadFormat),
                        videoId = getVideoId(videoInput.val());

                    window.location.hash = '#v=' + encodeURIComponent(videoId);

                    videoInput.val(videoId);
                    stateDownloadingSpan.removeClass('hide');
                    stateDoneSpan.addClass('hide');
                    sourceCollapse.collapse('hide');

                    downloadOutput.text('');
                    downloadVideo(videoId, downloadFormat, function () {
                        //$('#video-panel').collapse('show');
                        stateDoneSpan.removeClass('hide');
                        stateDownloadingSpan.addClass('hide');
                    });
                };
            };

            downloadAudioButton.click(getEventHandler('audio'));
            downloadVideoButton.click(getEventHandler('video'));
            videoInput.keypress(function (e) {
                if (e.keyCode === 13) {
                    getEventHandler('audio')();
                }
            });
        },

        downloadVideo = function downloadVideo(videoId, format, callback) {
            var htmlText,
                url = 'download.php?v=' + encodeURIComponent(videoId) + '&format=' + encodeURIComponent(format);

            if (statusRefreshTimer !== null) {
                clearTimeout(statusRefreshTimer);
            }

            $.ajax({
                url: url,
                cache: false,
                contentType: 'application/json'
            })
                .fail(function (jqXHR, textStatus, errorThrown) {
                    console.error(errorThrown, jqXHR.responseText);
                    alert('Unhandled error: ' + jqXHR.responseText);
                    callback();
                })
                .done(function (data) {
                    if (data['status-tail'] !== "") {
                        htmlText = String($('<div/>').text(data['status-tail']).html())
                            .replace(/\\n/g, "<br />");
                        downloadOutput.append(htmlText);
                        window.scrollTo(0, document.body.scrollHeight);
                    }
                    if (data['done'] === true) {
                        if (data['ret'] === 0) {
                            window.location.assign(url + '&dl=1');
                        } else {
                            alert('Download error');
                        }
                        callback();
                    } else {
                        statusRefreshTimer = setTimeout(function () {
                            downloadVideo(videoId, format, callback);
                        }, 1000);
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
    this.init = function init() {
        initializePanels();
        initializeVideoUrl();
        initializeEventHandlers();

        if (config.googleAnalytics.id && config.googleAnalytics.site && window.location.protocol !== "file:") {
            initializeGoogleAnalytics();
        }
    };

    return this;
}


main().init();
