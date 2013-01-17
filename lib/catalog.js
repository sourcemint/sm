
const PATH = require("path");
const FS = require("fs");
const UTIL = require("sm-util/lib/util");
const Q = require("sm-util/lib/q");


var Catalog = exports.Catalog = function(path, descriptor, options) {
	var self = this;

	options = options || {};
	options.format = options.format || "list";

	self.path = path;
	self.saved = true;

	if (options.format === "list") {
		self.packages = descriptor;
	} else
	if (options.format === "tree") {
		self.packages = {};
        function processNode(dependencies, baseId) {
            for (var name in dependencies) {
                var id = PATH.join(baseId, name);
                // `from` is more deterministic than `version`.
                // NOTE: `from`, `version` and `dependencies` are used in 'npm-shrinkwrap.json' files.
                if (dependencies[name].from) {
                    self.packages[id] = {
                        location: dependencies[name].from
                    };
                } else {
                    self.packages[id] = {
                        version: dependencies[name].version
                    };
                }
                if (dependencies[name].dependencies) {
                    processNode(dependencies[name].dependencies, id);
                }
            }
        }
        processNode(descriptor, "");
	} else {
		throw new Error("Unknown catalog descriptor format '" + options.format + "'");
	}

    self.lookupPackage = function (id) {
	    var pkg = false;
	    if (options.parent) {
	    	var prefix = PATH.basename(PATH.dirname(self.path));
	    	if (prefix !== id) {
	    		id = PATH.join(prefix, id);
	    	}
	        pkg = options.parent.lookupPackage(id);
	    }
	    if (pkg === false && self.packages[id]) {
	    	pkg = self.packages[id];
	    }
	    return pkg;
	}

	self.isDeclared = function(id) {
		id = id.replace(/(node_modules|mapped_packages)\//g, "");
		return self.lookupPackage(id);
	}

    self.updatePackage = function(id, locator) {
		id = id.replace(/(node_modules|mapped_packages)\//g, "");
    	var existing = self.isDeclared(id);
    	if (UTIL.deepEqual(existing, locator)) {
    		return Q.resolve();
    	} else {
    		self.saved = false;
	    	self.packages[id] = locator;
			return self.save();
    	}
    }

    self.save = function() {

    	if (self.saved) return Q.resolve();

        // @see http://stackoverflow.com/a/1359808/330439
		function sortObject(o) {
		    var sorted = {}, key, a = [];
		    for (key in o) {
		    	if (o.hasOwnProperty(key)) {
		    		a.push(key);
		    	}
		    }
		    a.sort();
		    for (key = 0; key < a.length; key++) {
		    	sorted[a[key]] = o[a[key]];
		    }
		    return sorted;
		}

        var catalog = {
            "#": "To update this file based on the current dependency tree run: `sm save`",
            packages: sortObject(self.packages)
        };

        var deferred = Q.defer();                    
        catalog = JSON.stringify(catalog, null, 4);
        PATH.exists(self.path, function(exists) {
            function writeFile() {
                FS.writeFile(self.path, catalog, function(err) {
                    if (err) return deferred.reject(err);
                    self.saved = true;
                    return deferred.resolve(true);
                });
            }
            if (exists) {
                FS.readFile(self.path, function(err, data) {
                    if (err) return deferred.reject(err);
                    if (data.toString() === catalog) {
                        return deferred.resolve(false);
                    }
                    return writeFile();
                });
            } else {
                return writeFile();
            }
        });
        return deferred.promise;
    }
}
