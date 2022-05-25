<?php
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");

include_once 'version.php';

$WELCOMES = array(
    'Ahoy!',
    'Üdvözlet!',
    'Hali!',
    'Szia!',
    'Szeva!',
);
$welcome = $WELCOMES[array_rand($WELCOMES)];
?>
<!DOCTYPE html>
<html lang="hu-HU">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta name="description" content="tiaTube"/>
    <meta name="version" content="<?php echo(VERSION); ?>"/>
    <meta name="author" content="Andras Tim"/>
    <meta name="source" content="https://github.com/andras-tim/tiatube"/>

    <!-- Fav and touch icons -->
    <link rel="apple-touch-icon-precomposed" sizes="144x144" href="ico/apple-touch-icon-144-precomposed.png"/>
    <link rel="apple-touch-icon-precomposed" sizes="114x114" href="ico/apple-touch-icon-114-precomposed.png"/>
    <link rel="apple-touch-icon-precomposed" sizes="72x72" href="ico/apple-touch-icon-72-precomposed.png"/>
    <link rel="apple-touch-icon-precomposed" href="ico/apple-touch-icon-57-precomposed.png"/>
    <link rel="shortcut icon" href="ico/favicon.png"/>

    <title>tiaTube</title>

    <!-- vendor: Bootstrap core CSS -->
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css"
          integrity="sha384-BVYiiSIFeK1dGmJRAkycuHAHRg32OmUcww7on3RYdg4Va+PmSTsz/K68vbdEjh4u" crossorigin="anonymous">
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css"
          integrity="sha384-wvfXpqpZZVQGK6TAh5PVlGOfQNHSoD2xbE+QkPxCAFlNEevoEH3Sl0sibVcOQVnN" crossorigin="anonymous">

    <!-- HTML5 shim and Respond.js IE8 support of HTML5 elements and media queries -->
    <!--[if lt IE 9]>
    <script src="https://oss.maxcdn.com/libs/html5shiv/3.7.0/html5shiv.js"></script>
    <script src="https://oss.maxcdn.com/libs/respond.js/1.3.0/respond.min.js"></script>
    <![endif]-->

    <link href="css/main.css" rel="stylesheet"/>
</head>

<body role="document">

<!-- Fixed navbar -->
<div class="navbar navbar-inverse navbar-fixed-top" role="navigation">
    <div class="container">
        <div class="navbar-header">
            <a class="navbar-brand" href="https://github.com/andras-tim/tiatube">
                <span><img src="ico/apple-touch-icon-57-precomposed.png" alt="Logo"></span> tiaTube
            </a>
        </div>
    </div>
</div>

<div class="container" role="main">

    <!-- Main jumbotron for a primary marketing message or call to action -->
    <div class="jumbotron">
        <h1><?php echo htmlspecialchars($welcome, null, 'UTF-8'); ?></h1>
        <p>Ezzel az eszközzel könnyedén letöltheted kedvenc Youtube videóid hanganyagát MP3, vagy a komplett videót MKV
            formátumban, a lehető legjobb minőségben! Nem kell mást tenned, csak másold be a Youtube videód internet
            címét a lenti mezőbé, és kattints valamelyik letöltés gombra!</p>
    </div>


    <div class="panel panel-default">
        <div class="panel-heading">
            <a data-toggle="collapse" data-parent="#accordion" href="#source-collapse">
                <span class="panel-title">Forrás</span>
            </a>
        </div>
        <div class="panel-collapse collapse in" id="source-collapse">
            <div class="panel-body">

                <div class="input-group">
                    <span class="input-group-addon hidden-xs">youtube.com/watch?v=</span>
                    <input type="text" class="form-control" id="url-id" placeholder="Youtube URL vagy azonosító"
                           autocomplete="off" autofocus>
                    <span class="input-group-btn">
                <button type="button" class="btn btn-primary" id="start-download-audio" title="Hang letöltése"><i
                            class="fa fa-music" aria-hidden="true"></i></button>
                <button type="button" class="btn btn-success" id="start-download-video" title="Videó letöltése"><i
                            class="fa fa-video-camera" aria-hidden="true"></i></button>
              </span>
                </div>

            </div>
        </div>
    </div>

    <div class="panel panel-info" id="download-panel" style="display: none;">
        <div class="panel-heading">
          <span class="panel-title">
            <span id="status-downloading-audio" class="hide">Hanganyag beszerzése és átalakítása...</span>
            <span id="status-downloading-video" class="hide">Videó beszerzése...</span>
            <span id="status-done">Kész</span>
          </span>
        </div>
        <div id="download-collapse" class="panel-collapse collapse">
            <div class="panel-body">
                <pre id="download-output"></pre>
            </div>
        </div>
    </div>
</div>

<!-- JavaScript Libraries
================================================== -->
<!-- Placed at the end of the document so the pages load faster -->

<!-- vendor: jQuery and libs -->
<script src="https://code.jquery.com/jquery-3.1.1.min.js"
        integrity="sha256-hVVnYaiADRTO2PzUGmuLJr8BLUSjGIZsDYGmIJLv2b8=" crossorigin="anonymous"></script>
<script src="vendor/jquery-deparam/jquery-deparam.js"></script>

<!-- vendor: Bootstrap -->
<script src="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/js/bootstrap.min.js"
        integrity="sha384-Tc5IQib027qvyjSMfHjOMaLkfuWVxZxUPnCJA7l2mCWNIpG9mGCD8wGNIcPD7Txa"
        crossorigin="anonymous"></script>

<!-- Main -->
<script src="js/config.js?_v=<?php echo(VERSION); ?>"></script>
<script src="js/main.js?_v=<?php echo(VERSION); ?>"></script>
</body>
</html>
