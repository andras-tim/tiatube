<?php
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');

define("TIATUBE", sprintf('%s/tiatube.sh', realpath(dirname(dirname(__FILE__)))));

//decrease niceness
const BACKGROUND_COMMAND_NICE_LEVEL = 10;


function main()
{
    $video_id = get_parameter('v');
    validate_video_id($video_id);
    define('VIDEO_ID', $video_id);

    initialize_session();

    $download_format = get_parameter('format');
    validate_download_format($download_format);
    define('DOWNLOAD_FORMAT', $download_format);

    try
    {
        if (is_cache_valid())
        {
            if (isset($_GET['dl']))
            {
                stream_content();
                exit();
            }
        }
        else
        {
             if (isset($_GET['dl']))
            {
                http_response_code(405);
                exit('Video does not yet downloaded');
            }
            cleanup();
            start_download();
        }

        get_current_status();
        if (was_download_error())
        {
            cleanup();
        }
    }
    catch (Exception $e)
    {
        http_response_code(400);
        cleanup();
        exit(sprintf("Caught exception: %s\n", $e->getMessage()));
    }
}


function get_current_status()
{
    $status_tail = '';
    if ($_SESSION['dl'][VIDEO_ID]['done'] === false)
    {
        $running = is_session_process_running();

        $status_tail = file_get_contents($_SESSION['dl'][VIDEO_ID]['home'] . '/stderr', null, null, $_SESSION['dl'][VIDEO_ID]['status_last_pos']);
        $_SESSION['dl'][VIDEO_ID]['status_last_pos'] += strlen($status_tail);

        if (!$running)
        {
            $_SESSION['dl'][VIDEO_ID]['ret'] = intval(file_get_contents($_SESSION['dl'][VIDEO_ID]['home'] . '/ret'));
            $_SESSION['dl'][VIDEO_ID]['result_path'] = trim(file_get_contents($_SESSION['dl'][VIDEO_ID]['home'] . '/stdout'));
            $_SESSION['dl'][VIDEO_ID]['done'] = true;
        }
    }

    header('Content-Type: application/json');
    echo json_encode(
        array(
            'status-tail' => escape_newlines($status_tail),
            'ret' => $_SESSION['dl'][VIDEO_ID]['ret'],
            'done' => $_SESSION['dl'][VIDEO_ID]['done'],
        )
    );
}

function escape_newlines($text)
{
    return preg_replace('/\r?\n|\r|\n/', '\\n', $text);
}

function start_download()
{
    $home_dir = sprintf('%s/tiatube-%s-%s', sys_get_temp_dir(), VIDEO_ID, DOWNLOAD_FORMAT);
    rm_r($home_dir);
    mkdir($home_dir, 0770);

    $pid_file = $home_dir . '/pid';
    $ret_file = $home_dir . '/ret';
    $stdout_file = $home_dir . '/stdout';
    $stderr_file = $home_dir . '/stderr';

    $cmd = array('stdbuf', '-oL', TIATUBE, VIDEO_ID, DOWNLOAD_FORMAT);
    $env = array('HOME' => $home_dir);

    $_SESSION['dl'][VIDEO_ID]['format'] = DOWNLOAD_FORMAT;
    $_SESSION['dl'][VIDEO_ID]['status_last_pos'] = 0;
    $_SESSION['dl'][VIDEO_ID]['ret'] = 0;
    $_SESSION['dl'][VIDEO_ID]['result_path'] = '';
    $_SESSION['dl'][VIDEO_ID]['done'] = false;
    $_SESSION['dl'][VIDEO_ID]['home'] = $home_dir;
    $_SESSION['dl'][VIDEO_ID]['proc'] = TIATUBE;

    run_daemon($cmd, $pid_file, $ret_file, $stdout_file, $stderr_file, $home_dir, $env);
    sleep(1);

    $_SESSION['dl'][VIDEO_ID]['pid'] = intval(file_get_contents($pid_file));
}

function run_daemon(array $command, $pid_file, $ret_file, $stdout_file, $stderr_file, $cws = null, array $env = array())
{
    $bash_command = sprintf(
        '%s >%s 2>%s; echo $? >%s',
        escape_command($command),
        escapeshellarg($stdout_file),
        escapeshellarg($stderr_file),
        escapeshellarg($ret_file)
    );
    $wrapper_command = array(
        'start-stop-daemon',
        '--start',
        '--background',
        '--make-pidfile',
        '--pidfile',
        $pid_file,
        '--nicelevel',
        BACKGROUND_COMMAND_NICE_LEVEL,
        '--exec',
        '/bin/bash',
        '--',
        '-c',
        $bash_command
    );

    $ret = run($wrapper_command, $cws, $env);
    if ($ret !== 0)
    {
        file_put_contents($ret_file, sprintf('%d', $ret));
    }
}

