// web.js
var express = require("express");
var logfmt = require("logfmt");
var app = express();
//var app = require('express')();
var url = require('url');
var bodyParser = require('body-parser');

//base64 encoder/decoder
var base64 = require('base-64'); // may not need this if window.atob() works

var apn = require('apn');
var gcm = require('node-gcm');

// mongojs = require("mongojs")
var mongojs = require("mongojs");
var gridjs = require('gridjs');
var fs = require('fs');

var mongoDbUri = "mongodb://nodejitsu:7099899734d1037edc30bc5b2a90ca84@troup.mongohq.com:10043/nodejitsudb1189483832";
var collections = ["kt_users", "kt_qrcode", "kt_ownership", "kt_message", "kt_group_message","kt_token", "kt_images", "kt_gifs", "kt_videos", "kt_profile_images", "kt_kanditags"];

//socket start ****************************************************************************************************

//users currently connected
// this will be used for messaging
var clients = {};
//users trying to download 
// this will be used for users trying to download and upload images/videos
var downloaders = {};
var uploaders = {};
//users looking through their feed
var feeders = {};
// users searching for tickets
var exchangers = {};
// users trying to register kanditags
var registers = {};
// users reopening their app in need to downloading old messages/data
var returning = {};


var http = require('http').Server(app);
var server = app.listen(3000);
var io = require('socket.io').listen(server);

