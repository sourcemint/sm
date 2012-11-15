
const PATH = require("path");
const FS = require("graceful-fs");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
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
    		    loadStatusForNode(node, options, done);
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




/*

        self.addLoader("npm", false, function(options) {
            if (!self.name) {
                return false;
            }
            if (self.status.descriptor && self.status.descriptor.private === true) {
                return false;
            }
            if (!(
                (self.status.locator && self.status.locator.pm === "npm") ||
                (self.status.descriptor && self.status.descriptor.pm === "npm")
            )) {
                return false;
            }
            return SM_PM.forPackagePath(self.path, pm).then(function(pm) {

                var fetchedNow = false;

                function fetch(refetch) {
                    var now = options.now;
                    time = options.time;
                    if (refetch) {
                        // We are asked to refetch info now due to newer version installed
                        // than available. Rather than fetching info every time we cache it for today.
                        var timeNow = new Date();
                        time = new Date(timeNow.getFullYear(), timeNow.getMonth(), timeNow.getDate()).getTime();
                        now = true;
                    }
                    if (now) fetchedNow = true;
                    return pm.status({
                        name: self.name,
                        private: (self.status.descriptor && self.status.descriptor.private) || false,
                        versionSelector: self.status.locator.viaVersion || self.status.locator.location,
                        now: now,
                        time: time,
                        verbose: options.verbose,
                        pm: "npm",
                        includeDescriptor: true
                    });
                }

                return fetch().then(function(info) {
                    // If already fetched latest info now we are done.
                    if (fetchedNow) return info;
                    // If not published or using latest version we are done.
                    if (!info.published || info.usingLatest) return info;
                    if (typeof info.actualVersion === "undefined") {
                        // Not installed.
                        return info;
                    }
                    // Check if installed version is newer than latest.
                    if (SEMVER_NPM.compare(info.actualVersion, info.latestVersion) > 0) {
                        // Latest info is out of date! Re-fetch.
                        return fetch(true);
                    }
                    return info;
                });
            });
        });
*/
}
