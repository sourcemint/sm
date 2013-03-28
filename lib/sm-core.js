
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("sm-util/lib/fs");
const EXEC = require("child_process").exec;
const Q = require("sm-util/lib/q");
const UTIL = require("sm-util/lib/util");
const TERM = require("sm-util/lib/term");
const OS = require("sm-util/lib/os");
const URL_PROXY_CACHE = require("sm-util/lib/url-proxy-cache");
const JSON_STORE = require("sm-util/lib/json-store").JsonStore;
const SEMVER = require("semver");
const MAPPINGS = require("mappings");
const WAITFOR = require("sm-util/lib/wait-for");
const URI = require("sm-util/lib/uri");
const HTTP_PROXY = require("http-proxy");
const URI_PARSER = require("./uri-parser");
const PLUGIN = require("sm-plugin");
const SCANNER = require("./scanner");
const STATUS = require("./status");
const HELPERS = require("./helpers");
const CONFIG = require("./config");
const PROFILE = require("./profile");
const LOCATOR = require("./locator");
const WALKER = require("./walker");
const PINF = require("pinf");
const COPY = require("ncp").ncp;
const SM_NODE_SERVER = require("sm-node-server");


process.on("uncaughtException", function (err) {
    // NOTE: `err.stack` seems to be useless here.
    TERM.stderr.writenl("\0red(UNCAUGHT EXCEPTION: " + err + "\0)");
});


const API = {
	HELPERS: HELPERS,
	Q: Q,
	FS: FS,
	UTIL: UTIL,
	TERM: TERM,
	WAITFOR: WAITFOR,
	URI_PARSER: URI_PARSER,
	URL_PROXY_CACHE: URL_PROXY_CACHE,
	PATH: PATH,
	FS: FS,
	SEMVER: SEMVER,
	OS: OS,
	HTTP_PROXY: HTTP_PROXY,
	JSON_STORE: JSON_STORE,
	COPY: COPY,
	SM_NODE_SERVER: SM_NODE_SERVER,
	PINF: PINF,
	URI: URI,
	WALKER: WALKER,
	SM_CORE: exports
};
CONFIG.setAPI(API);
PROFILE.setAPI(API);
WALKER.setAPI(API);
//var instances = {};


exports.for = function(packageRootPath, parentSMCore) {
	return new SMCore(packageRootPath, parentSMCore);
//	if (!instances[packageRootPath]) {
//		instances[packageRootPath] = new SMCore(packageRootPath, options);
//	}
//	return instances[packageRootPath];
}


