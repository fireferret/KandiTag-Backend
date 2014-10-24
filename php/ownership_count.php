<?php

$hostname = 'localhost';
$username = $_POST['user'];
$password = $_POST['pw'];
$qrcodeid = $_POST['qrcodeid'];
$userid = $_POST['userid'];
$create_at = $_POST['create_at'];
$original_create_at = $_POST['original_create_at'];

//connect to database
$dbhandle = mysql_connect($hostname, $username, $password) or die("Unable to connect to MySQL");

$selected = mysql_select_db("kanditagDB", $dbhandle) or die("Could not select kanditagDB");

$result = mysql_query("SELECT * FROM kt_ownership WHERE qrcode_id = '$qrcodeid'");

$own = array();

while ($row = mysql_fetch_array($result)) {

$own[0] = $row['id'];
$own[1] = @" - ";


echo $own[0];
echo $own[1];

}

return $own;

//close the connection
mysql_close($dbhandle);

?>