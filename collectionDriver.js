var ObjectID = require('mongojs').ObjectID;

CollectionDriver = function(db) {
  this.db = db;
};

CollectionDriver.prototype.getCollection = function(collectionName, callback) {
  console.log("inside get collection");
  var name = this.db.collectionName.toString;
  console.log(name + " this is a method that works");
  /**
  this.db.collection(collectionName, function(error, the_collection) {
    console.log("this is " + the_collection + " inside getCollection");
    if(error) {
      console.log("error in get collection");
      callback(error);
    }
    //else {
      console.log("get collection successful");
      callback(null, the_collection);
    //}
  }); **/
};

//find all objects for a collection
CollectionDriver.prototype.findAll = function(collectionName, callback) {
  console.log("inside findAll")
    this.getCollection(collectionName, function(error, the_collection) { //A
      if( error ) {
        console.log("error finding");
        callback(error);
      }
      else {
        the_collection.find().toArray(function(error, results) { //B
          if( error ) {
            console.log("error finding2");
            callback(error);
          }
          else {
            console.log("failed");
            callback(null, results);
          }
        });
      }
    });
};

//find a specific object
CollectionDriver.prototype.get = function(collectionName, id, callback) { //A
    this.getCollection(collectionName, function(error, the_collection) {
        if (error) callback(error)
        else {
            var checkForHexRegExp = new RegExp("^[0-9a-fA-F]{24}$"); //B
            if (!checkForHexRegExp.test(id)) callback({error: "invalid id"});
            else the_collection.findOne({'_id':ObjectID(id)}, function(error,doc) { //C
            	if (error) callback(error)
            	else callback(null, doc);
            });
        }
    });
}

//save new object
CollectionDriver.prototype.save = function(collectionName, obj, callback) {
    this.getCollection(collectionName, function(error, the_collection) { //A
      if( error ) callback(error)
      else {
        obj.created_at = new Date(); //B
        the_collection.insert(obj, function() { //C
          callback(null, obj);
        });
      }
    });
};

//update a specific object
CollectionDriver.prototype.update = function(collectionName, obj, entityId, callback) {
    this.getCollection(collectionName, function(error, the_collection) {
        if (error) callback(error)
        else {
	        obj._id = ObjectID(entityId); //A convert to a real obj id
	        obj.updated_at = new Date(); //B
            the_collection.save(obj, function(error,doc) { //C
            	if (error) callback(error)
            	else callback(null, obj);
            });
        }
    });
}

//delete a specific object
CollectionDriver.prototype.delete = function(collectionName, entityId, callback) {
    this.getCollection(collectionName, function(error, the_collection) { //A
        if (error) callback(error)
        else {
            the_collection.remove({'_id':ObjectID(entityId)}, function(error,doc) { //B
            	if (error) callback(error)
            	else callback(null, doc);
            });
        }
    });
}

exports.CollectionDriver = CollectionDriver;