function run(array $command, $cwd = null, array $env = array())
{
    $descriptor_spec = array(
        0 => array('pipe', 'r'),
        1 => array('pipe', 'w'),
        2 => array('pipe', 'w'),
    );

    $process = proc_open(escape_command($command), $descriptor_spec, $pipes, $cwd, $env);
    if (!is_resource($process))
    {
        return null;
    }

    fclose($pipes[0]);

    stream_get_contents($pipes[1]);
    fclose($pipes[1]);

    stream_get_contents($pipes[2]);
    fclose($pipes[2]);

    return proc_close($process);
}

function escape_command(array $command)
{
    return implode(
        ' ',
        array_map(static function ($arg) {
            return escapeshellarg($arg);
        }, $command)
    );
}

function stream_content()
{
    switch ($_SESSION['dl'][VIDEO_ID]['format'])
    {
        case 'audio':
            $content_type = 'audio/mpeg, audio/x-mpeg, audio/x-mpeg-3, audio/mpeg3';
            $extension = '.mp3';
            break;
        case 'video':
            $content_type = 'video/x-matroska';
            $extension = '.mkv';
            break;
        default:
            exit(sprintf('Unhandled format "%s"', $_SESSION['dl'][VIDEO_ID]['format']));
    }

    $file = get_path_of_first_file($_SESSION['dl'][VIDEO_ID]['result_path'], $extension);
    if (!$file)
    {
        http_response_code(404);
        exit(sprintf('Missing %s file', $extension));
    }

    header('Content-Type: ' . $content_type);
    header('Content-Transfer-Encoding: binary');
    header('Connection: Keep-Alive');
    header('Content-length: ' . filesize($file));
    header('X-Pad: avoid browser bug');

    if ($_GET['dl'] === '1')
    {
        header('Content-Description: File Transfer');
        header('Content-Disposition: attachment; filename="' . basename($file) . '"');
    }
    readfile($file);
    flush();

    cleanup();
}

function get_parameter($name)
{
    if (!isset($_GET[$name]))
    {
        http_response_code(400);
        exit(sprintf('Missing a non-optional parameter "%s"', $name));
    }

    return $_GET[$name];
}

function validate_video_id($video_id)
{
    if (preg_match('/[?&=]/', $video_id))
    {
        http_response_code(400);
        exit(sprintf('Bad video ID "%s"', $video_id));
    }
}

function validate_download_format($format)
{
    switch ($format)
    {
        case 'audio':
        case 'video':
            break;
        default:
            http_response_code(400);
            exit(sprintf('Bad download format "%s"', $format));
    }
}

function cleanup()
{
    if (!isset($_SESSION['dl'][VIDEO_ID]))
    {
        return;
    }

    if (is_session_process_running())
    {
        $session_id = posix_getsid($_SESSION['dl'][VIDEO_ID]['pid']);
        system(sprintf('pkill -s %d', $session_id));
    }

    if (isset($_SESSION['dl'][VIDEO_ID]['home']))
    {
        rm_r($_SESSION['dl'][VIDEO_ID]['home']);
    }

    if (isset($_SESSION['dl'][VIDEO_ID]['result_path']))
    {
        rm_r($_SESSION['dl'][VIDEO_ID]['result_path']);
    }

    unset($_SESSION['dl'][VIDEO_ID]);
}

function is_session_process_running()
{
    if (!isset($_SESSION['dl'][VIDEO_ID]['pid']))
    {
        return false;
    }

    $running = posix_getpgid($_SESSION['dl'][VIDEO_ID]['pid']);
    if (!$running)
    {
        return false;
    }

    $command_of_pid = get_command_by_pid($_SESSION['dl'][VIDEO_ID]['pid']);

    return stripos($command_of_pid, $_SESSION['dl'][VIDEO_ID]['proc']) !== false;
}

function get_command_by_pid($pid)
{
    return exec(sprintf('ps -p %d -o command=', $pid));
}

function rm_r($dir)
{
    if (!$dir || !is_dir($dir))
    {
        return false;
    }

    $objects = scandir($dir);
    foreach ($objects as $object)
    {
        if ($object === '.' || $object === '..')
        {
            continue;
        }

        if (filetype($dir . '/' . $object) === 'dir')
        {
            rm_r($dir . '/' . $object);
        }
        else
        {
            unlink($dir . '/' . $object);
        }
    }
    rmdir($dir);

    return true;
}