var SMCore = function(packageRootPath, parentSMCore) {
	var self = this;

	var homeBasePath = CONFIG.getHomeBasePath();

	var config = CONFIG.for(homeBasePath);
	var profile = null;

	var scanner = SCANNER.for(packageRootPath);
	// TODO: Do this via an event so we can have multiple listeners.
	scanner.onNewNode = function(node) {
		node.API = API;
		node.getCore = function() {
			return self;
		}
		node.getPlugin = function(pluginName, callback) {
			return self.getPlugin(API, self, node, pluginName, callback);
		}
		node.getCachePath = function(type, uri) {
			var path = false;
			if (type === "install") {
				path = PATH.join(
					homeBasePath,
					"cache/install",
					node.summary.engineName + "-" + (node.summary.newEngineVersion || node.summary.engineVersion),
					HELPERS.uriToPath(uri)
				);
			} else
			if (type === "external") {
				path = PATH.join(
					homeBasePath,
					"cache/external"
				);
				if (uri) {
					path = PATH.join(path, HELPERS.uriToPath(uri));
				}
			} else
			if (type === "latest") {
				path = PATH.join(
					homeBasePath,
					"cache/latest"
				);
				if (uri) {
					path = PATH.join(path, HELPERS.uriToPath(uri));
				}
			}
			if (!path) {
				throw new Error("Unknown cache type '" + type + "'");
			}
			if (!FS.existsSync(PATH.dirname(path))) {
		        FS.mkdirsSync(PATH.dirname(path));
			}
			return path;
		}
	    node.refresh = function(options) {
	    	options = UTIL.copy(options);
	    	options.time = Math.floor(Date.now()/1000);
	    	options._onNewNode = scanner.onNewNode;
	        options.logger.debug("Refreshing node `" + node.path + "`.");
	        var deferred = Q.defer();
	        node.initForPath(node.path, options, function(err) {
	            if (err) return deferred.reject(err);
	            return STATUS.for(node.path).embellishFsTree(node, options, function(err) {
	            	if (err) return deferred.reject(err);
	                return deferred.resolve(node);
	            });
	        });
	        return deferred.promise;
	    }		
	}
	var status = STATUS.for(packageRootPath);

	self.__init = function(programOptions) {
		return Q.fcall(function() {
			return config.__init(programOptions, packageRootPath).then(function() {
				// TODO: Adjust profile based on `--profile` flag.
				profile = PROFILE.for(PATH.join(self.getConfig(["toolchain", "paths", "profiles"]), self.getConfig(["toolchain", "profile"])));
				return profile.__init(programOptions, packageRootPath, parentSMCore);
			});
		});
	}

	self.getConfig = function(ns) {
		return config.get(ns);		
	}

	self.setConfig = function(scope, ns, value) {
		return config.set(scope, ns, value);
	}

	self.getProfile = function(ns) {
		if (ns === "name") {
			return profile.getName();
		}
		throw new Error("Cannot get profile info for unknown property: " + ns);
	}

	self.getCredentials = function(ns) {
		if (!profile) {
			var err = new Error("`profile` not set while calling `getCredentials`");
			console.error(err.stack);
			throw err;
		}
		return profile.getCredentials(ns);
	}
	self.setCredentials = function(ns, value) {
		return profile.setCredentials(ns, value);		
	}

	self.getPlugin = PLUGIN.for;

	self.resolve = function(id, options) {
		options = options || {};
		try {
			if (/^\//.test(id)) {
				return Q.resolve(id);
			}
			function load() {

				var path = MAPPINGS.for(packageRootPath).resolve(id, true);

				options.logger.debug("Resolved id `" + id + "` to path `" + path + "`");

				if (path) {
					if (!FS.existsSync(path)) {
						throw new Error("Path '" + path + "' for resolved id '" + id + "' not found.");
					}
					return Q.resolve(path);
				}
				return false;
			}
			var ret = load();
			if (ret !== false) {
				return Q.resolve(ret);
			}
			var idParts = id.split("/");
			var opts = UTIL.copy(options);
			// TODO: Get `node_modules/` from `info.directories.package`.
			opts.select = "node_modules/" + idParts.shift();
			opts.format = "JSON";
			return self.status(opts).then(function(nodes) {
				if (nodes.length === 0) {
					if (PINF.forProgram(packageRootPath)(packageRootPath).config().pinf.packages["*"] === "*") {
						throw new Error("TODO: We are allowed to download any package.");
					} else {
						throw new Error("Package not found and not declared!");
					}
				}
				if (nodes.length > 1) {
					nodes.forEach(function(node) {
						console.log("node:", node.summary.path);
					});
					throw new Error("Found more than one package! We should never get here.");
				}
				if (nodes[0].summary.installed) {
					throw new Error("Package already installed! We should never get here.");
				}
				opts.dynamic = true;
				return self.install(opts).then(function(node) {
					return load();
				});
			});
		} catch(err) {
			return Q.reject(err);
		}
	}

	self.require = function(id, options) {
		return self.resolve(id, options).then(function(path) {
			if (!path) return false;
			var inst = null;
			try {
				options.logger.debug("Requiring module from `" + path + "`");
				inst = require(path);
			} catch(err) {
				err.message += " (while loading module from path `" + path + "`)";
				return Q.reject(err);
			}
			return Q.resolve(inst);
		});
	}

	self.status = function(id, options) {
		if (typeof id === "object" && typeof options === "undefined") {
			options = id;
			id = null;
		}
		var opts = UTIL.copy(options);
		if (id) {
			opts.select = id;
		}
		return scanner.fsTree(opts).then(function(tree) {
			var deferred = Q.defer();
			status.embellishFsTree(tree, options, function(err) {
				if (err) return deferred.reject(err);

				// TODO: Generate JSON tree by calling `tree.toJSON()`.
				if (options.format === "JSON") return deferred.resolve(tree);

			    var printOptions = {
			    	mode: "tree",
			    	info: options.info || false
			    };

				TERM.stdout.writenl("");

				if (Array.isArray(tree)) {

					tree.forEach(function(node) {
				        node.print(printOptions);
					});

					TERM.stdout.writenl("");

					return deferred.resolve();
				}

	            tree.traverse(function(node) {

	            	if (node.scanOnly) return false;

			        // Don't go deeper if:
			        if (
			        	// We are deeper than level 1 and not asked to display all, and
			            options.all !== true && node.level > 1 &&
			            // We have no deep mandatory install actions, and
			            !node.deepHints.actions.install &&
			            // We have no deep mandatory update actions, and
			            !node.deepHints.actions.update &&
			            // We have no deep packages under VCS, and
			            !node.deepHints.vcs &&
			            // We have no deep optional update options or are ourself found in parent.
			            ((!node.deepHints.actions.updateOptional) || node.summary.inParent)
			        ) {
			            return false;
			        }

			        // If optional and not installed we don't show it. Unless we want to see it based on `--all`.
			        if (node.summary.optional && !node.summary.installed && !options.all) return false;

			        node.print(printOptions);

			        // Don't go deeper if:
			        if (
			        	// We are deeper than or at level 1 and not asked to display all, and
			            options.all !== true && node.level >= 1 &&
			            // We have no deep mandatory install actions, and
			            !node.deepHints.actions.install &&
			            // We have no deep mandatory update actions, and
			            !node.deepHints.actions.update &&
			            // We have optional update action ourself
			            node.hints.actions.updateOptional
			        ) {
				        // We only want to show the first optional update and ignore all below (if no errors) as
				    	// optional updates below (if present) will likely update if parent updates
				        // and parent needs to be updated first anyway.
			            return false;
			        }
	            });

				if (UTIL.len(tree.deepHints.display) > 0) {
					TERM.stdout.writenl("");
					// TODO: Include 'priority' integer at `tree.deepHints.display[type][5]` and sort by it before displaying.
					for (var type in tree.deepHints.display) {
						tree.deepHints.display[type].forEach(function(hint) {
		                    TERM.stdout.writenl("  " + hint);
						});
					}
				}

				TERM.stdout.writenl("");

				return deferred.resolve();
			});
			return deferred.promise;
		});
	}

	self.init = function(uri, options) {

		var deferred = Q.defer();

		options.logger.debug("Init `" + packageRootPath + "` with `" + uri + "`.");

		if (FS.existsSync(packageRootPath)) {
			if (FS.readdirSync(packageRootPath).filter(function(basename) {
				if (basename === ".sm") {
					var files = FS.readdirSync(PATH.join(packageRootPath, basename));
					if (files.length === 1 && files[0] === "program.json") {
						// Assuming program.json is empty.
						// TODO: Verify that program.json is empty.
						return false;
					}
				}
				return true;
			}).length > 0) {
				if (options.delete) {
					options.logger.debug("Deleting existing: " + packageRootPath);
					// TODO: Don't delete top dir.
					FS.removeSync(packageRootPath);
					FS.mkdirSync(packageRootPath);
				} else {
	                TERM.stdout.writenl("\0red([sm] ERROR: Directory '" + packageRootPath + "' not empty! Use `--delete` to overwrite.\0)");
					return Q.reject(true);
				}
			}
		} else {
			FS.mkdirsSync(packageRootPath);
		}

		return config.reinit().then(function() {

			FS.writeFileSync(PATH.join(packageRootPath, ".sm", "source.json"), JSON.stringify({
				locator: {
					pointer: uri
				}
			}));

			if (!options.getConfig(["package", "resolve"])) {
				options.setConfig("local", ["package", "resolve"], true);
			}

			return scanner.fsTree(options).then(function(tree) {
				var deferred = Q.defer();
				status.embellishFsTree(tree, options, function(err) {
					if (err) return deferred.reject(err);
					var opts = UTIL.copy(options);
					opts.noBackup = true;
					return self.install(opts).then(function() {
						if (options.switch) {
							return self.switch(options);
						}
					}).then(deferred.resolve, deferred.reject);
				});
				return deferred.promise;
			});
		});
	}

	self.switch = function(options) {
		var opts = UTIL.copy(options);
		opts.select = ".";
		opts.format = "JSON";
		return self.status(opts).then(function(nodes) {
			function runScript(name) {
				if (
					!nodes[0].descriptor.package ||
					!nodes[0].descriptor.package.scripts ||
					!nodes[0].descriptor.package.scripts[name]
				) {
					return;
				}
				try {
					var command = HELPERS.makeNodeCommanFromString(nodes[0].descriptor.package.scripts[name]).split(" ");
					var opts = UTIL.copy(options);
					opts.cwd = packageRootPath;
					return OS.spawnInline(command.shift(), command, opts);
				} catch(err) {
					return Q.reject(err);
				}
			}
			if (options.startWorkspace) {
				return runScript("start-workspace");				
			} else
			if (options.stopWorkspace) {
				return runScript("stop-workspace");
			} else {
				var activateTpl = FS.readFileSync(PATH.join(__dirname, "../tpl/sm-activate-workspace.tpl")).toString();
				activateTpl = activateTpl.replace(/__PINF_PROGRAM__/g, PATH.join(nodes[0].path, "program.json"));
				activateTpl = activateTpl.replace(/__PINF_PACKAGE__/g, PATH.join(nodes[0].path, "package.json"));
				activateTpl = activateTpl.replace(/__PINF_RUNTIME__/g, PATH.join(nodes[0].path, ".rt/program.rt.json"));
				activateTpl = activateTpl.replace(/__PINF_MODE__/g, "dev");
				activateTpl = activateTpl.replace(/__SM_WORKSPACE_HOME__/g, nodes[0].path);
				activateTpl = activateTpl.replace(/__SM_WORKSPACE_NAME__/g, nodes[0].name);
				activateTpl = activateTpl.replace(/__SM_HOME__/g, homeBasePath);
				FS.writeFileSync(PATH.join(packageRootPath, ".sm", ".activate"), activateTpl);
				FS.chmodSync(PATH.join(packageRootPath, ".sm", ".activate"), 0755);
				if (process.env.SM_WORKSPACE_HOME) {
	                TERM.stdout.writenl("\0red([sm] ERROR: Cannot switch workspace while in workspace. You must 'exit' workspace first.\0)");
					return Q.reject(true);
				}
				FS.writeFileSync(PATH.join(packageRootPath, ".sm", ".switch"), PATH.join(packageRootPath, ".sm", ".activate"));
				FS.chmodSync(PATH.join(packageRootPath, ".sm", ".switch"), 0755);
			}
		});
	}

	self.edit = function(selector, uri, options) {
		if (!options.getConfig(["package", "resolve"])) {
			options.setConfig("local", ["package", "resolve"], true);
		}
		return Q.fcall(function() {
			var opts = UTIL.copy(options);
			opts.format = "JSON";
			opts.select = selector;
			return self.status(opts).then(function(list) {
				if (list.length === 0) {
					TERM.stdout.writenl("\0red([sm] ERROR: Could not find dependency via '\0yellow(" + selector + "\0)'. See `\0bold(sm status -i\0)` for dependency names or paths to use.\0)");
					return Q.reject(true);
				} else
				if (list.length > 1) {
					TERM.stdout.writenl("\0red([sm] ERROR: Found \0bold(multiple\0) dependencies via '\0yellow(" + selector + "\0)'. Pick one of the following by using the relpath.\0)");
	                var opts = UTIL.copy(options);
	                opts.info = true;
	                UTIL.forEach(list, function(node) {
	                    node.print(opts);
	                });
					return Q.reject(true);
				}
				var node = list[0];
				if (node.summary.vcs) {
					TERM.stdout.writenl("\0red([sm] ERROR: Package '" + node.summary.relpath + "' is already in edit mode.\0)");
					return Q.reject(true);
				}
				var deferred = Q.defer();
		        node.getPlugin("git", function(err, plugin) {
		        	if (err) return deferred.reject(err);
		        	function edit(locator) {
		        		if (!locator) {
				            TERM.stdout.writenl("\0red(Cannot edit package '" + node.summary.relpath + "'. Could not determine where to pull the source from.'.\0)");
				            return Q.reject(true);
				        }
						return plugin.edit(locator, options);
		        	}
		        	if (uri) {
		        		var locator = {
		        			pointer: uri,
		        			pm: node.summary.pm.locator,
		        			name: node.summary.name
		        		};
				        return LOCATOR.makeLocator(node, locator, options, function(err, locator) {
				            if (err) return Q.reject(err);
				            return edit(locator).then(deferred.resolve, deferred.reject);
						});
		        	} else {
			            return edit(node.summary.actualLocator || node.summary.declaredLocator).then(deferred.resolve, deferred.reject);
		        	}
		        });
		        return deferred.promise;
			});
		});
	}

	self.try = function(uri, options) {
		return Q.fcall(function() {
			if (options.global && !options.project) {
				throw new Error("Cannot use `--global` without using `--project`");
			}
			var tryPath = PATH.join(self.getConfig(["toolchain", "paths", "try"]), HELPERS.uriToPath(uri).replace(/^https?\//, ""));
			var streamFilename = PINF.uriToFilename(uri).replace(/^https?\+/, "");
            var m = streamFilename.match(/\+~(\d*\.\d*)\.\d*$/);
            if (m) {
                streamFilename = streamFilename.replace(m[0], "+" + m[1]);
            }
			if (options.project) {
				tryPath = PATH.join(self.getConfig(["toolchain", "paths", "projects"]), streamFilename);
			}
			if (!FS.existsSync(tryPath)) {
				FS.mkdirsSync(tryPath);
			}
			var core = exports.for(tryPath);
			return core.__init({}).then(function() {
				var opts = UTIL.copy(options);
				opts.switch = true;
				return core.init(uri, opts).then(function() {
					if (FS.existsSync(PATH.join(tryPath, ".sm", ".switch"))) {
						FS.renameSync(PATH.join(tryPath, ".sm", ".switch"), PATH.join(packageRootPath, ".sm", ".switch"));
					}
					if (options.global) {
						var packagePath = PATH.join(self.getConfig(["toolchain", "paths", "packages"]), streamFilename);
						if (FS.existsSync(packagePath)) {
							console.warn("Did not link '" + tryPath + "' to '" + packagePath + "' as link already found!");
						} else {
							FS.symlinkSync(tryPath, packagePath);
						}
					}
					if (options.project) {
						return core.edit(".", uri, options);
					}
				});
			});
		});
	}

	self.diff = function(options) {
		var opts = UTIL.copy(options);
		opts.format = "JSON";
		opts.select = ".";
		return self.status(opts).then(function(node) {
			return node[0].diff(options).then(function(changes) {
				if (options.format === "JSON") return changes;
				if (!changes || UTIL.len(changes) === 0) {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("  \0yellow(No changes found.\0)");
                    TERM.stdout.writenl("");
                    return false;
				}
				for (var packagePath in changes) {
					var packagePathString = packagePath;
					if (packagePathString.substring(0, node[0].summary.path.length) === node[0].summary.path) {
						packagePathString = packagePathString.substring(0, node[0].summary.path.length + 1) + "\0yellow(" + packagePathString.substring(node[0].summary.path.length + 1) + "\0)";
					}
                    TERM.stdout.writenl("\0bold(" + packagePathString + "\0)");
                    for (var relpath in changes[packagePath]) {
	                    TERM.stdout.writenl("  " + relpath + " \0magenta(" + changes[packagePath][relpath] + "\0)");
                    }
				}
			});
		});
	}

	self.export = function(path, options) {
		var opts = UTIL.copy(options);
		opts.format = "JSON";
		return self.status(opts).then(function(topPackage) {
			var deferred = Q.defer();
	        topPackage.getPlugin("sm", function(err, plugin) {
	        	if (err) return deferred.reject(err);
	            return plugin.export(path, options).then(deferred.resolve, deferred.reject);
	        });
	        return deferred.promise;
		});
	}

	self.bump = function(options) {
		var opts = UTIL.copy(options);
		opts.format = "JSON";
		opts.levels = 0;
		return self.status(opts).then(function(topPackage) {
			var deferred = Q.defer();
	        topPackage.getPlugin(topPackage.summary.pm.locator || topPackage.summary.pm.install, function(err, plugin) {
	        	if (err) return deferred.reject(err);
				if (!topPackage.hints.actions.bump) {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("  \0yellow(Cannot bump. Is VCS dirty?\0)");
                    TERM.stdout.writenl("");
                    return deferred.reject(true);
				}
	            return plugin.bump(options).then(function() {
		        	if (options.publish) {
		        		return self.publish(options);
		        	}
		        }).then(deferred.resolve, deferred.reject);
	        });
			return deferred.promise;
		});
	}

	self.publish = function(options) {
		if (!options.getConfig(["package", "resolve"])) {
			options.setConfig("local", ["package", "resolve"], true);
		}
		var opts = UTIL.copy(options);
		opts.format = "JSON";
		if (!opts.recursive) {
			opts.levels = 0;
		}
		return self.status(opts).then(function(topPackage) {
			if (opts.recursive) {
				// Publish all packages from deepest in the tree to top package.
				var packages = [];
	            topPackage.traverse(function(node) {
	            	if (node.circular) return false;
					if (!node.hints.actions.publish) return;
	            	packages.push(node);
	            });
	            if (packages.length === 0) {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("  \0yellow(No changes to publish found!\0)");
                    TERM.stdout.writenl("");
                    return;
                }
	            packages.reverse();
				var done = Q.resolve();
	            packages.forEach(function(node) {
	            	done = Q.when(done, function() {
	            		node.print();
						return node.publish(options).then(function() {
							node.print();
						});
	            	});
	            });
	            return done;
			} else {
				if (!topPackage.hints.actions.publish) {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("  \0yellow(No changes to publish found!\0)");
                    TERM.stdout.writenl("");
                    return;
				}
				topPackage.print();
				return topPackage.publish(options).then(function() {
					topPackage.print();
				});
			}
		});
	}

	self.deploy = function(options) {
		options.format = "JSON";
		options.levels = 0;
		return self.status(options).then(function(topPackage) {
/*
// TODO: Populate `hints.actions.deploy`.
			if (!topPackage.hints.actions.deploy) {
                TERM.stdout.writenl("");
                TERM.stdout.writenl("  \0yellow(No changes to publish found!\0)");
                TERM.stdout.writenl("");
                return;
			}
*/
			topPackage.print();
			return topPackage.deploy(options);
		});
	}

	self.build = function(options) {
		options.format = "JSON";
		options.levels = 0;
		return self.status(options).then(function(topPackage) {
			if (!topPackage.summary.scripts.build) {
                TERM.stdout.writenl("\0red(ERROR: No `build` script found in package descriptor for package '" + topPackage.path + "'.\0)");
	            throw true;
			}

			// TODO: Use generic script executer here.
			// ASSUMES: `<script> ...`.

            TERM.stdout.writenl("Running `build` script: " + topPackage.summary.scripts.build);

			var command = topPackage.summary.scripts.build.split(" ");
			var opts = UTIL.copy(options);
			opts.cwd = topPackage.path;
			opts.verbose = true;
			return OS.spawnInline(command.shift(), command, opts);
		});
	}

	self.install = function(options) {
		var installed = {};
		options.format = "JSON";
		return self.status(options).then(function(tree) {

			var opts = UTIL.copy(options);
			delete opts.select;

			var installedNodes = [];

			function traverse(tree) {
				var deferred = Q.defer();
				try {
					var acting = false;
		            tree.traverse(function(node) {
		            	if (!node.parent) return false;
		            	if (acting) return false;
		                if (node.circular) return false;
		                if (!node.hints.actions.install) return true;
						node.print();
						if (installed[node.path]) {
							throw new Error("We should never be asked twice to install package: " + node.path);
						}
						acting = true;
						installed[node.path] = true;
						node.install(opts).then(function(node) {
							installedNodes.push(node);
							node.print();
							return traverse(node.top);
						}).then(deferred.resolve, deferred.reject);
						return false;
		            });
		            if (!acting) deferred.resolve();
		        } catch(err) {
		        	return deferred.reject(err);
		        }
	            return deferred.promise;
			}

			return Q.fcall(function() {
				if (UTIL.isArrayLike(tree)) {
					if (tree.length > 1) {
						throw new Error("Matched more than one package for selector '" + options.select + "'!");
					}
					var node = tree.shift();
	            	if (!node.parent) return;
					node.print();
					return node.install(opts).then(function() {
						installedNodes.push(node);
						node.print();
					});
				} else {
					return traverse(tree).then(function() {
						// Call install on top package.
						return tree.install(opts).then(function() {
							tree.print();
							return traverse(tree);
						});
					});
				}
			}).then(function() {
				var done = Q.resolve();
				installedNodes.reverse();
				installedNodes.forEach(function(node) {
					done = Q.when(done, function() {

	                    options.logger.debug("Running postinstall for package '" + node.relpath + "'.");

	                    return node.postinstall(opts);
					});
				});
				return done;
			});
		});
	}

	self.save = function(options) {
		options.format = "JSON";
		return self.status(options).then(function(tree) {

			var loggedDirtyVCSMessage = false;
			function logDirtyVCSMessage() {
				if (loggedDirtyVCSMessage) return;
				loggedDirtyVCSMessage = true;
                TERM.stdout.writenl("");
                TERM.stdout.writenl("\0bold(Found packages with dirty VCS:\0)");
                TERM.stdout.writenl("");
			}

            // Save all dirty dependencies first.
            var dirty = [];
            var done = Q.resolve();
            tree.traverse(function(node) {
                if (node.circular) return false;
                if (node.level > 0 && node.summary.vcs && node.summary.vcs.dirty) {
                    dirty.push(node);
                }
            });
            if (dirty.length > 0) {
				logDirtyVCSMessage();
                dirty.reverse();
                dirty.forEach(function(node) {
                    node.print({
                        prefix: " "
                    });
                });
                var done = Q.when();
                dirty.forEach(function(node) {
                    done = Q.when(done, function() {
				        // TODO: Make command/plugin to open packages with configurable via ~/.sm/config.json`.
				        var deferred = Q.defer();
			            node.getPlugin("stree", function(err, plugin) {
			            	if (err) return deferred.reject(err);
                            return plugin.save(node, options).then(deferred.resolve, deferred.reject);
                        });
                        return deferred.promise;
                    });
                });
            }
            return Q.when(done, function() {
	            // Now update `sm-catalog.json`.
	            if (dirty.length > 0) return;
	            var done = Q.resolve();
	            var changed = [];
	            tree.traverse(function(node) {
	                // TODO: Compare read packages to cache or '.sm/' based checksums to see if anything has changed.
	                //		 If something has changed inform user to `sm edit` the package and then save it.
	                if (node.level > 0 && node.hints.actions.save) {
	                	changed.push(node);
	                }
	            });
	            if (changed.length > 0) {
	                var done = Q.when();
	                changed.forEach(function(node) {
	                	if (node.hints.actions.save) {
		                    done = Q.when(done, function() {
								if (node.hints.actions.save[0] === "top-catalog") {
									var archive = node.hints.actions.save[1].getLocation("archive");
									if (node.circular) {
										archive = node.circular.hints.actions.save[1].getLocation("archive");
									}
									if (!archive) {
										console.log("node.summary", node.summary);
										console.log("node.hints.actions.save[1]", node.hints.actions.save[1]);
										throw new Error("`getLocation('archive')` failed for: " + node.path);
									}
									if (!/^\//.test(archive)) {
										return node.top.catalogs["sm-catalog"].updatePackage(node.relpath, {
											archive: archive
										});
									}
								} else {
									throw new Error("Saving to '" + node.hints.actions.save[0] + "' not yet implemented!");
								}
		                    });
		                }
	                });
	                done = Q.when(done, function() {
	                	return tree.refresh(options).then(function(node) {
	                		tree = node;
	                	});
	                });
	            }
	            return done;
            }).then(function() {
	            // Finally save top package.
                if (tree.summary.vcs && tree.summary.vcs.dirty) {
					logDirtyVCSMessage();
					tree.print({
                        prefix: " "
                    });
			        // TODO: Make command/plugin to open packages with configurable via ~/.sm/config.json`.
			        var deferred = Q.defer();
		            tree.getPlugin("stree", function(err, plugin) {
		            	if (err) return deferred.reject(err);
                        return plugin.save(tree, options).then(deferred.resolve, deferred.reject);
                    });
                    return deferred.promise;
                }
            }).then(function() {
            	if (loggedDirtyVCSMessage) {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("  \0magenta(After VCS commit run: \0bold(sm save\0)\0)");
                    TERM.stdout.writenl("");
            	} else {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("  \0yellow(No packages with dirty VCS found!\0)");
	                TERM.stdout.writenl("  \0yellow(Looks like you are ready to: \0bold(sm publish\0)\0)");
                    TERM.stdout.writenl("");
            	}
            });
		});
	}

	self.run = function(options) {
		var opts = UTIL.copy(options);
		opts.format = "JSON";
		opts.select = ".";
		return self.status(opts).then(function(nodes) {
			if (nodes[0].descriptor.package &&
				nodes[0].descriptor.package.scripts &&
				nodes[0].descriptor.package.scripts.run
			) {
				// TODO: Refactor to generic script runner module.
				// e.g. `./node_modules/app-node-webkit/bin/nw .`.
				var command = null;
				if (/^\.\//.test(nodes[0].descriptor.package.scripts.run)) {
					// We want to run a script relative to package.
					command = PATH.join(nodes[0].path, nodes[0].descriptor.package.scripts.run);
				} else {
					// e.g. `node server.js`
					command = nodes[0].descriptor.package.scripts.run;
				}
				var opts = UTIL.copy(options);
				opts.cwd = nodes[0].path;
				opts.returnOutput = (opts.format === "JSON") ? true : false;
				opts.env = UTIL.copy(process.env);

		        var pinf = PINF.forProgram(opts.cwd)(opts.cwd);

		        pinf.augmentEnv(opts.env, {
		        	inline: options.inline || false,
		        	mode: options.mode || "production"
		        });

				return OS.spawnInline(command.split(" ")[0], command.split(" ").slice(1), opts);
//                TERM.stdout.writenl("\0red(ERROR: Unable to call script '" + nodes[0].descriptor.package.scripts.run + "'.\0)");
//	            throw true;
			} else {
                TERM.stdout.writenl("\0red(ERROR: No `run` script found in package descriptor for package '" + nodes[0].path + "'.\0)");
	            throw true;
			}
		});
	}

	// TODO: Add tests for this.
	// TODO: Teach `TERM` to buffer output so we can return if `options.format === "JSON"`.
	self.help = function(options) {
		options.format = "JSON";
		options.levels = 0;
		return self.status(options).then(function(topPackage) {

	        var help = topPackage.descriptor.package.help;

	        if (!help) {
                TERM.stdout.writenl("\0yellow(No `help` property found in package descriptor for package '" + topPackage.path + "'.\0)");
	            throw true;
	        }
	        
	        if (typeof help === "string") {
	            if (/^.\//.test(help)) {
	                help = {
	                    cli: help
	                };
	            } else {
	                help = {
	                    web: help
	                };
	            }
	        }

	        TERM.stderr.writenl("\n\0yellow(" + "  \0bold(Package Path :\0) " + topPackage.path);

	        if (help.web) {
	            TERM.stderr.writenl("\0bold(      Web help :\0) " + help.web + "\n");
	        }

	        TERM.stderr.writenl("");
	        
	        if (help.cli) {

	            // TODO: Allow for remote URIs.

	            help.cli = PATH.join(topPackage.path, help.cli);

	            if (/\.js$/.test(help.cli)) {

	                var helpScript = require(help.cli);

	                if (typeof helpScript.main === "function") {
	                    helpScript.main({
	                        TERM: TERM
	                    });
	                }

	            } else
	            if (/\.md$/.test(help.cli)) {

	                var readme = FS.readFileSync(help.cli).toString();

	                TERM.stdout.writenl("  " + readme.replace(/(^\n*|\n*$)/g, "").split("\n").join("\n  "));
	            } else {
	                throw new Error("TODO: Exec '" + help.cli + "'.");
	            }
	        }

	        TERM.stderr.writenl("\0)\n");
	    });
	}

	self.info = function(id, options) {
		// TODO: Don't just display info for installed packages but also lookup package online if not in tree.
		var opts = UTIL.copy(options);
		opts.select = id;
		opts.format = "JSON";
		var infos = [];
		return self.status(opts).then(function(nodes) {
			nodes.forEach(function(node) {
				// TODO: Convert `node.summary` to serializable JSON structure.
				var info = UTIL.copy(node.summary);
				// TODO: Add more info?
				infos.push(info);
			});
		}).then(function() {
			if (options.format === "JSON") return infos;
			if (infos.length === 0) {
			    TERM.stdout.writenl("");
			    TERM.stdout.writenl("  \0yellow(No packages found for name/relpath '" + id + "'.\0)");
			    TERM.stdout.writenl("");
			    throw true;
			}
			infos.forEach(function(info) {
			    TERM.stdout.writenl("");
			    TERM.stdout.writenl("  \0yellow(name:\0) " + info.name);
			    TERM.stdout.writenl("  \0yellow(path:\0) " + info.path);
			    TERM.stdout.writenl("  \0yellow(installed:\0) " + ((info.installed)?"yes":"no"));
			    // TODO: Add more info to display.

			    var pinf = PINF.forProgram({
					CWD: info.path,
					strict: false
				})(info.path);
			    TERM.stdout.writenl("  \0yellow(PINF Config:\0) ");
				console.log(pinf.config());
			    TERM.stdout.writenl("  \0yellow(PINF Credentials:\0) ");
				console.log(pinf.credentials());
			});
		    TERM.stdout.writenl("");
		});
	}

	// TODO: Add tests for this.
	// TODO: Add support for `options.format === "JSON"`.
	self.report = function(options) {
	    var done = Q.resolve();

	    TERM.setIndent(4, " ");

	    TERM.stdout.writenl("");

	    done = Q.when(done, getUname).then(function(uname) {
	        TERM.stdout.writenl("\0white(\0bold(`" + uname[0] +"`: " + "\0)" + uname[1] + "\0)");
	    });    
	    done = Q.when(done, getGitVersion).then(function(version) {
	        TERM.stdout.writenl("\0white(\0bold(`" + version[0] +"`: " + "\0)" + version[1] + "\0)");
	    });
	    done = Q.when(done, getSmVersion).then(function(version) {
	        TERM.stdout.writenl("\0white(\0bold(`" + version[0] +"`: " + "\0)" + version[1] + "\0)");
	    });
	    done = Q.when(done, getNpmVersion).then(function(version) {
	        TERM.stdout.writenl("\0white(\0bold(`" + version[0] +"`: " + "\0)" + version[1] + "\0)");
	    });

	    done = Q.when(done, getNpmVersion).then(function(version) {
	        TERM.stdout.writenl("\0white(\0bold(" + "process.version" +": " + "\0)" + process.version + "\0)");
	        TERM.stdout.writenl("\0white(\0bold(" + "process.arch" +": " + "\0)" + process.arch + "\0)");
	        TERM.stdout.writenl("\0white(\0bold(" + "process.platform" +": " + "\0)" + process.platform + "\0)");
	    });

	    return Q.when(done, function() {

	        TERM.stdout.writenl("");
	        TERM.stdout.writenl("\0white(\0bold(" + "`sm status -a`: " + "\0)\0)");

			options.format = "JSON";
			options.all = true;
			return self.status(options);
	    });

		function getSmVersion() {
		    var deferred = Q.defer();
		    var command = "sm --version";
		    // TODO: Use `OS.exec`.
		    EXEC(command, function(error, stdout, stderr) {
		        if (error) {
		            console.error(stderr);
		            return deferred.reject(new Error("Error calling command: " + command));
		        }
		        deferred.resolve([command, stdout.replace(/\s*\n$/, "")]);
		    });
		    return deferred.promise;
		}

		function getGitVersion() {
		    var deferred = Q.defer();
		    var command = "git --version";
		    // TODO: Use `OS.exec`.
		    EXEC(command, function(error, stdout, stderr) {
		        if (error || stderr) {
		            console.error(stderr);
		            return deferred.reject(new Error("Error calling command: " + command));
		        }
		        deferred.resolve([command, stdout.replace(/^git version |\s*\n$/g, "")]);
		    });
		    return deferred.promise;
		}

		function getNpmVersion() {
		    var deferred = Q.defer();
		    var command = "npm --version";
		    // TODO: Use `OS.exec`.
		    EXEC(command, function(error, stdout, stderr) {
		        if (error || stderr) {
		            console.error(stderr);
		            return deferred.reject(new Error("Error calling command: " + command));
		        }
		        deferred.resolve([command, stdout.replace(/\s*\n$/, "")]);
		    });
		    return deferred.promise;
		}

		function getUname() {
		    var deferred = Q.defer();
		    var command = "uname -a";
		    // TODO: Use `OS.exec`.
		    EXEC(command, function(error, stdout, stderr) {
		        if (error || stderr) {
		            console.error(stderr);
		            return deferred.reject(new Error("Error calling command: " + command));
		        }
		        deferred.resolve([command, stdout.replace(/\s*\n$/, "")]);
		    });
		    return deferred.promise;
		}
	}

	// TODO: Add support for `options.format === "JSON"`.
	self.test = function(options) {
		var opts = UTIL.copy(options);
		// TODO: Add support for `options.recursive` to run all tests down the tree.
		opts.select = ".";
		opts.format = "JSON";
		return self.status(opts).then(function(nodes) {
			var done = Q.resolve();
			nodes.forEach(function(node) {
				done = Q.when(done, function() {
					var deferred = Q.defer();
		            node.getPlugin(node.summary.pm.install, function(err, plugin) {
		            	if (err) return deferred.reject(err);
		                return plugin.test(node, options).then(deferred.resolve, deferred.reject);
		            });
		            return deferred.promise;
				});
			});
			return done;
		});
	}

	return self;
}
