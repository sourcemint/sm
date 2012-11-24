
const PATH = require("path");


var Catalog = exports.Catalog = function(descriptor, options) {
	var self = this;

	options = options || {};
	options.format = options.format || "list";

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
}
