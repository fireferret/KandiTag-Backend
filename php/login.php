<?php
$hostname = "localhost";
$username = $_POST['user'];
$password = $_POST['pw'];
$parameter = $_POST['fbid'];
$parameter2 = $_POST['username'];

//connect to database
$dbhandle = mysql_connect($hostname, $username, $password) or die("Unable to connect to MySQL");
/* echo "Connected to MySQL<br>"; */

$selected = mysql_select_db("kanditagDB", $dbhandle) or die("Could not select kanditagDB");

//execute query
$insert = mysql_query("INSERT IGNORE INTO kt_user (fb_id, user_name) VALUES ('$parameter', '$parameter2')") or die("unable to insert user");

//execute query
$result = mysql_query("SELECT * FROM kt_user WHERE fb_id = $parameter");

$users = array();

//fetch the data
while ($row = mysql_fetch_array($result)) {

$users[0] = $row['id'];
$users[1] = @" - ";
$users[2] = $row['fb_id'];
$users[3] = @" - ";
$users[4] = $row['user_name'];

echo $users[0];
echo $users[1];
echo $users[2];
echo $users[3];
echo $users[4];

}

return $users;
	//close the connection
	mysql_close($dbhandle);

?>