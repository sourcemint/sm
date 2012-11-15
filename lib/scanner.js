
const PATH = require("path");
const FS = require("graceful-fs");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const WAITFOR = require("sourcemint-util-js/lib/wait-for");


// NOTE: We use mostly callbacks below as it is much faster. See https://gist.github.com/4073284
//	     for side-by-side comparison of promise-based and callback-based implementations.

// TODO: The code below could be sped up even more by traversing the tree first and then loading descriptors
//		 as it would trigger more FS operations in parallel.

var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new Scanner(packageRootPath);
	}
	return instances[packageRootPath];
}


var Scanner = function(packageRootPath) {
	var self = this;

	self.fsTree = function(options) {
	    options = options || {};
	    if (typeof self.onNewNode === "function") {
	    	options = UTIL.copy(options);
	    	options._onNewNode = self.onNewNode;
	    }
    	var deferred = Q.defer();
	    new FsNode().initForPath(packageRootPath, options, function(err, result) {
	    	if (err) return deferred.reject(err);
	    	return deferred.resolve(result);
	    });
	    return deferred.promise;
	}

	return self;
}


var FsNode = function(parent, dir, name, level) {
    var self = this;

    self.top = (parent && parent.top) || self;
    self.name = name || false;
    self.parent = parent || null;
    self.level = level || 0;
    if (self.parent) {
        self.dir = dir || self.top.dir;
        self.relpath = PATH.join(self.parent.relpath, self.dir, self.name);
    } else {
        // The default dir is based on the platform. We use `node_modules/` as the default if
        // running on nodejs, for all others it is `mapped_packages/`.
        // TODO: Get default dir from platform instead of detecting here.
        self.dir = dir || ((typeof process === "object" && /\/node$/.test(process.execPath))?"node_modules":"mapped_packages");
	    self.relpath = "";
    }

    self.reset = function(path) {
	    self.path = path || null;
	    self.exists = false;
	    self.children = {};
	    self.childrenIgnored = false;
	    self.descriptors = {};
	    self.symlinked = false;
	    self.circular = false;
    }
    self.reset();
}
FsNode.prototype.traverse = function(callback) {
	callback(this);
	for (var name in this.children) {
		this.children[name].traverse(callback);
	}
}
FsNode.prototype.initForPath = function(path, options, callback) {
    var self = this;

    if (options.debug) console.log("[sm] Trigger initForPath() for node: " + path);

    options.ignorePackages = options.ignorePackages || ["sm", "npm"];

    self.reset(path);

    if (self.level === 0) {
        if (typeof options.select !== "undefined") {
            options.select = {
                type: "name",
                match: options.select
            }
            if (/\//.test(options.select.match)) {
                options.select.type = "relpath";
            }
        }
    }

    function notifyNewNode() {
        if (options._onNewNode) {
            options._onNewNode(self);
        }
    }

    options._refreshedPackages = options._refreshedPackages || {};
    if (options._refreshedPackages[self.path] && options._refreshedPackages[self.path].symlinked !== "inside") {
        self.circular = options._refreshedPackages[self.path];
        notifyNewNode();
        return callback(null);
    }
    options._refreshedPackages[self.path] = self;

    function populateLocator() {
        function findDependency(dependencies) {
            if (Array.isArray(dependencies)) {
                for (var i=0 ; i<dependencies.length ; i++) {
                    if (dependencies[i] === self.name) {
                        // Found but no version specified.
                        return "*";
                    }
                }
            } else {
                for (var key in dependencies) {
                    if (key === self.name) {
                        if (dependencies[key] === "" || dependencies[key] === "latest") {
                            return "*";
                        } else {
                            return dependencies[key];
                        }
                    }
                }
            }
            return false;
        }

        function normalizeMapping(locator) {
            if (typeof locator.viaPm !== "undefined" && locator.viaPm === "sm") {
                if (UTIL.isArrayLike(locator.pointer)) {
                    locator.pm = locator.pointer[0];
                    locator.descriptorOverlay = locator.pointer[2] || false;
                    locator.pointer = locator.pointer[1];
                } else {
                    locator.pm = "sm";
                }
            }
        }

        var locator = {
            // `sm` or `npm` depending on which attribute used.
            viaPm: false,
            // The name of the attribute used.
            viaAttribute: false,
            // The name of the declared package manager to use (or default based on `viaPm`).
            pm: false,
            // The 'selector' (in case of default registry; i.e. npm) or 'location' uri.
            pointer: false,
            // Overrides for the package descriptor.
            descriptorOverlay: false,
            // Flag to indicate whether dependency is or should be bundled.
            bundled: false
        };

        if (self.parent) {
            if (self.descriptors.package.mappings && (locator.pointer = findDependency(self.descriptors.package.mappings))) {
                locator.viaPm = "sm";
                locator.viaAttribute = "mappings";
                normalizeMapping(locator);
            } else
            if (self.descriptors.package.devMappings && (locator.pointer = findDependency(self.descriptors.package.devMappings))) {
                locator.viaPm = "sm";
                locator.viaAttribute = "devMappings";
                normalizeMapping(locator);
            } else
            if (self.descriptors.package.dependencies && (locator.pointer = findDependency(self.descriptors.package.dependencies))) {
                locator.viaPm = "npm";
                locator.pm = "npm";
                locator.viaAttribute = "dependencies";
            } else
            if (self.descriptors.package.devDependencies && (locator.pointer = findDependency(self.descriptors.package.devDependencies))) {
                locator.viaPm = "npm";
                locator.pm = "npm";
                locator.viaAttribute = "devDependencies";
            }
            if (self.descriptors.package.bundleDependencies && findDependency(self.descriptors.package.bundleDependencies)) {
                locator.viaPm = "npm";
                locator.pm = "npm";
                locator.bundled = true;
            }
        } else
        if(self.level === 0 && options.topPointer) {
            locator.pointer = options.topPointer;
            locator.viaPm = "sm";
            locator.viaAttribute = "mappings";
            normalizeMapping(locator);
        }
        if (locator.pointer !== false && /^\.{1,2}\//.test(locator.pointer) && self.parent) {
            var oldPointer = locator.pointer;
            locator.pointer = PATH.join(self.parent.path, locator.pointer);
            // Path may not traverse higher than declaring package.
            if (locator.pointer.substring(0, self.parent.path.length) !== self.parent.path) {
                throw new Error("Dependency location '" + oldPointer + "' may not point higher than declaring package ");
            }
        }
        // Fix `0.x.`.
        if (/.\.$/.test(locator.pointer)) {
            locator.pointer = locator.pointer.substring(0, locator.pointer.length -1);
        }
        self.descriptors.locator = (locator.viaPm)?locator:false;    	
    }

    var descriptors = [
    	["package", "package.json"],
    	["smSource", ".sourcemint/source.json"],
    	["program", "program.json"],
    	["programRT", "program.rt.json"],
    	["npmShrinkwrap", "npm-shrinkwrap.json"],
    	["smCatalog", "sm-catalog.json"],
    	["smCatalogLocked", "sm-catalog.locked.json"]
    ];
    var exists = {};
    var mtimes = {};
    var cachedDescriptors = {};

    function checkExists(relpath, callback) {
    	if (typeof exists[relpath] !== "undefined") return callback(null, exists[relpath]);
	    PATH.exists(PATH.join(self.path, relpath), function(oo) {
	    	return callback(null, (exists[relpath] = oo));
	    });
    }

    function loadDescriptor(relpath, callback) {
		checkExists(relpath, function(err, exists) {
			if (err) return callback(err);
	        if (!exists) return callback(null, false);
	        var path = PATH.join(self.path, relpath);
	        FS.readFile(path, function(err, data) {
                if (data.length === 0) {
                    console.log("[sm] WARNING: File '" + path + "' is empty although it should not be!");
                    return callback(null, false);
                }
	        	try {
				    return callback(null, JSON.parse(data));
				} catch(err) {
					err.message += "(path: " + path + ")";
					return callback(err);
				}
	        });
	    });
    }

    function loadMtimes(callback) {
	    var waitFor = WAITFOR.parallel(callback);
		descriptors.map(function(pair) {
			waitFor(function(done) {
				checkExists(pair[1], function(err, exists) {
					if (err) return done(err);
			    	if (!exists) return done();
			    	FS.stat(PATH.join(self.path, pair[1]), function(err, stat) {
			    		if (err) return done(err);
			    		mtimes[pair[1]] = stat.mtime.getTime()/1000;
			    		return done();
			    	});
			    });
			});
		});
	    waitFor();
    }

    function loadOriginalDescriptorsAndWriteCache(callback) {
	    var waitFor = WAITFOR.parallel(function(err) {
	    	if (err) return callback(err);
			// Write new cache file if something has changed.
			if (!writeCache) return callback(null);
			function save() {
				var cache = {};
				descriptors.forEach(function(pair) {
					if (self.descriptors[pair[0]]) {
						cache[pair[1]] = {
							mtime: mtimes[pair[1]],
							descriptor: self.descriptors[pair[0]]
						}
					}
				});
				// TODO: Write to tmp file and rename.
				return FS.writeFile(PATH.join(self.path, ".sourcemint/.descriptors.cache.json"), JSON.stringify(cache, null, 4), callback);
			}
			checkExists(".sourcemint", function(err, exists) {
				if (err) return callback(err);
				if (exists) return save();
				FS.mkdir(PATH.join(self.path, ".sourcemint"), function(err) {
					if (err) return callback(err);
					return save();
				});
			});
	    });
    	var writeCache = false;
		descriptors.map(function(pair) {
			waitFor(function(done) {
	    		if (cachedDescriptors[pair[1]]) {
	    			self.descriptors[pair[0]] = cachedDescriptors[pair[1]];
	    			return done();
	    		}
	    		loadDescriptor(pair[1], function(err, descriptor) {
	    			if (err) return done(err);
		    		if ((self.descriptors[pair[0]] = descriptor)) {
			    		writeCache = true;
			    	}
		    		return done();
		    	});
			});
		});
	    waitFor();
    }

    function updateDynamic(callback) {
		populateLocator();
		if (!self.descriptors.package) return callback(null);
		self.exists = true;
        // Set name of top package.
        if (self.level === 0 && self.name === false) {
            self.name = self.descriptors.package.name;
        }
        FS.realpath(self.path, function(err, path) {
        	if (err) return callback(err);
            self.path = path;
            return callback(null);
        });
    }

    function initChildren(callback) {

        if (typeof options.levels === "number") {
            if (self.level >= options.levels) return callback(null);
        }

        if (options.ignorePackages.indexOf(self.name) !== -1 && self.top.name !== self.name) {
        	self.childrenIgnored = true;
        	return callback(null);
        }

        if (self.symlinked === "inside") return callback(null);

        var packages = {};
        function addPackagesForAttribute(attribute) {
            var dependencies = self.descriptors.package[attribute];
            if (!dependencies) return;
            if (Array.isArray(dependencies)) {
                for (var i=0 ; i<dependencies.length ; i++) {
                    packages[dependencies[i]] = attribute;
                }
            } else {
                for (var key in dependencies) {
                    packages[key] = attribute;
                }
            }
        }
        addPackagesForAttribute("mappings");
        addPackagesForAttribute("devMappings");
        addPackagesForAttribute("optionalMappings");
        addPackagesForAttribute("dependencies");
        addPackagesForAttribute("devDependencies");
        addPackagesForAttribute("optionalDependencies");
        //addPackagesForAttribute("bundleDependencies");

        function includeDevDependency(name) {
        	if (!packages[name]) return true;
        	if (!/^dev/.test(packages[name])) return true;
        	if (options.nodev === true) return false;
        	if (self.level >= 1 && options.dev !== true) return false;
        	return true;
        }

	    var waitForDirs = WAITFOR.parallel(function(err) {
		    var waitForPackages = WAITFOR.parallel(callback);
		    Object.keys(packages).forEach(function(name) {
		    	waitForPackages(function(done) {
	                if (self.children[name]) return done();
	                if (!includeDevDependency(name)) return done();
	                var node = self.children[name] = new FsNode(self, false, name, self.level + 1);
	                return node.initForPath(PATH.join(self.path, node.dir, name), options, done);
		    	});
			});
			waitForPackages();
	    });

		[
            "node_modules",
            "mapped_packages"
		].forEach(function(dir) {
			waitForDirs(function(done) {
				checkExists(dir, function(err, exists) {
					if (err) return done(err);
	                if (!exists) return done();
	                FS.readdir(PATH.join(self.path, dir), function(err, basenames) {
	                	if (err) return done(err);
					    var waitForPackages = WAITFOR.parallel(done);
					    basenames.forEach(function(basename) {
	                        waitForPackages(function(done) {
		                        if (/~backup-/.test(basename)) return done();
		                        if (/^\./.test(basename)) return done();
		                        if (!includeDevDependency(basename)) return done();
		                        if (self.children[basename]) {
		                        	return done(new Error("Package '" + basename + "' was found in **more than one** dependencies directory!"));
		                        }
		                        var path = PATH.join(self.path, dir, basename);
		                        FS.lstat(path, function(err, stat) {
		                        	if (err) return done(err)
		                            if (!stat.isDirectory() && !stat.isSymbolicLink()) return done();
		                            delete packages[basename];
		                            var node = self.children[basename] = new FsNode(self, dir, basename, self.level + 1);
		                            function initChild() {
		                            	return node.initForPath(path, options, done);
		                            }
		                            if (stat.isSymbolicLink()) {
		                        		node.symlinked = "outside";
		                        		FS.readlink(path, function(err, linkStr) {
		                        			if (err) return done(err);
			                            	if (!/^\//.test(linkStr)) {
			                            		if (PATH.join(self.path, dir, linkStr).substring(0, self.path.length) === self.path) {
			                                		node.symlinked = "inside";
			                            		}
			                            	}
			                            	return initChild();
			                            });
		                            } else {
		                            	return initChild();
		                            }
		                        });
	                        });
	                    });
	                    waitForPackages();
	                });
                });
			});
		});
		waitForDirs();
    }

    try {

	    function finalize() {
            notifyNewNode();
			if (self.level > 0) return callback(null);
			if (!options.select) return callback(null, self);
			var nodes = [];
			self.traverse(function(node) {
				if (node[options.select.type] === options.select.match) {
					nodes.push(node);
				}
			});
			return callback(null, nodes);
	    }

		// Get mtime of all descriptors.
	    loadMtimes(function(err) {
	    	if (err) throw err;

			// Load and validate descriptor cache.
			return loadDescriptor(".sourcemint/.descriptors.cache.json", function(err, cache) {
		    	if (err) throw err;
	    		if (cache) {
		    		descriptors.forEach(function(pair) {
		    			if (cache[pair[1]] && cache[pair[1]].mtime === mtimes[pair[1]]) {
		    				cachedDescriptors[pair[1]] = cache[pair[1]].descriptor;
		    			}
		    		});
		    	}

		    	// Load original descriptors if not cached.
		    	loadOriginalDescriptorsAndWriteCache(function(err) {
			    	if (err) throw err;

			    	// Update dynamic (non-cachable).
			    	updateDynamic(function(err) {
				    	if (err) throw err;

			    		if (options.select) {
			    			if (options.select.type === "relpath") {
		    					if (self.relpath === options.select.match) {
		    						// We found the matching package.
							    	return finalize();
		    					}
		    					if (options.select.match.substring(0, self.relpath.length) !== self.relpath) {
		    						// The matching package is outside of our relpath.
							    	return finalize();
		    					}
			    			}
			    		}

			    		// Load all children.
			    		initChildren(function(err) {
					    	if (err) throw err;

					    	return finalize();
			    		});
			    	});
		    	});
	    	});
	    });

	} catch(err) {
        err.message += "(path: " + self.path + ")";
        throw err;
	}
}
FsNode.prototype.toString = function() {
    var str = this.level + " : " + this.name + " (" + UTIL.len(this.children) + ")";
    if (!this.exists) {
        str += " missing";
    }
    str += "\n";
    UTIL.forEach(this.children, function(child) {
        var parts = child[1].toString().split("\n").map(function(line) {
            return "    " + line;
        });
        str += "    " + parts.splice(0, parts.length-1).join("\n") + "\n";
    });
    return str;
}