io.on('connection', function (socket) {

  var userName;
  var userFBID;
  var userKTID;

  //console.log('a user connected:' + socket.id);
  var db = mongojs.connect(mongoDbUri, collections);

// this is the sign in for message
  socket.on('sign_in', function (kt_id) {
    clients[kt_id] = socket;
    socket.id = kt_id;
    console.log(kt_id,  " has connected");
    clients[kt_id].emit('sign_in', "you are connected");
  });

  socket.on('download_archived_group_messages', function (kt_id) {
  	if (!returning[kt_id]) {
  		returning[kt_id] = socket;
  		socket.id = kt_id;
  		console.log(kt_id, " is downloading archived group messages");
  	}

  	// query db for all group messages where from_id is kt_id
  	db.kt_group_message.find({from_id: kt_id}, function (err, records) {
  		if (err) {
  			console.log(err);
  			return;
  		}

  		if (records.length == 0) {
  			console.log("no records found");
  			returning[kt_id].emit("download_archived_group_messages", "no records found");
  			return;
  		}

  		// iterate over each row to get contents of each message
  		var recordsLength = records.length;
  		(function iterator(i) {
  			if (i < recordsLength) {
  				var message = records[i].message;
  				var to_kandi_id = records[i].to_kandi_id;
  				var to_kandi_name = records[i].to_kandi_name;
  				var timestamp = records[i].timestamp;
  				var from_name = records[i].from_name;
  				returning[kt_id].emit("download_archived_group_messages", {message: message, from_id: kt_id, from_name: from_name, to_kandi_id: to_kandi_id, to_kandi_name: to_kandi_name, timestamp: timestamp});
  				iterator(i+1);
  			}  			

  		})(0);


  	});


  	// query db for all group messages where kt_id is part of the kanditag group
  	db.kt_ownership.find({kt_id: kt_id}, function (err, records) {
  		if (err) {
  			console.log(err);
  			return;
  		}

  		if (records.length == 0) {
  			console.log("no records found");
  			returning[kt_id].emit("download_archived_group_messages", "no records found");
  		}

  		var recordsLength = records.length;
  		(function iterator(i) {
  			if (i < recordsLength) {
  				// get kandi_id
  				var kandi_id = records[i].kandi_id;
  				// using kandi_id query db for all group messages that are to_kandi_id
  				db.kt_group_message.find({to_kandi_id: kandi_id}, function (err, records) {
  					if (err) {
  						console.log(err);
  						return;
  					}

  					if (records.length == 0) {
  						console.log("no records found");
  						returning[kt_id].emit("download_archived_group_messages", "no records found");
  						return;
  					}

  					// now i have the rows where kandi_ids equals given kandi_ids
  					// iterate over each of the different kandi_ids to get all messages
  					(function nested_iterator(n) {
  						if (n < records.length) {
  							var message = records[n].message;
  							var from_id = records[n].from_id;
  							var from_name = records[n].from_name;
  							var timestamp = records[n].timestamp;
  							db.kt_kanditags.find({kandi_id: kandi_id}, function (err, records) {
  								if (err) {
  									console.log(err);
  									return;
  								}

  								// TODO
  								// it will be faster if i grab the kandi name before doing the nested iteration
  								var kandi_name = records[0].kandi_name;
  								returning[kt_id].emit("download_archived_group_messages", {message: message, from_id: from_id, from_name: from_name, to_kandi_id: kandi_id, to_kandi_name: kandi_name, timestamp: timestamp});
  							});
  							nested_iterator(n+1);
  						}
  					})(0);

  				});

  				iterator(i+1);
  			}  			

  		})(0);

  	});

  });

  socket.on('download_archived_messages', function (kt_id) {
  	if (!returning[kt_id]) {
  		returning[kt_id] = socket;
  		socket.id = kt_id;
  		console.log(kt_id, " is downloading archived messages");
  	}

  	// query the database for all messages that are either to or from given kt_id
  	db.kt_message.find({$or: [{to_id: kt_id}, {from_id: kt_id}]}, function (err, records) {
  		if (err) {
  			console.log(err);
  			return;
  		}

  		// if no records are found end socket connection
  		if (records.length == 0) {
  			console.log("no records found");
  			returning[kt_id].emit("download_archived_messages", "no records found");
  			socket.disconnect();
  		}

  		// run through all the records and emit messages to client, client will sort them by date upon receiving them
  		var recordsLength = records.length;
  		(function iterator(i) {
  			if (i < recordsLength) {
  				var message = records[i].message;
  				var to_id = records[i].to_id;
  				var from_id = records[i].from_id;
  				var to_name = records[i].to_name;
  				var from_name = records[i].from_name;
  				var timestamp = records[i].timestamp;
  				returning[kt_id].emit("download_archived_messages", {message: message, to_id: to_id, from_id: from_id, to_name: to_name, from_name: from_name, timestamp: timestamp});
  				// iterate
  				iterator(i+1);
  			}
  		})(0);

  		// will need a time out to disconnect the socket when this is all done

  	});
  });

	socket.on('add_kandi_name', function (kt_id, kandi_id, kandi_name) {
		if (!registers[kt_id]) {
			registers[kt_id] = socket;
			socket.id = kt_id;
			console.log(kt_id, " is naming their kanditag");
		}

		// query kt_kanditag and update the info
		db.kt_kanditags.update({kandi_id: kandi_id, kt_id: kt_id}, {$set: {"kandi_name": kandi_name}}, function (err) {
			if (err) {
				console.log(err);
				return;
			}

			registers[kt_id].emit("add_kandi_name", kandi_name + " has been saved");
			socket.disconnect();
		});

	});


	socket.on('display_kanditag', function (kt_id, kandi_id) {
		if (!registers[kt_id]) {
			registers[kt_id] = socket;
			socket.id = kt_id;
			console.log(kt_id, " is checking a KandiTag");
		}

		// query ownership for all users with kandi_id
		db.kt_ownership.find({kandi_id: kandi_id}, function (err, records) {
			if (err) {
				console.log(err);
				return;
			}

			// iterate through the users and emit them back to kt_id
			var recordsLength = records.length;
			var counter = 0;
			(function iterator(i) {
				if (i < recordsLength) {
					var user_id = records[i].kt_id;
					var placement = records[i].placement;
					db.kt_users.find({_id: mongojs.ObjectId(user_id)}, function (err, records) {
						var ktid = records[0]._id;
						var username = records[0].username;
						registers[kt_id].emit("display_kanditag", JSON.stringify({kt_id: ktid, username: username, kandi_id: kandi_id, placement: placement}));
						counter +=1;
						if (counter == recordsLength) {
							socket.disconnect();
						}
					});
					iterator(i+1);
				}
			})(0);
		});

	});


  socket.on('register_kanditag', function (kt_id, my_username, kandi_id) {
  	if (!registers[kt_id]) {
  		registers[kt_id] = socket;
  		socket.id = kt_id;
  		console.log(kt_id, " is registering a KandiTag");
  	}

  	var users = []; // array to hold kt_ids of all owners
  	var owned = false; // boolean to tell if user's id is already registered

  	// grab the name of the kanditag

  	// find every row in kt_ownership where kandi_id == param
  	db.kt_ownership.find({kandi_id: kandi_id}, function (err, records) {
  		if (err) {
  			console.log(err);
  			return;
  		}

  		// if no records are found, save the kandi_id into kt_kanditags under given kt_id
  		if (records.length == 0) {
  			db.kt_kanditags.save({kt_id: kt_id, kandi_id: kandi_id}, function (err, saved) {
  				if (err || !saved) {
  					console.log(err);
  					return;
  				}

  				// then save the kandi_id into kt_ownership with placement of 0
  				db.kt_ownership.save({kandi_id: kandi_id, kt_id: kt_id, placement: 0}, function (err, saved) {
  					if (err || !saved) {
  						console.log(err);
  						return;
  					}

  					// emit response to user and disconnect
  					registers[kt_id].emit("register_kanditag", "successfully registered new KandiTag");
  					console.log(kt_id, " successfully registered new KandiTag");
  					// if this is the recponse send the client should automatically make a call to add_kandi_name
  					socket.disconnect();

  				});
  			});
  			return;
  		}

  		// get count of how many users already own the kanditag when records are found
  		var user_count = records.length;
  		var kandi_name = "default name";

  		// add users into array
  		for (var i = 0; i < user_count; i++) {
  			var user = records[i].kt_id;
  			if (user == kt_id) {
  				owned = true;

  				// here I should emit the data for the other users for user to see
  				registers[kt_id].emit("register_kanditag", "cannot re-registered");
  				socket.disconnect();
  				return;
  			}
  			users.push(user);
  		}

  		// grab kandi name from kt_kanditags
  		db.kt_kanditags.find({kandi_id: kandi_id}, function (err, records) {
  			if (err) {
  				console.log(err);
  				return;
  			}

  			kandi_name = records[0].kandi_name;
  		});

  		// there can be up to 8 users on one kanditag, so make sure current count does not exceed 8
  		// also user cannot already be present in list
  		if (user_count < 8 && !owned) {

  			// save into kt_ownership with placement number
  			db.kt_ownership.save({kandi_id: kandi_id, kt_id: kt_id, placement: user_count}, function (err, saved) {
  				if (err || !saved) {
  					console.log(err);
  					return;
  				}

  				// push notifications for previous users
  				// here emit the user rows information back to user (to add these users as friends)
  				db.kt_ownership.find({kandi_id: kandi_id}, function (err, records) {
  					if (err) {
  						console.log(err);
  						return;
  					}

  				
  				for (var i = 0; i <= user_count; i++) {
  					var user_id = records[i].kt_id; // grab the kt_id from each of the rows

  					// do not send notification to self
  					if (kt_id != user_id) {
  						var query_id = user_id;

	  					// query kt_user with the kt_id to get the gcm/apn id
	  					db.kt_users.find({_id: mongojs.ObjectId(query_id)}, function (err, records) {
	  						if (err) {
	  							console.log(err);
	  							return;
	  						}

	  						// grab name of the user
	  						var username = records[0].username;
	  						//console.log(username);

	  						// emit both the kt_id, username and placement of each user back as result
	  						db.kt_ownership.find({kandi_id: kandi_id, kt_id: query_id}, function (err, records) {
	  							if (err) {
	  								console.log(err);
	  								return;
	  							}

	  							var placement = records[0].placement;
	  							registers[kt_id].emit("register_kanditag", JSON.stringify({kt_id: query_id, username: username, kandi_id: kandi_id, placement: placement}));

	  						});

	  						// here are the two push ids, one of them will be null for each user
	  						var gcm_id = records[0].gcm_id;
	  						var apn_id = records[0].apn_id;

	  						console.log(gcm_id);
	  						console.log(apn_id);

	  						// gcm push id
	  						if (gcm_id != null) {

	  							var notif = new gcm.Message({
	  								collapseKey: 'register_kanditag',
	  								delayWhileIdle: false,
	  								data: {
	  									kt_id: kt_id,
	  									username: my_username,
	  									kandi_name: kandi_name
	  								}
	  							});

	  							// will need to get the production key
	  							var push = new gcm.Sender('AIzaSyAv73kah7w3mlbQ7sVsvhaiIGfKtCH4OEU');
	  							push.send(notif, gcm_id, function (err, results) {
	  								if (err) {
	  									console.log(err);
	  									return;
	  								}

	  								console.log(results);
	  							});
	  						}



	  						if (apn_id != null) {
	  							console.log("need to set up apn push");
	  						}

	  					});
					}
  					
  				}

  				// emit resonse to user and disconnect
  				registers[kt_id].emit("register_kanditag", "successfully registered a KandiTag");
  				console.log(kt_id, " successfully registered a KandiTag");

  				});
  			});
  		} else {
  			console.log("kanditag has reached its registration limit");
  		}

  	});
  });

socket.on('download_archived_friends', function (kt_id, kandi_id) {
	if (!returning[kt_id]) {
		returning[kt_id] = socket;
		socket.id = kt_id;
		console.log(kt_id, " is downloading archived friends");
	}

	// query ownership where rows contain kandi_id
	db.kt_ownership.find({kandi_id: kandi_id}, function (err, records) {
		if (err) {
			console.log(err);
			return;
		}

		if (records.length == 0) {
			console.log("no records found");
			returning[kt_id].emit("download_archived_friends", "no records found for " + kandi_id);
			socket.disconnect();
		}

		var recordsLength = records.length;
		(function iterator(i) {
  			if (i < recordsLength) {
  				var placement = records[i].placement;
  				var user_id = records[i].kt_id;
  				// query kt_user for username
  				db.kt_users.find({kt_id: user_id}, function (err, records) {
  					if (err) {
  						console.log(err);
  						return;
  					}

  					var username = records[0].username;
  					returning[kt_id].emit("download_archived_friends", {kt_id: user_id, username: username, kandi_id: kandi_id, placement: placement});
  				});
  				iterator(i+1);
  			}  			

  		})(0);

	});
});

socket.on('download_archived_kanditags', function (kt_id) {
	if (!returning[kt_id]) {
		returning[kt_id] = socket;
		socket.id = kt_id;
		console.log(kt_id, " is downloading archived kanditags");
	}

	// query ownership where rows contain kt_id
	db.kt_ownership.find({kt_id: kt_id}, function (err, records) {
		if (err) {
			console.log(err);
			return;
		}

		// if no records found disconnect socket
		if (records.length == 0) {
			console.log("no records found");
			returning[kt_id].emit("download_archived_kanditags", "no records found");
			socket.disconnect();
		}

		var recordsLength = records.length;
		(function iterator(i) {
  			if (i < recordsLength) {
  				var kandi_id = records[i].kandi_id;
  				var placement = records[i].placement;
  				// query db for kandi_name
  				db.kt_kanditags.find({kandi_id: kandi_id}, function (err, records) {
  					if (err) {
  						console.log(err);
  						return;
  					}

  					var kandi_name = records[0].kandi_name;
  					returning[kt_id].emit("download_archived_kanditags", {kandi_id: kandi_id, kandi_name: kandi_name});
  				});
  				iterator(i+1);
  			}  			

  		})(0);

	});

});


  socket.on('upload_profile_image', function (kt_id, img) {
    if (!uploaders[kt_id]) {
      uploaders[kt_id] = socket;
      socket.id = kt_id;
      console.log(kt_id, " is attempting to upload_profile_image");
    }

    var gs = gridjs(db);

    gs.write(kt_id, new Buffer(img), function(err) {
      console.log('file is written', err);
      if (!err) {
        db.kt_profile_images.save({kt_id: kt_id}, function (err, saved) {
          if (err||!saved) {
            console.log(err); 
          } else {
            console.log("success");
          }
        });
      }
    });

  });

  socket.on('download_profile_image', function (kt_id) {
    if (!downloaders[kt_id]) {
      downloaders[kt_id] = socket;
      socket.id = kt_id;
      console.log(kt_id, " is attempting to download_images");
    }

    var gs = gridjs(db);

    //console.log('getting messages for: ', kt_id);
    db.kt_profile_images.find({kt_id: kt_id}, function (err, records) {
      if (err) {
        console.log(err);
      } else {
        if (records.length == 0) {
          console.log('no records found');
        } else {
          var user = records[0].kt_id;
          gs.read(user, function (err, buffer) {
              console.log('file is read', buffer);
              (downloaders[kt_id]).emit('download_profile_image', buffer);
            });
        }
      }
    });

  });

  socket.on('upload_image', function (kt_id, img, img_caption) {
    if (!uploaders[kt_id]) {
      uploaders[kt_id] = socket;
      socket.id = kt_id;
      console.log(kt_id, " is attempting to upload_image");
    }

   	console.log(img);
    var gs = gridjs(db);

    gs.write(img_caption, new Buffer(img), function(err) {
      if (err) {
      	console.log(err);
      	return;
      }

      db.collection('fs.files').find({"filename": img_caption}, function (err, records) {
            	if (err) {
            		console.log(err);
            		socket.disconnect();
            		return;
            	}

            	var found_id = records[0]._id;
            	console.log(found_id);

            	// got emmmm
            	db.collection('fs.files').update({_id: mongojs.ObjectId(found_id)}, {$set: {'metadata': {"user_id" : kt_id}}}, function (error) {
            		if (error) {
            			console.log(error);
            			return;
            		}

            		console.log("successfully added metadata");
            	});

            	console.log("found");
            	(uploaders[kt_id]).emit('upload_image', "saved into the db as " + found_id);
            	socket.disconnect();

            });
      
    });

  });

  socket.on('download_images', function (kt_id) {
    if (!downloaders[kt_id]) {
      downloaders[kt_id] = socket;
      socket.id = kt_id;
      console.log(kt_id, " is attempting to download_images");
    }

    var gs = gridjs(db);

    //console.log('getting messages for: ', kt_id);
    db.kt_images.find({kt_id: kt_id}, function (err, records) {
      if (err) {
        console.log(err);
      } else {
        if (records.length == 0) {
          console.log('no records found');
        } else {
          var recordsLength = records.length;
          for (i = 0; i < recordsLength; i++) {
            var img_caption = records[i].img_caption;
            console.log(img_caption);
            gs.read(img_caption, function (err, buffer) {
              console.log('file is read', buffer);
              (downloaders[kt_id]).emit('download_images', buffer);
            });
          }
        }
      }
    });

  });

  socket.on('test_download_my_own_feed', function (kt_id) {
  	if (!feeders[kt_id]) {
  		feeders[kt_id] = socket;
  		socket.id = kt_id;
  		console.log(kt_id, " is downloading their own feed");
  	}

  	var gs = gridjs(db);

  	db.collection('fs.files').find({'metadata': {'user_id': kt_id}}, function (err, records) {
  		if (err) {
  			console.log(err);
  			return;
  		}

  		var recordsLength = records.length;
  		(function iterator(i) {
  			if (i < recordsLength) {
  				var filename = records[i].filename;
  				var metadata = records[i].metadata;
  				var user_id = records[i].metadata.user_id;
  				console.log(filename);
  				console.log(metadata);
  				console.log(user_id);
  				gs.read(filename, function (err, buffer) {
  					console.log(buffer);
  					feeders[kt_id].emit('test_download_my_own_feed', buffer, user_id);
  				});
  				iterator(i+1);
  			}  			

  		})(0);

  		// disconnect definitely shouldnt be called when using a non blocking iterator
  		console.log("finished downloading own feed");
  		//socket.disconnect();

  	});
  });


  socket.on('download_feed', function (kt_id, kt_ids) {
  	if (!feeders[kt_id]) {
  		feeders[kt_id] = socket;
  		socket.id = kt_id;
  		console.log(kt_ids);
  		console.log(kt_id, " is downloading their feed");
  	}

  	var gs = gridjs(db);
  	var test_array = [1, 2, 3];
  	console.log(test_array);

  	// will need to refactor alot of this to become non-blocking

  	var ktids = [];
  	for (var i = 0; i < kt_ids.length; i++) {
  		ktids.push(kt_ids[i]);
  		console.log(kt_ids[i]);
  	}

  	ktids.forEach(function (ktid) {
  		console.log(ktid);
  		db.kt_images.find({kt_id: ktid}, function (err, records) {
  			if (err) {
  				console.log(err);
  				feeders[kt_id].emit('download_feed', err);
  				//socket.disconnect();
  				return;
  			}

  			if (records.length == 0) {
  				console.log('no records found');
  				feeders[kt_id].emit('download_feed', "no records");
  				//socket.disconnect();
  				return;
  			}

  			var recordsLength = records.length;
  			for (i = 0; i < recordsLength; i++) {
  				var img_cation = records[i].img_caption;
  				gs.read(img_caption, function (err, buffer) {
  					console.log('file read: ', buffer);
  					feeders[kt_id].emit('download_feed', buffer);
  				});
  			}
  		});
  	});
  	socket.disconnect();
  });


  socket.on('get_messages', function(ktid) {
    var userKTID = ktid;
    if (!clients[userKTID]) {
      clients[userKTID] = socket.id;
    }
    console.log("getting messages for " + userKTID);
    db.kt_message.find({tID: fbid, sent: false}, function(err, records) {
      if (err) {
        console.log("error getting unsent messages");
      } else {
        if (records.length == 0) {
          console.log("no unsent messages");
        } else {
          clients[userKTID] = socket;
          for (var i = 0; i < records.length; i++) {
            var results = records[i];
            var message = results.msg;
            var fID = results.fID;
            var tID = results.tID;
            var date = results.date;
            var _id = results._id;
            (clients[userKTID]).emit('get_messages', JSON.stringify([message, fID, tID, date]));
            db.kt_message.update({_id: _id}, { $set: { sent: true}});
          }
        }
      }
    });
  });

  /**

  socket.on('group_message', function (message, from_id, from_name, kandi_id, kandi_name) {
    var messageTimeStamp = Date.now();
    if (!clients[from_id]) clients[from_id] = socket.id;
    db.kt_groupmessage.save({message: message, from_id: from_id, from_name: from_name, kandi_id: kandi_id, kandi_name: kandi_name, timestamp: messageTimeStamp}, function (err, saved) {
    if (err||!saved) console.log("group_message: " + err);
    else {
    	db.kt_groupmessage.find({message: message, from_id: from_id, from_name: from_name, kandi_id: kandi_id, kandi_name: kandi_name, timestamp: messageTimeStamp}, function (err, rec) {
    if (err) console.log("group_message: " + err);
    else {
		db.kt_ownership.find({qrcode: kandi_id}, function (err, recs) {
		if (err) console.log("group_message: " + err);
		else {
			if (clients[from_id] != undefined) (clients[from_id]).emit('group_message', JSON.stringify({records: rec}), null, 3);
			else {
				console.log('group_message: error in emitting to self')
			}
				var results = [];
				var length = recs.length;
				for (var i = 0; i < length; i++) {
				    var user_ktid= recs[i]._id;
				    if (user_ktid != from_id) {
				        db.kt_users.find({_id: user_ktid}, function (err, records) {
				        	if (err) console.log("group_message: " + err);
							else {
				                if (clients[user_ktid] != undefined) {
				                      (clients[user_ktid]).emit('group_message', JSON.stringify({records: rec}), null, 3);
				                } else if (clients[user_ktid] == undefined) {
				                      var reg_id = records[0].gcm_id;
				                      var push_message = new gcm.Message({
				                        collapseKey: 'group_message',
				                        delayWhileIdle: false,
				                        data: {
				                          msg: message,
				                          from_id: from_id,
				                          from_name: from_name,
				                          // kandi_group changed to kandi_id
				                          kandi_id: kandi_id,
				                          kandi_name: kandi_name,
				                          time: messageTimeStamp
				                        }
				                      });
				                      var sender = new gcm.Sender('AIzaSyAv73kah7w3mlbQ7sVsvhaiIGfKtCH4OEU');
				                      sender.send(push_message, reg_id, function (err, results) {
				                        if (err) console.log(err);
				                        else console.log(results);
				                      });
				                    }
				                  }
				                });
				              }
            				}
          				}
        			});
      			}
      		});
      	}
    });
  });

**/

	socket.on('group_message', function (object) {
		var timestamp = Date.now();

		var message = object.message;
		var from_id = object.from_id;
		var from_name = object.from_name;
		var to_kandi_id = object.to_kandi_id;
		var to_kandi_name = object.to_kandi_name;

		if (!clients[from_id]) {
			clients[from_id] = socket.id;
		}

			// save message into db
			db.kt_group_message.save({message: message, from_id: from_id, from_name: from_name, to_kandi_id: to_kandi_id, to_kandi_name: to_kandi_name, timestamp: timestamp}, function (err, saved) {
				if (err || !saved) {
					console.log(err);
					return;
				}

				// query kt_ownership for every user where kandi_id : to_kandi_id
				db.kt_ownership.find({kandi_id: to_kandi_id}, function (err, records) {
					if (err) {
						console.log(err);
						return;
					}

					// grab kt_id's for each of the users
					// check if user is online
					// if online emit else notify

					var recordsLength = records.length;
					(function iterator(i) {
						if (i < recordsLength) {
							var kt_id = records[i].kt_id;
							if (clients[kt_id] != undefined) {
								// online
								clients[kt_id].emit("group_message", JSON.stringify({message: message, from_id: from_id, from_name: from_name, to_kandi_id: to_kandi_id, to_kandi_name: to_kandi_name, timestamp: timestamp}));
							} else if (clients[kt_id] == undefined) {
								// offline
								// query kt_users for gcm/apn id
								db.kt_users.find({_id: mongojs.ObjectId(kt_id)}, function (err, records) {
									if (err) {
										console.log(err);
										return;
									}

									var gcm_id = records[0].gcm_id;
									var apn_id = records[0].apn_id;

									if (gcm_id != null) {
										var notif = new gcm.Message({
											collapseKey: 'group_message',
											delayWhileIdle: false,
											data: {
												message: message,
												from_id: from_id,
												from_name: from_name,
												to_kandi_id: to_kandi_id,
												to_kandi_name: to_kandi_name,
												timestamp: timestamp
											}
										});
										var push = new gcm.Sender('AIzaSyAv73kah7w3mlbQ7sVsvhaiIGfKtCH4OEU');
										push.send(notif, gcm_id, function (err, result) {
											if (err) {
												console.log(err);
											}

											console.log(result);
										});
									}

									if (apn_id != null) {
										// TODO set up apn
									}

								});

							}

							iterator(i+1);
						}
					})(0);

					clients[from_id].emit("group_message", JSON.stringify({message: message, from_id: from_id, from_name: from_name, to_kandi_id: to_kandi_id, to_kandi_name: to_kandi_name, timestamp: timestamp}));


				});

			});

	});

	socket.on('message', function (object) {
		var timestamp = Date.now();

		var message = object.message;
		var from_id = object.from_id;
		var from_name = object.from_name;
		var to_id = object.to_id;
		var to_name = object.to_name;

		if (!clients[from_id]) {
			clients[from_id] = socket.id;
		}

		// save the message into the db
		db.kt_message.save({message: message, from_id: from_id, from_name: from_name, to_id: to_id, to_name: to_name, timestamp: timestamp}, function (err, saved) {
			if (err || !saved) {
				console.log(err);
				return;
			}

			// now find the saved message
			db.kt_message.find({message: message, from_id: from_id, from_name: from_name, to_id: to_id, to_name: to_name, timestamp: timestamp}, function (err, records) {
				if (err) {
					console.log(err);
					return;
				}

				// check if to_id user is online

				if (clients[to_id] != undefined) {
					// if online, emit message
					clients[from_id].emit('message', JSON.stringify({message: message, from_id: from_id, from_name: from_name, to_id: to_id, to_name: to_name, timestamp: timestamp}));
					clients[to_id].emit('message', JSON.stringify({message: message, from_id: from_id, from_name: from_name, to_id: to_id, to_name: to_name, timestamp: timestamp}));
				} else if (clients[to_id] == undefined) {
					// not online, emit to self and notify message
					clients[from_id].emit('message', JSON.stringify({message: message, from_id: from_id, from_name: from_name, to_id: to_id, to_name: to_name, timestamp: timestamp}));
					db.kt_users.find({_id: mongojs.ObjectId(to_id)}, function (err, records) {
						if (err) {
							console.log(err);
							return;
						}

						var gcm_id = records[0].gcm_id;
						var apn_id = records[0].apn_id;

						if (gcm_id != null) {
							var notif = new gcm.Message({
								collapseKey: 'message',
								delayWhileIdle: false,
								data: {
									message: message,
									from_id: from_id,
									from_name: from_name,
									to_id: to_id,
									to_name: to_name,
									timestamp: timestamp
								}
							});
							var push = new gcm.Sender('AIzaSyAv73kah7w3mlbQ7sVsvhaiIGfKtCH4OEU');
							push.send(notif, gcm_id, function (err, result) {
								if (err) {
									console.log(err);
								}

								console.log(result);
							});
						}

						if (apn_id != null) {
							// TODO set up
						}


					});
				}

			});

		});


	});

/**

  socket.on('message', function (message, from_id, from_name, to_id, to_name) {
    var messageTimeStamp = Date.now();
    if (!clients[from_id]) {
      clients[from_id] = socket.id;
    }

    //clients[recipientID] may still be online, make sure to disconnect from the socket when the screen is turned off
    if (clients[to_id] != undefined) {
      db.kt_message.save({message: message, to_id: to_id, from_id: from_id, to_name: to_name, from_name: from_name, timestamp: messageTimeStamp}, function(err, saved) {
        if (err) {
          console.log("recipient online but error saving message into database");
          //clients[senderID] = socket;
          (clients[from_id]).emit('message', "message failed to send");
        } else {
          console.log("recipient online and successfully saved message into database");
          db.kt_message.find({message: message, to_id: to_id, from_id: from_id, timestamp: messageTimeStamp}, function (err, records) {
            if (err) {
              console.log("error getting saved message from db");
            } else {
              (clients[from_id]).emit('message', JSON.stringify({records: records}));
              (clients[to_id]).emit('message', JSON.stringify({records: records}));
            }
          });
        }
      });
    } else if (clients[to_id] == undefined) {
      //save message and retry send
      db.kt_message.save({message: message, to_id: to_id, from_id: from_id, to_name: to_name, from_name: from_name, timestamp: messageTimeStamp}, function(err, saved) {
        if (err) {
          console.log("recipient offline and error saving message into database");
        //alert them that the message send failed
          (clients[from_id]).emit('message', "message failed to send");
        } else {
          console.log("recipient offline but successfully saved message into database");
          db.kt_message.find({message: message, to_id: to_id, from_id: from_id, timestamp: messageTimeStamp}, function (err, records) {
              if (err) {
                console.log("error getting saved message from db");
              } else {
                (clients[from_id]).emit('message', JSON.stringify({records: records}));
              }
          });

          db.kt_users.find({_id: to_id, username: to_name}, function (err, records) {
            if (err) {
              console.log("socket.on.message: error in finding user's token");
            } else {
              if (records.length == 0) {
                console.log("socket.on.message: error, no record of user in db");
              } else {
                var reg_id = records[0].gcm_id;
                var push_message = new gcm.Message({
                  collapseKey: 'message',
                  delayWhileIdle: false,
                  data: {
                    message: message,
                    from_id: from_id,
                    to_id: to_id,
                    from_name: from_name,
                    to_name: to_name,
                    timestamp: messageTimeStamp
                  }
                });
                var sender = new gcm.Sender('AIzaSyAv73kah7w3mlbQ7sVsvhaiIGfKtCH4OEU');
                sender.send(push_message, reg_id, function (err, result) {
                  if (err) console.log(err);
                  else console.log(result);
                });
              }
            }
          });
          //need to send message to sender
          //this isnt doing anything right now
          /**
          db.kt_message.find({fID: senderID}, function(err, records) {
            if (err) {
              console.log("error displaying unreceived messages");
            } else {
              if (records.length == 0) {
                console.log("no unreceived messages");
              } else {
                for (var i = 0; i < records.length; i++) {
                  console.log("attempting to send unreceived messages");
                  var results = records[i];
                  var message = results.msg;
                  var fID = results.fID;
                  var tID = results.tID;
                  var date = results.date;
                  var _id = results._id;
                  //clients[senderID] = socket;
                  //io.to(clients[senderID]).emit('privatemessage', JSON.stringify([message, fID, tID, date]));
                  //(clients[senderID]).emit('privatemessage', JSON.stringify([message, fID, tID, date]));

                  //so the broadcast works but private client does not
                  //io.emit('privatemessage', "broadcasting");
                }
              }
            }
          });
        }
      });
    }
  });

**/

  socket.on('setChat', function(fID, fname, tID, tname) {
    userName = fname;
    userKTID = fID;
    clients[userKTID] = socket.id;
    //console.log('chat between (' + fname + ') ' + fID + ' and (' + tname + ') ' + tID);
    console.log(userKTID + ' - ' + userName + ' has connected');
  db.kt_message.find({$or: [{fID: fID, tID: tID}, {fID: tID, tID: fID}]}, function(err, records) {
    if (err) {
      console.log("error in finding chat");
    } else {
      if (records.length == 0) {
        console.log("no chat records found");
      } else {
        console.log("chat found");
        //io.emit('setChat', 'chat found between ' + fname + ' and ' + tname);
        //io.emit('loadChat', records);
      }
    }
  });
    io.emit(fID + fname);
  });

  socket.on('pm', function(msg, fname, fID, tname, tID) {
    var userSocket = clients[tID];
    db.kt_message.save({msg: msg, fname: fname, fID: fID, tname: tname, tID: tID, date: Date.now()}, function(err, saved) {
      if (err) {
        console.log("error saving msg");
      } else {
        console.log("success saving msg");
      }
    });
    //console.log(fname + ' says ' + msg + ' to ' + tname);
    io.emit('pm', "HELLO:" + msg);
    io.userSocket.emit('pm', msg);
    //userSocket.emit(fname + ' says ' + msg + ' to ' + tname);
  });

  //socket.emit('join', socket['id']);
  //console.log(socket['id'] + ' has connected!');


  //socket.on('register', function(data) {
  //  clients[data.fbid] = socket.id;
  //});

  //socket.on('location', function (data) {
    //socket.emit('update', (socket['id'] + ':' + data));
    //console.log("data:" + data);
//});


  socket.on('disconnect', function () {

  	console.log( socket.id + " has has disconnected");
    // this function has no idea what userFBID is, so nothing is deleted
    //delete clients[userFBID];
    delete clients[socket.id];
    delete uploaders[socket.id];
    delete downloaders[socket.id];
    delete feeders[socket.id];
    delete exchangers[socket.id];
    delete registers[socket.id];
    delete returning[socket.id];
    //console.log(clients);
    //console.log(socket);
  });


//end of socket  
//need to set up time out just in case user doesnt disconnect
});



