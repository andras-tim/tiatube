<?php
$cmd = "ping 127.0.0.1";

$descriptor_spec = array(
    0 => array("pipe", "r"),   // stdin is a pipe that the child will read from
    1 => array("pipe", "w"),   // stdout is a pipe that the child will write to
    2 => array("pipe", "w")    // stderr is a pipe that the child will write to
);

flush();
$process = proc_open($cmd, $descriptor_spec, $pipes, realpath('./'), array());
echo "<pre>";
if (is_resource($process))
{
    while ($s = fgets($pipes[1]))
    {
        print $s;
        flush();
    }
}
echo "</pre>";
