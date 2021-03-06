
const PATH = require("path");
// TODO: Use `FS_EXTRA` for `FS` once `graceful-fs` is used by `FS_EXTRA`.
const FS = require("graceful-fs");
const FS_EXTRA = require("sm-util/lib/fs");
const Q = require("sm-util/lib/q");
const UTIL = require("sm-util/lib/util");
const WAITFOR = require("sm-util/lib/wait-for");
const EVENTS = require("events");

// NOTE: We use mostly callbacks below as it is much faster. See https://gist.github.com/4073284
//	     for side-by-side comparison of promise-based and callback-based implementations.

// TODO: The code below could be sped up even more by traversing the tree first and then loading descriptors
//		 as it would trigger more FS operations in parallel.

exports.for = function(packageRootPath) {
    return new Scanner(packageRootPath);
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
    self.symlinked = false;
    if (self.parent) {
        self.dir = dir || self.top.dir;
        self.relpath = PATH.join(self.parent.relpath, self.dir, self.name);
    } else {
        // The default dir is based on the engine. We use `node_modules/` as the default if
        // running on nodejs, for all others it is `mapped_packages/`.
        // TODO: Get default dir from config (utilized platform) instead of detecting here.
        self.dir = dir || ((typeof process === "object" && /\/node$/.test(process.execPath))?"node_modules":"mapped_packages");
	    self.relpath = "";
    }

    self.reset = function(path) {
        self.scanOnly = false;
	    self.path = path || null;
	    self.exists = false;
	    self.children = {};
	    self.childrenIgnored = false;
	    self.descriptors = {};
	    self.circular = false;
    }
    self.reset();
}
FsNode.prototype = new EVENTS.EventEmitter();
FsNode.prototype.traverse = function(callback) {
	callback(this);
	for (var name in this.children) {
		this.children[name].traverse(callback);
	}
}
FsNode.prototype.initForPath = function(path, options, callback) {
    var self = this;

    options.ignorePackages = options.ignorePackages || ["sm", "npm"];

    self.reset(path);

    if (options.scanOnly) {
        self.scanOnly = true;
    }

    function notifyNewNode() {
        if (options._onNewNode) {
            options._onNewNode(self);
        }
    }

    if (self.level === 0) {
        if (typeof options.select !== "undefined" && options.select !== false) {
            options.select = {
                type: "name",
                match: options.select
            }
            if (/\//.test(options.select.match)) {
                options.select.type = "relpath";
            }
        }
    }

    options._loadedPackages = options._loadedPackages || {};
    if (options._loadedPackages[self.path] && options._loadedPackages[self.path].symlinked !== "inside") {
        self.circular = options._loadedPackages[self.path];
        notifyNewNode();
        return callback(null);
    }
    options._loadedPackages[self.path] = self;

    var descriptors = [
        ["package", "package.json"],
        [".package", ".package.json"],
        ["packagePrototype", "package.prototype.json"],
        ["smSource", ".sm/source.json"],
    	["program", "program.json"],
//        ["programPrototype", "program.prototype.json"],
//        ["programRT", "program.rt.json"],
    	["npm-shrinkwrap", "npm-shrinkwrap.json"],
    	["sm-catalog", "sm-catalog.json"],
    	["sm-catalog.locked", "sm-catalog.locked.json"]
    ];
    var exists = {};
    var mtimes = {};
    var cachedDescriptors = {};

    function checkExists(relpath, callback) {
    	if (typeof exists[relpath] !== "undefined") return callback(null, exists[relpath]);
	    FS.exists(PATH.join(self.path, relpath), function(oo) {
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
                    // NOTE: We always replace `$__DIRNAME` with the path to the directory holding the descriptor.
                    data = data.toString().replace(/\$__DIRNAME/g, self.path);
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
                // TODO: Only write one cache file at very top.
				// TODO: Write to tmp file and rename.
                // TODO: Write cache files into top-level `.sm/` folder only.
                return callback(null);
//				return FS.writeFile(PATH.join(self.path, ".sm/.descriptors.cache.json"), JSON.stringify(cache, null, 4), callback);
			}
			checkExists(".sm", function(err, exists) {
				if (err) return callback(err);
				if (exists) return save();
				FS.mkdir(PATH.join(self.path, ".sm"), function(err) {
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
        checkExists("", function(err, exists) {
            if (err) return callback(err);
            self.exists = exists;
            if (!self.exists) {
                return callback(null);
            }
            FS.readdir(self.path, function(err, files) {
                if (err) return callback(err);
                if (
                    files.length === 0 ||
                    (files.length === 1 && files[0] === ".sm")
                ) {
                    self.exists = false;
                }
                if (self.descriptors.package) {
                    // Set name of top package.
                    if (self.level === 0 && self.name === false) {
                        self.name = self.descriptors.package.name;
                    }
                }
                FS.realpath(self.path, function(err, path) {
                    if (err) return callback(err);
                    self.path = path;
                    return callback(null);
                });
            });
        });
    }

    function initChildren(scanOnly, callback) {

        if (options.ignorePackages.indexOf(self.name) !== -1 && self.top.name !== self.name) {
        	self.childrenIgnored = true;
            // TODO: Resolve extends (use same logic as below).
            self.descriptors.merged = UTIL.deepCopy(self.descriptors.package);
            self.descriptors.merged = UTIL.deepMerge(self.descriptors.merged, self.descriptors[".package"] || {});
        	return callback(null);
        }

        if (self.symlinked === "inside") return callback(null);


        function gatherPackages(descriptor) {
            var packages = {};
            function addPackagesForAttribute(attribute) {
                var dependencies = descriptor[attribute];
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
            return packages;
        }

        var packages = gatherPackages(self.descriptors.package);

        function includeDevDependency(name) {
        	if (!packages[name]) return true;
        	if (!/^dev/.test(packages[name])) return true;
        	if (options.nodev === true) return false;
        	if (self.level >= 1 && options.dev !== true) return false;
        	return true;
        }

	    var waitForDirs = WAITFOR.parallel(function(err) {
            if (err) return callback(err);

            function walkPackages(callback) {
                var waitForPackages = WAITFOR.parallel(callback);
                Object.keys(packages).forEach(function(name) {
                    // TODO: Keep the `*` mapping?
                    if (name === "*") return;
                    waitForPackages(function(done) {
                        if (self.children[name]) return done();
                        if (!includeDevDependency(name)) return done();
                        var node = self.children[name] = new FsNode(self, false, name, self.level + 1);
                        var opts = UTIL.copy(options);
                        if (scanOnly) {
                            opts.scanOnly = true;
                        }
                        return node.initForPath(PATH.join(self.path, node.dir, name), opts, done);
                    });
                });
                waitForPackages();                
            }

            return walkPackages(function(err) {
                if (err) return callback(err);

                var descriptor = UTIL.deepCopy(self.descriptors.package);

                function mergeExtends(node, callback) {
                    if (!node.descriptors.package.extends || !node.descriptors.package.extends) {
                        return callback(null);
                    }
                    // NOTE: This will only merge the descriptor if it can be found in
                    //       an already downloaded dependency.
                    //       This is intentional and the extends declaration is ignored if
                    //       the aliased package cannot be found.
                    function merge(alias, callback) {

                        if (!node.children[alias]) {
                            // The package cannot be found so we ignore the extends declaration.
                            return callback(null);
                        }
                        return mergeExtends(node.children[alias], function(err) {
                            if (err) return done(err);

                            descriptor = UTIL.deepMerge(node.children[alias].descriptors.packagePrototype, descriptor);

                            if (descriptor.extends.length > 0) {
                                return merge(descriptor.extends.pop(), function(err) {
                                    if (err) return callback(err);

                                    delete descriptor.extends;
                                    return callback(null, descriptor);
                                });
                            }
                            delete descriptor.extends;
                            return callback(null);
                        });
                    }
                    return merge(descriptor.extends.pop(), function(err) {
                        if (err) return callback(err);
                        return callback(null);
                    });
                }
                return mergeExtends(self, function(err) {
                    if (err) return callback(err);
                    // TODO: Merge program descriptor on top based on pinf standard.
                    self.descriptors.merged = descriptor;
                    self.descriptors.merged = UTIL.deepMerge(self.descriptors.merged, self.descriptors[".package"] || {});
                    // Init any packages that may have been added by prototype descriptors.
                    packages = gatherPackages(self.descriptors.merged);
                    return walkPackages(callback);
                });
            });
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
                                        var opts = UTIL.copy(options);
                                        if (scanOnly) {
                                            opts.scanOnly = true;
                                        }
                                        var originalPath = path;
                                        return FS_EXTRA.realpath(path, function(err, path) {
                                            if (
                                                err &&
                                                // If target of link is not found we ignore the error.
                                                err.code !== "ENOENT"
                                            ) {
                                                return done(err);
                                            }
                                            return node.initForPath(path || originalPath, opts, done);
                                        });
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
                if (
                    node.scanOnly !== true &&
                    (
                        (options.select.type === "name" && options.select.match === "." && node.level === 0) ||
    				    (node[options.select.type] === options.select.match)
                    )
                ) {
					nodes.push(node);
				}
			});
			return callback(null, nodes);
	    }

		// Get mtime of all descriptors.
	    loadMtimes(function(err) {
	    	if (err) return callback(err);

			// Load and validate descriptor cache.
			return loadDescriptor(".sm/.descriptors.cache.json", function(err, cache) {
		    	if (err) return callback(err);
	    		if (cache) {
		    		descriptors.forEach(function(pair) {
		    			if (cache[pair[1]] && cache[pair[1]].mtime === mtimes[pair[1]]) {
		    				cachedDescriptors[pair[1]] = cache[pair[1]].descriptor;
		    			}
		    		});
		    	}

		    	// Load original descriptors if not cached.
		    	loadOriginalDescriptorsAndWriteCache(function(err) {
			    	if (err) return callback(err);

			    	// Update dynamic (non-cachable).
			    	updateDynamic(function(err) {
				    	if (err) return callback(err);

                        var scanOnly = false;

			    		if (options.select) {
			    			if (options.select.type === "relpath") {
		    					if (self.relpath === options.select.match) {
		    						// We found the matching package.
                                    scanOnly = true;
		    					}
		    					if (options.select.match.substring(0, self.relpath.length) !== self.relpath) {
		    						// The matching package is outside of our relpath.
                                    scanOnly = true;
		    					}
			    			}
			    		} else
                        if (typeof options.levels === "number") {
                            if (self.level >= options.levels) {
                               scanOnly = true;
                            }
                        }
                        //if (scanOnly) {
                        // NOTE: We could stop here if nothing needs deeper info.
                        //       One feature that needs deeper info are `extends` declarations
                        //       in descriptors which need to be merged.
                        //       We set `scanOnly` to indicate we want to load info, but not status.
                        //}
			    		// Load all children.
			    		initChildren(scanOnly, function(err) {
					    	if (err) return callback(err);

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
FsNode.prototype.toString = function(format) {
    if (format === "tree") {
        var str = this.level + " : " + this.name + " (" + UTIL.len(this.children) + ")";
        if (!this.exists) {
            str += " missing";
        }
        str += "\n";
        UTIL.forEach(this.children, function(child) {
            var parts = child[1].toString(format).split("\n").map(function(line) {
                return "    " + line;
            });
            str += "    " + parts.splice(0, parts.length-1).join("\n") + "\n";
        });
        return str;
    } else {
        return "[sm:node " + this.path + "]";
    }
}