//socket end ****************************************************************************************************


/**

app.get('/', function(req, res) {
  //res.send('<h1>Hello World</h1>');
  res.sendFile(__dirname + '/index.html');
});

**/

app.use(logfmt.requestLogger());
app.use(bodyParser.json());


app.get('/', function(req, res) {
  res.send('404 page not found');
});

// get all images based on kt_id
app.post('/download_my_images', function (req, res) {
  console.log("download_my_images");
  var query = req.body;
  var kt_id = query.kt_id;
  console.log(kt_id);
  var db = mongojs.connect(mongoDbUri, collections);
  var gs = gridjs(db);

  db.kt_images.find({kt_id: kt_id}, function (err, records) {
    if (err) {
      console.log(err);
    } else {
      if (records.length == 0) {
        console.log("no images found for user");
        res.end("no images found for user");
      } else {
        var imgs = new Array();
        for (var i = 0; i < records.length; i++) {
          var img_caption = records[i].img_caption;
          var img = gs.read(img_caption, function (err, buffer) {
            console.log('file is read', buffer);
            imgs.push(img);
            //fs.createReadStream(img).pipe(res); // this doesnt work, file is too large
          });
        }
        res.end(JSON.stringify(imgs));
      }
    }
  });
});


// save images
app.post('/save_user_images', function (req, res) {
  var query = req.body;
  var kt_id = query.kt_id;
  var img = query.image;
  var img_caption = query.img_caption; // this will be the name of the img file and also a reference in the kt_images
  var tags = query.tags;
  console.log(kt_id);
  console.log(img);

  var db = mongojs.connect(mongoDbUri, collections);
  var gs = gridjs(db);
  //fs.createReadStream(img).pipe(gs.createWriteStream(img_caption));

/**
  gs.write(img_caption, new Buffer(img), function (err) {
    if (err) {
      console.log(err);
    } else {
      console.log("finished");
      db.kt_images.save({kt_id: kt_id, img_caption: img_caption, tags: tags}, function (err, saved) {
        if (err||!saved) {
          console.log(err);
        } else {
          console.log("saved into kt_images");
        }
      });
      res.end("finished");
    }
  });
**/

});