function get_path_of_first_file($dir, $extension)
{
    if (!is_dir($dir))
    {
        return false;
    }

    $objects = scandir($dir);
    foreach ($objects as $object)
    {
        if ($object === '.' || $object === '..' || !ends_with($object, $extension))
        {
            continue;
        }

        if (filetype($dir . '/' . $object) != 'dir')
        {
            return $dir . '/' . $object;
        }
    }

    return false;
}

function ends_with($haystack, $needle)
{
    return $needle === '' || substr($haystack, -strlen($needle)) === $needle;
}


if (!function_exists('http_response_code'))
{
    function http_response_code($code = null)
    {
        if ($code !== null)
        {
            switch ($code)
            {
                case 100:
                    $text = 'Continue';
                    break;
                case 101:
                    $text = 'Switching Protocols';
                    break;
                case 200:
                    $text = 'OK';
                    break;
                case 201:
                    $text = 'Created';
                    break;
                case 202:
                    $text = 'Accepted';
                    break;
                case 203:
                    $text = 'Non-Authoritative Information';
                    break;
                case 204:
                    $text = 'No Content';
                    break;
                case 205:
                    $text = 'Reset Content';
                    break;
                case 206:
                    $text = 'Partial Content';
                    break;
                case 300:
                    $text = 'Multiple Choices';
                    break;
                case 301:
                    $text = 'Moved Permanently';
                    break;
                case 302:
                    $text = 'Moved Temporarily';
                    break;
                case 303:
                    $text = 'See Other';
                    break;
                case 304:
                    $text = 'Not Modified';
                    break;
                case 305:
                    $text = 'Use Proxy';
                    break;
                case 400:
                    $text = 'Bad Request';
                    break;
                case 401:
                    $text = 'Unauthorized';
                    break;
                case 402:
                    $text = 'Payment Required';
                    break;
                case 403:
                    $text = 'Forbidden';
                    break;
                case 404:
                    $text = 'Not Found';
                    break;
                case 405:
                    $text = 'Method Not Allowed';
                    break;
                case 406:
                    $text = 'Not Acceptable';
                    break;
                case 407:
                    $text = 'Proxy Authentication Required';
                    break;
                case 408:
                    $text = 'Request Time-out';
                    break;
                case 409:
                    $text = 'Conflict';
                    break;
                case 410:
                    $text = 'Gone';
                    break;
                case 411:
                    $text = 'Length Required';
                    break;
                case 412:
                    $text = 'Precondition Failed';
                    break;
                case 413:
                    $text = 'Request Entity Too Large';
                    break;
                case 414:
                    $text = 'Request-URI Too Large';
                    break;
                case 415:
                    $text = 'Unsupported Media Type';
                    break;
                case 500:
                    $text = 'Internal Server Error';
                    break;
                case 501:
                    $text = 'Not Implemented';
                    break;
                case 502:
                    $text = 'Bad Gateway';
                    break;
                case 503:
                    $text = 'Service Unavailable';
                    break;
                case 504:
                    $text = 'Gateway Time-out';
                    break;
                case 505:
                    $text = 'HTTP Version not supported';
                    break;
                default:
                    exit(sprintf('Unknown http status code "%d"', $code));
            }
            $protocol = (isset($_SERVER['SERVER_PROTOCOL']) ? $_SERVER['SERVER_PROTOCOL'] : 'HTTP/1.0');
            header($protocol . ' ' . $code . ' ' . $text);
            $GLOBALS['http_response_code'] = $code;
        }
        else
        {
            $code = (isset($GLOBALS['http_response_code']) ? $GLOBALS['http_response_code'] : 200);
        }

        return $code;
    }
}

function is_cache_valid()
{
    if (!isset($_SESSION['dl'][VIDEO_ID]['format']))
    {
        return false;
    }

    if ($_SESSION['dl'][VIDEO_ID]['format'] !== DOWNLOAD_FORMAT)
    {
        return false;
    }

    if (was_download_error())
    {
        return false;
    }

    if (!$_SESSION['dl'][VIDEO_ID]['home'] || !is_dir($_SESSION['dl'][VIDEO_ID]['home']))
    {
        return false;
    }

    return true;
}

function was_download_error()
{
    return $_SESSION['dl'][VIDEO_ID]['done'] === true && $_SESSION['dl'][VIDEO_ID]['ret'] !== 0;
}

function initialize_session()
{
    session_start();

    if (!key_exists('dl', $_SESSION))
    {
        $_SESSION['dl'] = array();
    }

    if (!key_exists(VIDEO_ID, $_SESSION['dl']))
    {
        $_SESSION['dl'][VIDEO_ID] = array();
    }
}


main();
