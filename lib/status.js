
const PATH = require("path");
const FS = require("graceful-fs");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const WAITFOR = require("sourcemint-util-js/lib/wait-for");

var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new Status(packageRootPath);
	}
	return instances[packageRootPath];
}


var Status = function(packageRootPath) {
	var self = this;

	self.embellishFsTree = function(fsTree, options) {
	    options = options || {};
	    var deferred = Q.defer();
    	var waitFor = WAITFOR.parallel(function(err) {
    		if (err) return deferred.reject(err);
    		return deferred.resolve(fsTree);
    	});
    	fsTree.traverse(function(node) {
    		waitFor(function(done) {    			
    		    return loadStatusForNode(node, options, function(err) {
                    if (err) return done(err);
                    return addFunctionsToNode(node, options, done);
                });
    		});
    	});
    	waitFor();
		return deferred.promise;
	}

	return self;
}

function loadStatusForNode(node, options, callback) {

	// Always get status for some default plugins.
	// TODO: Adjust these based on the platform.
	node.status = {
		"git": true,
		"npm": true
	};

	function loadOutstanding(callback) {
		var count = 0;
		var waitFor = WAITFOR.parallel(function(err) {
			if (err) return callback(err);
			if (count > 0) {
				return loadOutstanding(callback);
			}
			return callback(null);
		});
		UTIL.forEach(node.status, function(pair) {
			if (pair[1] === true) {
				count += 1;
				waitFor(function(done) {
					return node.getPlugin(pair[0]).then(function(plugin) {
						// A plugin may request to fetch status for other plugins.
						node.requestStatusFor = function(pluginId) {
							if (typeof node.status[pluginId] !== "undefined") return;
							node.status[pluginId] = true;
						}
						return plugin.status(options).then(function(status) {
							delete node.requestStatusFor;
							node.status[pair[0]] = status || false;
							return done();
						});
					}).fail(done);
				});
			}
		});
		waitFor();
	}

	loadOutstanding(callback);
}

function addFunctionsToNode(node, options, callback) {

    node.print = function(opts) {

        TERM.stdout.writenl("\0yellow(" + this.name + "\0)");

    }

    callback(null);
}