// save image
app.post('/save_user_image', function (req, res) {
  console.log("save_user_image called");
  var query = req.body;
  //var img = query.img; // this is the actual image received
  //Instead im going to try to decode the encoded img string back into an image
  //var img = base64.decode(query.img); // atob() is undefined..
  //var decodedImage = new Buffer(query.img, 'base64').toString('binary');

  var img = query.img;
  var img_caption = query.img_caption;
  var kt_id = query.kt_id; // id of the image owner
  var tags = query.tags;
  //console.log("kt_id: " + kt_id);
  var db = mongojs.connect(mongoDbUri, collections); // dont think it makes a difference as long as db is defined

  // getting the ENOENT error opening 'android.graphic.Bitmamp@...'
  // what does this mean? does it mean im trying to open the bitmap as a directory?
  // or does it mean i cant access the bitmap?

  //var db = mongojs(mongoDbUri);
  var gs = gridjs(db); // using a mongo instance

// maybe i need to use a write stream in java

/**
  var readStream = fs.createReadStream(img);
  var writeStream = gs.createWriteStream(img_caption);

  readStream.on('data', function (chunk) {
    writeStream.write(chunk);
    console.log("written");
  });

  readStream.pipe(writeStream);

**/

  // WORKING!!!
  // make sure to set aliases, metadata (upload data is done automatically)
  gs.write(img_caption, new Buffer(img),function (err) {
    console.log('file is written', err);
    if (!err) {
      db.kt_images.find({img_caption: img_caption}, function (err, records) {
        if (err) {
          console.log(err);
        } else {
          if (records.length == 0) {
            db.kt_images.save({kt_id: kt_id, img_caption: img_caption, tags: tags}, function (err, saved) {
              if (err||!saved) {
                console.log(err);
              } else {
                res.end("successfully saved image");
              }
            });
          }
        }
      });
    }
  });


});

