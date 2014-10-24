// web.js
var express = require("express");
var logfmt = require("logfmt");
var app = express();
var url = require('url');

mongojs = require("mongojs")

var mongoDbUri = "mongodb://nodejitsu:2aea94baf80fb1195c2285ed9f2a976a@troup.mongohq.com:10083/nodejitsudb9860264258";

app.use(logfmt.requestLogger());

app.get('/', function(req, res) {
  res.send('Hello World!!');
});

app.get('/login', function(req, res) {
  console.log ("/login\n")
  var query = req.query;

  var facebookid = query.facebookid; // the user's facebook id
  var username = query.username; // the user's name

  var collections = ["users", "tags"]
  var db = mongojs.connect(mongoDbUri , collections);

  db.users.save({facebookid: facebookid, username: username}, function(err, saved) {
    if( err || !saved ) console.log("User not saved");
    else console.log("User saved");
    console.log("saved user: " + username + " :facebookid:" + facebookid)

    res.setHeader('Content-Type', 'application/json');

    db.users.find({"facebookid": facebookid}, function(err, records) {
        j = records.length; // i should be 1 only since facebookid should be unique
        console.log("j is " + j);
        while (j--) {
          var user_id = records[j]._id;
          console.log("user id is **" + user_id);

          db.users.find({"_id": mongojs.ObjectId (user_id)}, function(err, records) {
            i = records.length;
            console.log("i is " + i)
            while (i--) {
              console.log ("found user with facebook id " + records[i].facebookid);
              res.end(JSON.stringify({user_id: user_id}), null, 3);
            }

          });
        }
    });
    res.end();
  });

});

app.get('/test', function(req, res) {
  console.log('HEADERS: ' + JSON.stringify(res.headers));
  var query = req.query;
  console.log('--------------------------------------');
  var resultStr = 'START:\n' 
           + ' app_id= ' + query.app_id + ' \n'
           + ' app_token= ' + query.app_token + ' \n'
           + ' app_name= ' + query.app_name + ' \n'
           + ' app_store= ' + query.app_store + ' \n'
           + ' tracker= ' + query.tracker + ' \n'
           + ' tracker_name= ' + query.tracker_name + ' \n'
           + ' fb_campaign_name= ' + query.fb_campaign_name + ' \n'
           + ' fb_campaign_id= ' + query.fb_campaign_id + ' \n'
           + ' fb_adgroup_name= ' + query.fb_adgroup_name + ' \n'
           + ' fb_adgroup_id= ' + query.fb_adgroup_id + ' \n'
           + ' network_name= ' + query.network_name + ' \n'
           + ' campaign_name= ' + query.campaign_name + ' \n'
           + ' adgroup_name= ' + query.adgroup_name + ' \n'
           + ' creative_name= ' + query.creative_name + ' \n'
           + ' is_iad= ' + query.is_iad + ' \n'
           + ' adid= ' + query.adid + ' \n'
           + ' idfa= ' + query.idfa + ' \n'
           + ' android_id= ' + query.android_id + ' \n'
           + ' mac_sha1= ' + query.mac_sha1 + ' \n'
           + ' mac_md5= ' + query.mac_md5 + ' \n'
           + ' idfa||android_id= ' + query.idfa_or_android_id + ' \n'
           + ' idfa_md5= ' + query.idfa_md5 + ' \n'
           + ' idfa_md5_hex= ' + query.idfa_md5_hex + ' \n'
           + ' idfa_upper= ' + query.idfa_upper + ' \n'
           + ' idfv= ' + query.idfv + ' \n'
           + ' gps_adid= ' + query.gps_adid + ' \n'
           + ' reftag= ' + query.reftag + ' \n'
           + ' ip_address= ' + query.ip_address + ' \n'
           + ' created_at= ' + query.created_at + ' \n'
           + ' click_time= ' + query.click_time + ' \n'
           + ' installed_at= ' + query.installed_at + ' \n'
           + ' country= ' + query.country + ' \n'
           + ' device_name= ' + query.device_name + ' \n'
           + ' os_name= ' + query.os_name + ' \n'
           + ' os_version= ' + query.os_version + ' \n'
           + ' session_count= ' + query.session_count + ' \n'
           + ' event= ' + query.event + ' \n'
           + ' revenue= ' + query.revenue + ' \n'
           + ' friend_code= ' + query.friend_code + ' \n'
           + ' END\n------------------------------------------------';

  res.send(resultStr);
  console.log(resultStr)
})


app.get('/db', function(req, res) {
  //res.writeHead(200, {"Content-Type": "text/html"});
  //res.send("db");

  var collections = ["users", "tags"]
  var db = mongojs.connect(mongoDbUri, collections);

  db.users.find({sex: "female"}, function(err, users) {
    if( err || !users) console.log("No female users found");
    else users.forEach( function(femaleUser) {
      console.log(femaleUser);
    });
  });

  db.users.save({email: "srirangan@gmail.com", password: "iLoveMongo", sex: "male"}, function(err, saved) {
    if( err || !saved ) console.log("User not saved");
    else console.log("User saved");
  });

  db.users.update({email: "srirangan@gmail.com"}, {$set: {password: "iReallyLoveMongo"}}, function(err, updated) {
    if( err || !updated ) console.log("User not updated");
    else console.log("User updated");
    res.send("UPDATED");
    res.end();
  });

  /*
  var uri = "mongodb://demo_user:demo_password@ds027769.mongolab.com:27769/demo_database",
  db = mongojs.connect(uri, ["demo_collection"]);

  db.demo_collection.find({"color": "red"}, function(err, records) {

    if(err) {
        console.log("There was an error executing the database query.");
        response.end();
        return;
    }


    var html = '<h2>Vehicles with a red finish</h2>',
        i = records.length;

    while(i--) {
        html += '<p><b>Name:</b> ' 
             + records[i].name 
             + ' <br /><b>Number of wheels:</b> ' 
             + records[i].wheels 
             + '<br /><b>Color: </b>' 
             + records[i].color;
    }

    res.write(html);
    res.end();
  });
  */

});

var port = Number(80);
app.listen(port, function() {
  console.log("Listening on " + port);
});
