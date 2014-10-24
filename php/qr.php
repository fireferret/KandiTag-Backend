<?php

$hostname = "localhost";
$username = $_POST['user'];
$password = $_POST['pw'];
$parameter = $_POST['qrcode'];
$parameter2 = $_POST['userid'];

//connect to database
$dbhandle = mysql_connect($hostname, $username, $password) or die("Unable to connect to MySQL");
/* echo "Connected to MySQL<br>"; */

$selected = mysql_select_db("kanditagDB", $dbhandle) or die("Could not select kanditagDB");

//execute query
$result = mysql_query("SELECT * FROM kt_qrcode WHERE code = '$parameter'");

$qrs = array();

//fetch the data
while ($row = mysql_fetch_array($result)) {

$qrs[0] = $row['id'];
$qrs[1] = @" - ";
$qrs[2] = $row['code'];
$qrs[3] = @" - ";
$qrs[4] = $row['user_id'];

echo $qrs[0];
echo $qrs[1];
echo $qrs[2];
echo $qrs[3];
echo $qrs[4];

}

if (empty($qrs[0])) {

$new = mysql_query("INSERT INTO kt_qrcode (code, user_id) VALUES ('$parameter', '$parameter2')");

//execute query
$newresult = mysql_query("SELECT * FROM kt_qrcode WHERE code = '$parameter'");

$newqr = array();

while ($row = mysql_fetch_array($newresult)) {

$newqr[0] = $row['id'];
$newqr[1] = @" - ";
$newqr[2] = $row['code'];
$newqr[3] = @" - ";
$newqr[4] = $row['user_id'];
$newqr[5] = @" - ";
$newqr[6] = @"new qr registered";

}

return $newqr;

} else {

return $qrs;

}
	//close the connection
	mysql_close($dbhandle);

?>