app.post('/login', function(req, res) {
  var query = req.body;
  var facebookid = query.facebookid; // the user's facebook id
  var username = query.username; // the user's name
  //console.log("/login, facebookid is " + facebookid + " :: username is " + username);
  var db = mongojs.connect(mongoDbUri , collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_users.find({facebookid: facebookid, username: username}, function(err, records) {
    if (err) {
      //console.log ("/login, user couldn't be found");
      res.end(JSON.stringify({success: false}), null, 3);
    } else {
      if (records.length == 0) {
        // they weren't found in the db, so add them
        db.kt_users.save({facebookid: facebookid, username: username}, function(err, saved) {
          if( err || !saved ) {
            //console.log("User not saved");
            res.end(JSON.stringify({success: false}), null, 3);
          } else {
            //console.log("/login, New User saved");
            res.end(JSON.stringify({success: true, user_id: saved._id, username: username, facebookid: facebookid}), null, 3);
          }
        });
      } else {
        // there was a record of the user, just return their information (user_id)
        var user_id = records[0]._id;
        //console.log("/login, existing user, returning their user id " + user_id);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({success: true, user_id: user_id, username: username, facebookid: facebookid}), null, 3);
      }
    }
  });

});

app.post('/save_device_token_android', function (req, res) {
  var query = req.body;
  var kt_id = query.kt_id;
  var fb_id = query.fb_id;
  var token = query.token;
  var user_name = query.user_name;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_users.find({_id: mongojs.ObjectId(kt_id), facebookid: fb_id, username: user_name}, function (err, records) {
    if (err) {
      console.log("save_device_token: error in db query");
    } else {
      if (records.length == 0) {
        console.log("save_device_token: error, user (" + fb_id + ", " + user_name + ") does not exists in db");
      } else {
        db.kt_users.update({_id: mongojs.ObjectId(kt_id), facebookid: fb_id, username: user_name}, {_id: mongojs.ObjectId(kt_id), facebookid: fb_id, username: user_name, gcm_id: token}, function (err, saved) {
            if (err) {
              console.log("save_device_token: error in updating token");
            } else {
              res.end(JSON.stringify({success: true}), null, 3);
            }
        });
      }
    }
  });
});

app.post('/check_ktownership_for_me', function (req, res) {
  var query = req.body;
  var kt_id = query.kt_id;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({kt_id: kt_id}, function (err, records) {
    if (err) {
      console.log("check_ktownership_for_me: error in db query");
    } else {
      if (records.length == 0) {
        console.log("check_ktownership_for_me: no records for " + kt_id + " in kt_ownership");
      } else {
        res.end(JSON.stringify({success: true, records: records}), null, 3);
      }
    }
  });
});

app.post('/check_ktownership_for_user', function (req, res) {
  var query = req.body;
  var qrcode = query.qrcode;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({qrcode: qrcode}, function (err, records) {
    if (err) {
      console.log("check_ktownership_for_user: error in db query");
    } else {
      if (records.length == 0) {
        console.log("check_ktownership_for_user: no records");
      } else {
        res.end(JSON.stringify({success: true, records: records}), null, 3);
      }
    }
  });
});

app.post('/get_kandi_name_from_ktqrcode', function (req, res) {
  var query = req.body;
  var qrcode = query.qrcode;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_qrcode.find({qrcode: qrcode}, function (err, records) {
    if (err) {
      console.log("get_kandi_name_from_ktqrcode: error in db query");
    } else {
      if (records.length == 0) {
        console.log("get_kandi_name_from_ktqrcode: no records");
      } else {
        res.end(JSON.stringify({success: true, records: records}), null, 3);
      }
    }
  });
});

app.post('/download_messages', function (req, res) {
  var query = req.body;
  var kt_id = query.kt_id;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_message.find({$or: [{tID: kt_id}, {fID: kt_id}]}, function (err, records) {
    if (err) {
      console.log("download_messages: error in db query");
    } else {
      if (records.length == 0) {
        res.end(JSON.stringify({success: true}), null, 3);
      } else {
        res.end(JSON.stringify({success: true, records: records}), null, 3);
      }
    }
  });
});

app.post('/download_group_messages', function (req, res) {
  var query = req.body;
  var kt_id = query.kt_id;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_groupmessage.find({from_id: kt_id}, function (err, records) {
    if (err) {
      console.log("download_group_messages: error in db query");
    } else {
      if (records.length == 0) {
        console.log("download_group_messages: no records");
      } else {
        res.end(JSON.stringify({success: true, records: records}), null, 3);
      }
    }
  });
});

app.post('/getkandi', function (req, res) { 
  var query = req.body;
  var qrcode = query.qrcode;
  var db = monogjs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({qrcode: qrcode}, function (err, records) {
    if (err) {
      console.log("getkandi: error in getting records");
    } else {
      if (records.length == 0) {
        res.end(JSON.stringify({success: false, previous_user: false}), null, 3);
      } else {
        res.end(JSON.stringify({success: true, records: records}), null, 3);
      }
    }
  })
})

app.post('/follow', function(req, res) {
  var query = req.body;
  var userid  = query.userID;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.createCollection(userid + ':followers', function(err,collections) {
    if (err) throw err;

    //console.log("create collection " + userid);
    //console.log(collection);
  });

  db.createCollection(userid + ':following', function(err, collections) {
    if (err) throw err;
  });

});

app.post('/token', function(req, res) {
	//console.log("POST:/token");
	var query = req.body;
	var token = query.token;
	var facebookid = query.facebookid;
	var username = query.username;
	var badgenum = query.badgenum;
	var db = mongojs.connect(mongoDbUri, collections);

	res.setHeader('Content-Type', 'application/json');
	db.kt_token.find({facebookid: facebookid}, function(err, records) {
		if (err) {
			res.end(JSON.stringify({success: false}), null, 3);
		} else {
			if (records.length == 0) {
				db.kt_token.save({facebookid: facebookid, token: token, username: username, badgenum: badgenum}, function(err, saved) {
					if (err || !saved) {
						res.end(JSON.stringify({success: false}), null, 3);
					} else {
						res.end(JSON.stringify({success: true}), null, 3);
					}
				});
			} else {
				db.kt_token.update({facebookid: facebookid}, {facebookid: facebookid, token: token, username: username, badgenum: badgenum}, function(err, saved) {
					if (err || !saved) {
						res.end(JSON.stringify({success: false}), null, 3);
					} else {
						res.end(JSON.stringify({success: true}), null, 3);
					}
				});
			}
		}
	});
});


app.get('/kandi', function(req, res) {
  //console.log ("GET:/kandi");
  var query = req.body;
  var qrcode_id = query.qrcode_id;
  var user_id = query.user_id;
  var create_at = query.create_at;
  var original_create_at = query.original_create_at;
  var db = mongojs.connect(mongoDbUri , collections);

  db.kt_qrcode.find({"userId": userId}, function(err, records) {
    if (err) {
      //console.log(err);
      res.end();
    } else if (records.length > 0) {
      // todo ; send back kt_qrcode properties
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({user_id: user_id}), null, 3);
    }
  });

});

app.post('/qrcodes', function(req, res) {
  var query = req.body;
  var qrcode = query.qrcode;
  var user_id = query.user_id;
  var username = query.username;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_qrcodes.find({qrcode: qrcode}, function(err, records) {
    if (err) {
      console.log("error in finding qrcode");
    } else {
      if (records.length == 0) {
        db.kt_qrcodes.save({qrcode: qrcode, user_id: user_id, user_name: username}, function(err, saved) {
          if (err || !saved) {
            console.log("error in save");
          } else {
            res.end(JSON.stringify({success: true}), null, 3);
          }
        });
      }
      else {
        var userID = records[0].user_id;
          if (userID == user_id) {
            res.end(JSON.stringify({success: false, already_owned: true}), null, 3);
          }
          else {
            db.kt_follow.find({qrcode: qrcode}, function(err, records) {
              if (err) {
                console.log("error in kt_follow finding");
              } else {
                if (records.length == 0) {
                  db.kt_follow.save({qrcode: qrcode, user_id: user_id, user_name: username}, function(err, saved) {
                    if (err || !saved) {
                      console.log("error in saving to following");
                    } else {
                      res.end(JSON.stringify({success: true}), null, 3);
                    }
                  });
                } else {
                  res.end(JSON.stringify({success: false, already_owned: true}), null, 3);
                }
              }
            });
        }
      }
    }
  });

});

app.post('/kt_ownership_findall', function (req, res) {
  var query = req.body;
  var qrcode = query.qrcode;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({qrcode: qrcode}, function (err, records) {
    if (err) {
      console.log("kt_ownership_findall: error in query");
    } else {
      if (records.length == 0) {
        console.log("kt_ownership_findall: query found nothing");
      } else {
        res.end(JSON.stringify({success: true, records: records}), null, 3);
      }
    }
  });
});

app.post('/kt_ownership_finduser', function (req, res) {
  var query = req.body;
  var qrcode = query.qrcode;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({qrcode: qrcode}, function(err,records) {
    if (err) {
      console.log("kt_ownership_finduser: error in query");
    } else {
      if (records.length == 0) {
        res.end(JSON.stringify({success: false, previous_user: false}), null, 3);
      } else {
        var ownerCount = records.length;
        var results = [];
        res.end(JSON.stringify({success: true, previous_user: true, previous_userCount: ownerCount, records: records}), null, 3);
      }
    }
  });
});

app.post('/kt_qrcode_save', function(req, res) {
  var query = req.body;
  var qrcode = query.qrcode;
  var kt_id = query.kt_id;
  var fb_id = query.fb_id;
  var username = query.username;
  var kandi_name = query.kandi_name;

  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_qrcode.find({qrcode: qrcode}, function(err, records) {
    if (err) {
      console.log("kt_qrcode_save: error querying database");
    } else {
      if (records.length == 0) {
        db.kt_qrcode.save({qrcode: qrcode, kt_id: kt_id, fb_id: fb_id, username: username, kandi_name: kandi_name}, function (err, saved) {
          if (err || !saved) {
            console.log("kt_qrcode_save: error saving qrcode into kt_qrcode");
          } else {
            db.kt_ownership.save({qrcode: qrcode, kt_id: kt_id, fb_id: fb_id, username: username, placement: 0}, function (err, saved) {
              if (err || !saved) {
                console.log("kt_qrcode_save: error saving qrcode into kt_ownership");
              } else {
                res.end(JSON.stringify({success: true, qrcode: qrcode, kt_id: kt_id, fb_id: fb_id, username: username, placement: 0, kandi_name: kandi_name}), null, 3);
              }
            });
          }
        });
      } else {
        var existingQrCode = records[0];
        db.kt_ownership.find({qrcode: existingQrCode.qrcode}, function (err, records) {
          if (err) {
            console.log("kt_qrcode_save: qrcode exists in kt_qrcode, but query in kt_ownership failed");
          } else {
            var ownerCount = records.length;
            if (ownerCount >= 8) {
              console.log("kt_qrcode_save: qrcode cannot hold anymore users, new user will not be saved");
            }  else {
              db.kt_ownership.save({qrcode: existingQrCode.qrcode, kt_id: kt_id, fb_id: fb_id, username: username, placement: ownerCount}, function (err, saved) {
                if (err||!saved) {
                  console.log("kt_qrcode_save: error saving new user into kt_ownership");
                } else {
                  db.kt_ownership.find({qrcode: existingQrCode.qrcode}, function (err, records) {
                      if (err) {
                        console.log("kt_qrcode_save: error sending results back");
                      } else {
                        var results = [];
                        var length = records.length;
                        findPushIdSeries (0, length, records, db, results, function() {});
                        res.end(JSON.stringify({success: true, records: records}), null, 3);
                      }
                  });
                  //res.end(JSON.stringify({success: true, qrcode: existingQrCode.qrcode, kt_id: kt_id, fb_id: fb_id, username: username, placement: ownerCount}), null, 3);
                }
              });
            }
          }
        });
      }
    }
  });
}); 

function findPushIdSeries (currentIndex, recordsLength, records, db, results, callback) {
  if (currentIndex < recordsLength) {
    item = records[currentIndex];
    if (item) {
      findPushId (item, db, function (result) {
        results.push(result);
        currentIndex = currentIndex + 1;
        findPushIdSeries (currentIndex, recordsLength, records, db, results, callback);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
}

function findPushId (item, db, callback) {
  if (!item)
    return;

  db.kt_users.find({_id: mongojs.ObjectId(item.kt_id)}, function (err, docs) {
    if (err)
      return;

    var length = docs.length;
    for (var i = 0; i < length - 1; i++) {
      var user = docs[i];
      var pushId = user.gcm_id;
      var push_message = new gcm.Message({
        collapseKey: 'kandi',
        delayWhileIdle: false,
        data: {
          //maybe use "(groupName) welcomes (username)"
          kandi: "You have a new friend!"
        }
      });
      var sender = new gcm.Sender('AIzaSyAv73kah7w3mlbQ7sVsvhaiIGfKtCH4OEU');
      sender.send(push_message, pushId, function (err, result) {
        if (err) console.log(err);
        else console.log(result);
      });
     callback(); 
    }
  });
}

app.post('/qr', function(req, res) {
  //console.log ("POST:/qr");
  var query = req.body;
  var qrcode = query.qrcode;
  var user_id = query.user_id;
  var username = query.username;
  var facebookid = query.facebook_id;
  var db = mongojs.connect(mongoDbUri , collections);

  var options = {
	"cert": 'cert.pem',
	"key": 'key.pem',
	"production": false,
	};
	var apnConnection = new apn.Connection(options);

  res.setHeader('Content-Type', 'application/json');
  db.kt_qrcode.find({"qrcode": qrcode}, function(err, records) {
    if (err) {
      //console.log("1" = err);
      res.end(JSON.stringify({success: false, error: "qrcode wasn't saved. had error trying to find"}), null, 3);
    } else {
      if (records.length == 0) {
        // qr code doesn't exist in database yet
        db.kt_qrcode.save({qrcode: qrcode, user_id: user_id, facebookid: facebookid}, function(err, saved) {
          if( err || !saved ) {
            //console.log("2 qrcode was not saved");
            res.end(JSON.stringify({success: false, error: "qrcode wasn't saved. had error saving"}), null, 3);
          } else {
            // qr code was saved into to kt_qrcode table
            // so it definitely doesn't exist in kt_ownership table
            // placement is from {0,1,2,3,4}, with 0 being the original ownership of the qrcode
            var qrCodeId = saved._id;
            db.kt_ownership.save({qrcode_id: qrCodeId, user_id: user_id, placement: 0}, function(err, saved) {
              //console.log("qr code was saved into ownership table");
              res.end(JSON.stringify({success: true, qrcode_id: qrCodeId, qrcode: qrcode, user_id: user_id, placement: 0, ownership_id: saved._id}), null, 3);
            });
          }
        });

      } else {
        // qr code already exists in database, we just need to add to the kt_ownership table now
        var existingQrCode = records [0];
        db.kt_ownership.find({qrcode_id: existingQrCode._id}, function (err, records) {
          if (err) {
            res.end(JSON.stringify({error: "qrcode wasn't saved. had error trying to find in kt_ownership table"}), null, 3);
          } else {
            var dbCount = records.length;
            var dbCountminusOne = (dbCount-1);
            var followingCollection = user_id + ':following';
            console.log("currentPlacement: " + dbCount);
            console.log("previousPlacement: " + dbCountminusOne);
            if (dbCount >= 2) {
              // there's already been 5 max qr references in the kt_ownership table
              res.end(JSON.stringify({success: false, limit_reached: true}), null, 3);
            } else {
              // there's room to add more to the qrcode table
              // example: if there's 1 qrcode in the ownership table, the length of db count is 1
              // while that qrcode will have a placement of 0, so the placement should always be the length of dbCount
              db.kt_ownership.find({qrcode_id: existingQrCode._id, user_id: user_id}, function(err, records) {
                if (err) {
                  res.end(JSON.stringify({success: false, error: "error finding someone in kt_ownership"}), null, 3);
                } else {
                  if (records.length != 0) {
                    //console.log("qr code was not saved into ownership table because it already exists");
                    res.end(JSON.stringify({success: false, already_owned: true}), null, 3);
                  } else {
                    var placement = dbCount;
                    db.kt_ownership.save({qrcode_id: existingQrCode._id, user_id: user_id, placement: placement}, function(err, saved) {
                      //console.log("qr code was saved into ownership table");

                      db.kt_qrcode.find({qrcode: qrcode}, function(err, records) {
                        if (err) {
                          console.log("error");
                        } else {
                          var otherUser = records[0].user_id;
                          var followersCollection = otherUser + ':followers';
                          db.followersCollection.find({follower: user_id}, function(err, records) {
                            if (err) {
                              console.log("error in finding follower");
                            } else {
                              if (records.length == 0) {
                                db.followersCollection.save({follower: user_id}, function(err, saved) {
                                  if (err) {
                                    console.log("error saving follower");
                                  } else {
                                    console.log("saved new follower: " + user_id);
                                  }
                                });
                              }
                            }
                          });
                          db.followingCollection.find({following: otherUser}, function(err, records) {
                            if (err) {
                              console.log("error in finding following");
                            } else {
                              if (records.length == 0) {
                                db.followingCollection.save({following: otherUser}, function(err, saved) {
                                  if (err) {
                                    console.log("error saving following");
                                  } else {
                                    console.log("saved new following: " + otherUser);
                                  }
                                });
                              }
                            }
                          });
                        }
                      });

                      db.kt_ownership.find({qrcode_id: existingQrCode._id, placement: dbCountminusOne}, function(err, rec) {
                      	if (err) {
                      		console.log("error");
                      	} else {
                      		var user = rec[0].user_id;
                      		db.kt_users.find({_id: mongojs.ObjectId(user)}, function(err, recc) {
                      			if (err) {
                      				console.log("another error");
                      			} else {
                      				var fbidpush = recc[0].facebookid;

                      				db.kt_token.find({facebookid: fbidpush}, function(err, records) {
			               							if (err) {
				              					   	console.log("error finding push token");
					             						} else {
								              				var token = records[0].token;
											               	//var name = records[0].username;
										              		var badgenum = records[0].badgenum;
										              		var myDevice = new apn.Device(token);
									             				var note = new apn.Notification();
									             				note.badge =  badgenum + 1;
									             				//console.log("total badge count = " + note.badge);
											             		note.sound = "ping.aiff";
									             				note.alert = username + " is now following you";
											             		note.payload = {'KandiTransferFrom': username};
										            			apnConnection.pushNotification(note, myDevice);
								            			}
								          		});
                      			}
                      		});
                      	}
                      });

                      res.end(JSON.stringify({success: true, qrcode_id: existingQrCode._id, qrcode: qrcode, user_id: user_id, placement: placement, ownership_id: saved._id}), null, 3);
                    });

                  }
                }
              });

            }
          }
        });
      }
    }
  });
});


app.post('/followers', function(req, res) {
  var query = req.body;
  var user_id = query.user_id;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_qrcode.find({user_id: user_id}, function(err, records) {
    if (err) {
      console.log("error in find");
    } else {
      var length = records.length;
      if (length == 0) {
        res.end(JSON.stringify({success: false, error: "no followers"}), null, 3);
      } else {
        var results = [];
        var length = records.length;
        findFollowersSeries (0, length, records, db, results, function() {
          res.end(JSON.stringify({success: true, followers_results: results}));
        });
      }
    }
  });
});

function findFollowersSeries (currentIndex, recordsLength, records, db, results, callback) {
  if (currentIndex < recordsLength) {
    item = records[currentIndex];
    if (item) {
      findIfFollower (item, db, function(result) {
        results.push(result);
        currentIndex = currentIndex + 1;
        findFollowersSeries (currentIndex, recordsLength, records, db, results, callback);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
}

function findIfFollower (item, db, callback) {
  if (!item)
    return;

  db.kt_ownership.find({qrcode_id: item._id}, function(err, docs) {
    if (err) {
      return;
    }

    var length = docs.length;
    for (var i = 0; i < length; i ++) {
      var ownershipRow = docs[i];
      var userID = ownershipRow.user_id;
      db.kt_users.find({_id: mongojs.ObjectId(userID)}, function(err, recs) {
        if (err) {
          console.log("error");
        } else {
          if (recs.length > 0) {
            user = recs[0];
            result = {
              //follower: {
                user_id: user._id,
                facebookid: user.facebookid,
                username: user.username
              //}
            }
            callback(result);
          }
        }
      });
    }
  });
}

app.post('/following', function(req, res) {
  var query = req.body;
  var user_id = query.user_id;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({user_id: user_id, placement: 1}, function(err, records) {
    if (err) {
      console.log("error in find");
    } else {
      var length = records.length;
      if (length == 0) {
        res.end(JSON.stringify({success: false, error: "no following"}), null, 3);
      } else {
        var results = [];
        var length = records.length;
        findFollowingSeries (0, length, records, db, results, function() {
          res.end(JSON.stringify({success: true, following_results: results}));
        });
      }
    }
  });
});

function findFollowingSeries (currentIndex, recordsLength, records, db, results, callback) {
  if (currentIndex < recordsLength) {
    item = records[currentIndex];
    if (item) {
      findIfFollowing (item, db, function(result) {
        results.push (result);
        currentIndex = currentIndex + 1;
        findFollowingSeries (currentIndex, recordsLength, records, db, results, callback);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
}

function findIfFollowing (item, db, callback) {
  if (!item)
    return;

  db.kt_ownership.find({qrcode_id: item.qrcode_id, placement: 0}, function(err, docs) {
    if (err) {
      return;
    }

    var length = docs.length;
    for (var i = 0; i < length; i ++) {
      var ownershipRow = docs[i];
      var userID = ownershipRow.user_id;
      db.kt_users.find({_id: mongojs.ObjectId(userID)}, function(err, recs) {
        if (err) {
          console.log("error");
        } else {
          if (recs.length > 0) {
            user = recs[0];
            result = {
              //following: {
                user_id: user._id,
                facebookid: user.facebookid,
                username: user.username
              //}
            }
            callback(result);
          }
        }
      });
    }
  });
}

app.get('/test_HEADERS', function(req, res) {
  //console.log('HEADERS: ' + JSON.stringify(res.headers));
  var query = req.query;
  //console.log('--------------------------------------');
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
  //console.log(resultStr)
})


app.get('/test_DB', function(req, res) {
  //res.writeHead(200, {"Content-Type": "text/html"});
  //res.send("db");

  var collections = ["users", "tags"]
  var db = mongojs.connect(mongoDbUri, collections);

  db.kt_users.find({sex: "female"}, function(err, users) {
    if( err || !users) console.log("No female users found");
    else users.forEach( function(femaleUser) {
      //console.log(femaleUser);
    });
  });

  db.kt_users.save({email: "srirangan@gmail.com", password: "iLoveMongo", sex: "male"}, function(err, saved) {
    if( err || !saved ) console.log("User not saved");
    else console.log("User saved");
  });

  db.kt_users.update({email: "srirangan@gmail.com"}, {$set: {password: "iReallyLoveMongo"}}, function(err, updated) {
    if( err || !updated ) console.log("User not updated");
    else console.log("User updated");
    res.send("UPDATED");
    res.end();
  });

});

app.post('/originaltags', function(req, res) {
  //console.log("POST/originaltags")
  var query = req.body;
  var user_id = query.user_id;

  var db = mongojs.connect(mongoDbUri , collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({user_id: user_id, placement: 0}, function(err, records) {
    if (err) {
        res.end(JSON.stringify({success: false, error: "originaltags, error in find"}), null, 3);
    } else {
      var length = records.length;
      if (length == 0) {
        res.end(JSON.stringify({success: false, error: "originaltags, doesn't have tag in db"}), null, 3);
      } else {
        var results = [];
        var length = records.length;
        //console.log("/originaltags:else:length:" + length);
        findCurrentOwnerSeries (0, length, records, db, results, function() {
          res.end(JSON.stringify({success: true, results: results}));
        });
      }
    }

  });

});

// callback
// has acess to records, results
function findCurrentOwnerSeries (currentIndex, recordsLength, records, db, results, callback) {
  if (currentIndex < recordsLength) {
    //console.log("findCurrentOwnerSeries-index:" + currentIndex);
    item = records[currentIndex];
    if (item) {
      findIfOriginal (item, db, function(result) {
        //console.log ("findCurrentOwnerSeries-findIfOriginal-callback");
        results.push (result);
        currentIndex = currentIndex + 1;
        findCurrentOwnerSeries (currentIndex, recordsLength, records, db, results, callback);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
}

function findIfOriginal(tag, db, callback) {
  if (!tag)
    return;

  db.kt_ownership.find({qrcode_id: tag.qrcode_id}, function(err, records) {
    if (err) {
      //console.log ("findIfOriginal:" + err);
      return;
    } 

    var length = records.length;
    for (i = 0; i<length; i++) {
      var ownershipRow = records[i];
      if (ownershipRow.placement == (length - 1)) {

        var user_id = ownershipRow.user_id;
        db.kt_users.find({_id: mongojs.ObjectId (user_id)}, function(err, records) {
          if (err) {
            console.log ("db.kt_users.find-error-" + err);
          } else {
            if (records.length > 0) {
              user = records[0];
              result = {
                original: {
                  qrcode_id: tag.qrcode_id,
                  user_id: tag.user_id,
                  placement: tag.placement,
                  ownership_id: tag._id
                },
                current: {
                  qrcode_id: tag.qrcode_id,
                  user_id: user._id,
                  user_name: user.username,
                  facebookid: user.facebookid,
                }
              }
              callback(result);
            } else { /* error */ }
          }
        });
      }
    }
  });

}


app.post('/currenttags', function(req, res) {
  //console.log("POST/currenttags")
  var query = req.body;
  var user_id = query.user_id;

  var db = mongojs.connect(mongoDbUri , collections);
  res.setHeader('Content-Type', 'application/json');

  db.kt_ownership.find({$or: [{user_id: user_id, placement: 1}, {user_id: user_id, placement: 2}, {user_id: user_id, placement: 3}, {user_id: user_id, placement: 4}, {user_id: user_id, placement: 5}]}
, function(err, records) {
    if (err) {
        res.end(JSON.stringify({success: false, error: "currenttags, error in find"}), null, 3);
    } else {
      if (length == 0) {
        res.end(JSON.stringify({success: false, error: "currenttags, doesn't have tag in db"}), null, 3);
      } else {
        var results = [];
        var length = records.length;
        //console.log("/currenttags:else:length:" + length);
        getTagsWhereCurrentOwnerSeries(0, length, records, db, results, function() {
          var prevUsersResults = [];
          var length = results.length;
          getPreviousUsersOfCurrentTags (0, length, results, db, prevUsersResults, function() {
            res.end(JSON.stringify({success: true, results: prevUsersResults}));
          });
        });
      }

    }
  });

});

function getPreviousUsersOfCurrentTags (currentIndex, recordsLength, records, db, results, callback) {
  if (currentIndex < recordsLength) {
    //console.log("getPreviousUsersOfCurrentTags-index:" + currentIndex);
    item = records[currentIndex];
    if (item) {
      findPreviousUser(item, db, function(result) {
        results.push(result);
        currentIndex = currentIndex + 1;
        getPreviousUsersOfCurrentTags (currentIndex, recordsLength, records, db, results, callback);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
}

function findPreviousUser(tag, db, callback) {
  if (!tag)
    return;

  if (tag.placement == 0) {
    // no previous user
    db.kt_users.find({_id: mongojs.ObjectId(tag.user_id)}, function(err, records) {
      if (err) {
        //console.log("findPreviousUser;place==0;err:"+ err);
        return;
      } else {
        if (records.length > 0) {
          user = records[0];
          result = {
            original: {
              qrcode_id: tag.qrcode_id,
              user_id: tag.user_id,
              placement: tag.placement,
              ownership_id: tag._id
            },
            current: {
              qrcode_id: tag.qrcode_id,
              user_id: user._id,
              user_name: user.username,
              facebookid: user.facebookid,
            }
          }
          callback(result);
        } else {

        }
      }

    });
  }

  db.kt_ownership.find({qrcode_id: tag.qrcode_id, placement: tag.placement-1}, function(err, records) {
    if (err) {
      //console.log("findPreviousUser:place!=0;err:" + err);
    } else {
      if (records.length > 0) {
        ownershipRec = records[0];
        // copy paste of above

        db.kt_users.find({_id: mongojs.ObjectId(ownershipRec.user_id)}, function(err, records) {
          if (err) {
            //console.log("findPreviousUser;place=!0;err:"+ err);
            return;
          } else {
            if (records.length > 0) {
              user = records[0];
              result = {
                original: {
                  qrcode_id: tag.qrcode_id,
                  user_id: tag.user_id,
                  placement: tag.placement,
                  ownership_id: tag._id
                },
                current: {
                  qrcode_id: tag.qrcode_id,
                  user_id: user._id,
                  user_name: user.username,
                  facebookid: user.facebookid,
                }
              }
              callback(result);
            } else {
              //console.log("findPreviousUser;place!=0;err;length == 0"+ err);
              return;
            }
          }
        });

      }
    }

  });
}


function getTagsWhereCurrentOwnerSeries(currentIndex, recordsLength, records, db, results, callback) {
  if (currentIndex < recordsLength) {
    //console.log("findCurrentOwnerSeries-index:" + currentIndex);
    item = records[currentIndex];
    if (item) {
      findIfCurrentOwner(item, db, function(result) {
        //console.log ("getTagsWhereCurrentOwnerSeries-findIfCurrentOwner-callback");
        // we only add the item if the item is owned by the user
        if (result == true) {
          results.push(item);
        }
        currentIndex = currentIndex + 1;
        getTagsWhereCurrentOwnerSeries(currentIndex, recordsLength, records, db, results, callback);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
}

function findIfCurrentOwner(tag, db, callback) {
  //console.log("--------findIfCurrentOwner:");
  if (!tag)
    callback(false);

  db.kt_ownership.find({qrcode_id: tag.qrcode_id}, function(err, records) {
    if (err) {
      //console.log("findIfCurrentOwner:" + err);
      callback(false);
    }

    var length = records.length;
    if (tag.placement == length-1)
      callback(true);
    else
      callback(false);
  });
}

app.post('/alltags', function(req, res) {
  //console.log("POST/alltags")
  var query = req.body;
  var qrcode_id = query.qrcode_id;

  var db = mongojs.connect(mongoDbUri , collections);
  res.setHeader('Content-Type', 'application/json');

  // accidentally stored the qrcodes as object ids
  // not a big deal, so when getting the string from the client, convert to object id
  db.kt_ownership.find({qrcode_id: mongojs.ObjectId(qrcode_id)}, function(err, records) {
    if(err) {
        res.end(JSON.stringify({success: false, error: "alltags, error in find"}), null, 3);
    } else {
      if (records.length == 0) {
        res.end(JSON.stringify({success: false, error: "alltags, no records; qrcode is is " + qrcode_id}), null, 3);
      } else {
        var length = records.length;
        var results = [];
        getUsersForTagSeries(0, length, records, db, results, function() {
            res.end(JSON.stringify({success: true, results: results}));
        });
      }
    }
  });
});

function getUsersForTagSeries(currentIndex, recordsLength, records, db, results, callback) {
  if (currentIndex < recordsLength) {
    tag = records[currentIndex];
    if (tag) {
      getUserForTag (tag, db, function(result) {
        results.push (result);
        currentIndex = currentIndex + 1;
        getUsersForTagSeries (currentIndex, recordsLength, records, db, results, callback);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
}

function getUserForTag(tag, db, callback) {
  if (!tag)
    return;

  db.kt_users.find({_id: mongojs.ObjectId(tag.user_id)}, function(err, records) {
    if (err) {
      //console.log("getUserForTag;err:" + err);
      return;
    } else {
        if (records.length > 0) {
          user = records[0];
          result = {
            original: {
              qrcode_id: tag.qrcode_id,
              user_id: tag.user_id,
              placement: tag.placement,
              ownership_id: tag._id
            },
            current: {
              qrcode_id: tag.qrcode_id,
              user_id: user._id,
              user_name: user.username,
              facebookid: user.facebookid,
            }
          }
          callback(result);
        } else {
          //console.log("getUserForTag;" + err);
          return;
        }
    }

  });
}

//messaging
app.post('/sendmessage', function(req, res) {
	var query = req.body;
	var sender = query.sender;
	var recipient = query.recipient;
	var message = query.message;
	var timestamp = query.timestamp;
	var username = query.username;

	var options = {
	"cert": 'cert.pem',
	"key": 'key.pem',
	"production": false,
	};
	var apnConnection = new apn.Connection(options);

	//console.log("/sendmessage, " + sender + " says " + message + " to " + recipient + " at " + timestamp);
	var db = mongojs.connect(mongoDbUri, collections);
	res.setHeader('Content-Type', 'application/json');

	db.kt_message.save({sender: sender, recipient: recipient, message: message, timestamp: timestamp}, function(err, saved) {
		if (err || !saved) {
			//console.log("message not send");
			res.end(JSON.stringify({success: false}), null, 3);
		} else {
			//console.log("/sendmessage,  message sent");
			db.kt_token.find({facebookid: recipient}, function(err, records) {
				if (err) {
					console.log("error finding push token");
				} else {
					var token = records[0].token;
					//var name = records[0].username;
					var badgenum = records[0].badgenum;
					var myDevice = new apn.Device(token);
						var note = new apn.Notification();
						note.badge =  badgenum + 1;
						//console.log("total badge count = " + note.badge);
						note.sound = "ping.aiff";
						note.alert = "New Message from " + username;
						note.payload = {'messageFrom': username};
						apnConnection.pushNotification(note, myDevice);
				}
			});
			res.end(JSON.stringify({success: true}), null, 3);
		}
	});
});

app.post('/saveconvo', function(req, res) {
	var query = req.body;
	var sender = query.sender;
	var recipient = query.recipient;
	var message = query.message;
	var myname = query.myname;
	var username = query.username;
	var db = mongojs.connect(mongoDbUri, collections);
	res.setHeader('Content-Type', 'application/json');

	db.kt_convo.find({$or: [{partyA: sender, partyB: recipient, nameA: myname, nameB: username}, {partyA: recipient, partyB: sender, nameA: username, nameB: myname}]}, function(err, records) {
		if (err) {
			res.end(JSON.stringify({success: false}), null, 3);
		} else {
			if (records.length == 0) {
				db.kt_convo.save({partyA: sender, partyB: recipient, message: message, nameA: myname, nameB: username}, function(err, saved) {
					if (err || !saved) {
						res.end(JSON.stringify({success: false}), null, 3);
					} else {
						res.end(JSON.stringify({success: true}), null, 3);
					}
				});
			} else {
				db.kt_convo.update({$or: [{partyA: sender, partyB: recipient}, {partyB: sender, partyA: recipient}]}, {partyA: sender, partyB: recipient, message: message, nameA: myname, nameB: username}, function(err, saved) {
					if (err || !saved) {
						res.end(JSON.stringify({success: false}), null, 3);
					} else {
						res.end(JSON.stringify({success: true}), null, 3);
					}
				});
			}
		}
	});
});

app.post('/allmessages', function(req, res) {
	//console.log("POST/allmessages")
	var query = req.body;
	var sender = query.sender;

	var db = mongojs.connect(mongoDbUri, collections);
	res.setHeader('Content-Type', 'application/json');

	db.kt_convo.find({$or: [{partyA: sender}, {partyB: sender}]}, function(err, records) {
		if (err) {
			res.end(JSON.stringify({success: false, error: "allmessages, error in find"}), null, 3);
		} else {
			var length = records.length;
			if (length == 0) {
				res.end(JSON.stringify({success: false, error: "allmessages, doesn't contain anything"}), null, 3);
			} else {
				var results = [];
				var length = records.length;
				//console.log("/allmessages:else:length:" + length);
				findMessagesSeries (0, length, records, db, results, function() {
					res.end(JSON.stringify({success: true, results: results}));
				});
			}
		}
	});
});

function findMessagesSeries (currentIndex, recordsLength, records, db, results, callback) {
	if (currentIndex < recordsLength) {
		item = records[currentIndex];
		if (item) {
			findMessages (item, db, function(result) {
				results.push (result);
				currentIndex = currentIndex + 1;
				findMessagesSeries (currentIndex, recordsLength, records, db, results, callback);
			});
		} else {
			callback();
		}
	} else {
		callback();
	}
}

function findMessages (list, db, callback) {
	if (!list)
		return;

	db.kt_convo.find({$or: [{partyA: list.partyA}, {partyB: list.partyA}]}, function(err, records) {
		if (err) {
			return;
		} else {
			if (records.length > 0) {
				result = {
				//	convo: {
						partyA: list.partyA,
						partyB: list.partyB,
						message: list.message,
						nameA: list.nameA,
						nameB: list.nameB
				//	}
				}
				callback(result);
			} else {
				return;
			}
		}
	});
}

app.post('/messagehistory', function(req, res) {
	//console.log("POST/messagehistory")
	var query = req.body;
	var recipient = query.recipient;
	var sender = query.sender;

  console.log(sender);
  console.log(recipient);

	var db = mongojs.connect(mongoDbUri, collections);
	res.setHeader('Content-Type', 'application/json');

	db.kt_message.find({$or: [{tID: recipient}, {tID: sender}, {fID: recipient}, {fID: sender}]}, function(err, records) {
		if (err){
			res.end(JSON.stringify({success: false, error: "messagehistory, error in find"}), null, 3);
		} else {
			var length = records.length;
			if (length == 0) {
				res.end(JSON.stringify({success: false, error: "messagehistory, doesn't have any messages in db"}), null, 3);
			} else { 
				var results = [];
				var length = records.length;
				//console.log("/messagehistory:else:length:" + length);
				findMessageHistorySeries(0, length, records, db, results, function() {
					res.end(JSON.stringify({success: true, results: results}));
				});
			}
		}
	});
});

function findMessageHistorySeries (currentIndex, recordsLength, records, db, results, callback) {
	if (currentIndex < recordsLength) {
		//console.log("findMessageHistorySeries-index:" + currentIndex);
		item = records[currentIndex];
		if (item) {
			findMessageHistory (item, db, function(result) {
				//console.log("findMessageHistorySeries-findMessage-callback");
				results.push (result);
				currentIndex = currentIndex + 1;
				findMessageHistorySeries (currentIndex, recordsLength, records, db, results, callback);
			});
		} else {
			callback();
		}
	} else {
		callback();
	}
}

function findMessageHistory (item, db, callback) {
	if (!item)
		return;

	db.kt_message.find({$or: [{tID: item.tID}, {tID: item.fID}]}, function(err, records) {
		if (err) {
			//console.log("findMessage:" + err);
			return;
		} else {
			if (records.length > 0) {
				result = {
					//messagehistory: {
						message: item.msg,
						sender: item.fID,
						recipient: item.tID,
						timestamp: item.date
					//}
				}
				callback(result);
			} else {
				//console.log("findMessage:" + err);
				return;
			}
		}
	});
}

app.post ('/previouspic', function(req, res) {
	//console.log("POST:/previouspic");
	var query = req.body;
	var qrcode = query.qrcode;
	var options = {"sort": [['placement', -1]]};
	var db = mongojs.connect(mongoDbUri, collections);
	res.setHeader('Content-Type', 'application/json');
	db.kt_qrcode.find({qrcode: qrcode}, function(err, records) {
		if (err) {
			res.end(JSON.stringify({success: false, error: "error in find"}), null, 3);
		} else {
			if (records.length == 0) {
				res.end(JSON.stringify({success: false, error: "no previous owner"}), null, 3);
			} else {
				var qrcode_id = records[0]._id;
				//console.log("qrcode_id:" + qrcode_id);
				db.kt_ownership.find({qrcode_id: qrcode_id}, options, function(err, recordss) {
					if (err) {
						res.end(JSON.stringify({success: false}), null, 3);
					} else {
						if (records.length == 0) {
							res.end(JSON.stringify({success: false}), null, 3);
						} else {
							var user_id = recordss[0].user_id;
							//console.log("user_id:" + user_id);
							db.kt_users.find({_id: mongojs.ObjectId(user_id)}, function(err, record) {
								if (err) {
									res.end(JSON.stringify({success: false}), null, 3);
								} else {
									if (records.length == 0) {
										res.end(JSON.stringify({success: false}), null, 3);
									} else {
										var fbidforpic = record[0].facebookid;
										//console.log("fbidforpic:" + fbidforpic);
										res.setHeader('Content-Type', 'application/json');
										res.end(JSON.stringify({success: true, fbidforpic: fbidforpic}), null, 3);
									}
								}
							});
						}
					}
				});
			}
		}
	});
});

app.post('/previoususerlist', function(req, res) {
	//console.log("POST:/previoususerlist");
	var query = req.body;
	var qrcode = query.qrcode;
	var db = mongojs.connect(mongoDbUri, collections);
	res.setHeader('Content-Type', 'application/json');
	db.kt_qrcode.find({qrcode: qrcode}, function(err, records) {
		if (err) {
			res.end(JSON.stringify({success: false}), null, 3);
		} else {
			if (records.length == 0) {
				res.end(JSON.stringify({success: false}), null, 3);
			} else {
				var qrcode_id = records[0]._id;
				//console.log("qrcode_id: " + qrcode_id);
				db.kt_ownership.find({qrcode_id: qrcode_id}, function(err, recordss) {
					if (err) {
						res.end(JSON.stringify({success: false}), null, 3);
					} else {
						if (recordss.length == 0) {
							res.end(JSON.stringify({success: false}), null, 3);
						} else {
							var results = [];
							//console.log("results:" + results);
							var length = recordss.length;
							findPreviousUserListSeries (0, length, recordss, db, results, function() {
								res.end(JSON.stringify({success: true, results: results}));
							});
						}
					}
				});
			}
		}
	});
});

function findPreviousUserListSeries(currentIndex, recordsLength, recordss, db, results, callback) {
	if (currentIndex < recordsLength) {
		item = recordss[currentIndex];
		if (item) {
			findPreviousUserList (item, db, function(result) {
				results.push (result);
				currentIndex = currentIndex + 1;
				findPreviousUserListSeries (currentIndex, recordsLength, recordss, db, results, callback);
			});
		} else {
			callback();
		}
	} else {
		callback();
	}
}

function findPreviousUserList (item, db, callback) {
	if (!item)
		return;
	db.kt_users.find({_id: mongojs.ObjectId(item.user_id)}, function(err, records) {
		if (err) {
			return;
		} else {
			if (records.length > 0) {
				user = records[0];
				result = {
					current: {
						facebookid: user.facebookid
					}
				}
				callback(result);
			}
		}
	});
}

app.post('/ownercount', function(req, res) {
	var query = req.body;
	var qrcode_id = query.qrcode_id;
	var db = mongojs.connect(mongoDbUri, collections);
	res.setHeader('Content-Type', 'application/json');
	db.kt_ownership.find({qrcode_id: qrcode_id}, function(err, records) {
		if (err) {
			res.end(JSON.stringify({success: false}), null, 3);
		} else {
			if (records.length == 0) {
				res.end(JSON.stringify({success: false}), null, 3);
			} else {
				var count = records.count;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({success: true, count: count}), null, 3);
			}
		}
	});
});

app.post('/getuser', function(req, res) {
  var query = req.body;
  var user = query.user;
  var db = mongojs.connect(mongoDbUri, collections);
  res.setHeader('Content-Type', 'application/json');
  db.kt_users.find({facebookid: user}, function(err, records) {
    if (err) {
      res.end(JSON.stringify({success: false}), null, 3);
    } else {
      if (records.length == 0) {
        res.end(JSON.stringify({success: false}), null, 3);
      } else {
        var name = records.username;
        var user_id = records._id;
        //res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({success: true, name: name, user_id: user_id}), null, 3);
      }
    }
  });
});


var port = Number(3000);
//app.listen(port, function() {
//  console.log("Listening on " + port);
//});
//app.listen(3000);


//socket start


//socket end



// tag table

// list of all your current tags  where you were not the original owner
// show the previous owner

// show all previous owners

// kandi table
// list of all your original tags
// show who currently own it
// in detail controller 
// show a list of all previous owners

// -> add friend + send message page
// - add friend on facebook
// need add friend 

