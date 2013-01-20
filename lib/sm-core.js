
const PATH = require("path");
const FS = require("fs");
const EXEC = require("child_process").exec;
const Q = require("sm-util/lib/q");
const UTIL = require("sm-util/lib/util");
const TERM = require("sm-util/lib/term");
const OS = require("sm-util/lib/os");
const URL_PROXY_CACHE = require("sm-util/lib/url-proxy-cache");
const FS_RECURSIVE = require("sm-util/lib/fs-recursive");
const JSON_STORE = require("sm-util/lib/json-store").JsonStore;
const SEMVER = require("semver");
const MAPPINGS = require("mappings");
const HTTP_PROXY = require("http-proxy");
const URI_PARSER = require("./uri-parser");
const PLUGIN = require("sm-plugin");
const SCANNER = require("./scanner");
const STATUS = require("./status");
const HELPERS = require("./helpers");
const CONFIG = require("./config");
const PROFILE = require("./profile");
const LOCATOR = require("./locator");
const SM_NODE_SERVER = require("sm-node-server");


process.on("uncaughtException", function (err) {
    // NOTE: `err.stack` seems to be useless here.
    TERM.stderr.writenl("\0red(UNCAUGHT EXCEPTION: " + err + "\0)");
});


const API = {
	HELPERS: HELPERS,
	Q: Q,
	UTIL: UTIL,
	TERM: TERM,
	URI_PARSER: URI_PARSER,
	URL_PROXY_CACHE: URL_PROXY_CACHE,
	PATH: PATH,
	FS: FS,
	FS_RECURSIVE: FS_RECURSIVE,
	SEMVER: SEMVER,
	OS: OS,
	HTTP_PROXY: HTTP_PROXY,
	JSON_STORE: JSON_STORE,
	SM_NODE_SERVER: SM_NODE_SERVER,
	SM_CORE: exports
};
CONFIG.setAPI(API);
PROFILE.setAPI(API);
var instances = {};


exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new SMCore(packageRootPath);
	}
	return instances[packageRootPath];
}


var SMCore = function(packageRootPath) {
	var self = this;

	var homeBasePath = process.env.SM_HOME || PATH.join(process.env.HOME, ".sm");

	var config = CONFIG.for(homeBasePath);
	var profile = null;

	var scanner = SCANNER.for(packageRootPath);
	// TODO: Do this via an event so we can have multiple listeners.
	scanner.onNewNode = function(node) {
		node.getPlugin = function(pluginName) {
			return self.getPlugin(API, self, node, pluginName);
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
			if (!PATH.existsSync(PATH.dirname(path))) {
		        FS_RECURSIVE.mkdirSyncRecursive(PATH.dirname(path));
			}
			return path;
		}
	    node.refresh = function(options) {
	    	options = UTIL.copy(options);
	    	options._onNewNode = scanner.onNewNode;
	        options.logger.debug("Refreshing node `" + node.path + "`.");
	        var deferred = Q.defer();
	        node.initForPath(node.path, options, function(err) {
	            if (err) return deferred.reject(err);
	            return STATUS.for(node.path).embellishFsTree(node, options).then(function() {
	                return node;
	            }).then(deferred.resolve, deferred.reject);
	        });
	        return deferred.promise;
	    }		
	}
	var status = STATUS.for(packageRootPath);

	self.__init = function(program) {
		return Q.call(function() {
			return config.__init(program).then(function() {
				// TODO: Adjust profile based on `--profile` flag.
				profile = PROFILE.for(PATH.join(config.get(["paths", "profiles"]), config.get(["profile"])));
				return profile.__init(program);
			});
		});
	}

	self.getConfig = function(ns) {
		return config.get(ns);		
	}

	self.getProfile = function(ns) {
		if (ns === "name") {
			return profile.getName();
		}
		throw new Error("Cannot get profile info for unknown property: " + ns);
	}

	self.getCredentials = function(ns) {
		return profile.getCredentials(ns);		
	}
	self.setCredentials = function(ns, value) {
		return profile.setCredentials(ns, value);		
	}

	self.getPlugin = PLUGIN.for;

	self.resolve = function(id, options) {
		options = options || {};
		try {
			function load() {

				var path = MAPPINGS.for(packageRootPath).resolve(id, true);

				options.logger.debug("Resolved id `" + id + "` to path `" + path + "`");

				if (path) {
					if (!PATH.existsSync(path)) {
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
			opts.select = idParts.shift();
			opts.format = "JSON";
			return self.status(opts).then(function(nodes) {
				if (nodes.length === 0) {
					throw new Error("Package not found and not declared!");
				}
				if (nodes.length > 1) {
					throw new Error("Found more than one package! We should never get here.");
				}
				if (nodes[0].summary.installed) {
					throw new Error("Package already installed! We should never get here.");
				}
				var opts = UTIL.copy(options);
				opts.dynamic = true;
				return nodes[0].install(opts).then(function(node) {
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

	self.status = function(options) {
		return scanner.fsTree(options).then(function(tree) {
			return status.embellishFsTree(tree, options).then(function() {
				// TODO: Generate JSON tree by calling `tree.toJSON()`.
				if (options.format === "JSON") return tree;

			    var printOptions = {
			    	mode: "tree",
			    	info: options.info || false
			    };

				TERM.stdout.writenl("");

	            tree.traverse(function(node) {

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

			        // If optional and not installed we don't show it.
			        if (node.summary.optional && !node.summary.installed) return false;

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
			});
		});
	}

	self.init = function(uri, options) {

		var deferred = Q.defer();

		options.logger.debug("Init `" + packageRootPath + "` with `" + uri + "`.");

		if (PATH.existsSync(packageRootPath)) {
			if (FS.readdirSync(packageRootPath).length > 0) {
				if (options.delete) {
					options.logger.debug("Deleting existing: " + packageRootPath);
					// TODO: Don't delete top dir.
					FS_RECURSIVE.rmdirSyncRecursive(packageRootPath);
					FS.mkdirSync(packageRootPath);
				} else {
	                TERM.stdout.writenl("\0red([sm] ERROR: Directory '" + packageRootPath + "' not empty! Use `--delete` to overwrite.\0)");
					return deferred.resolve(true);
				}
			}
		} else {
			FS_RECURSIVE.mkdirSyncRecursive(packageRootPath);
		}

		FS.mkdirSync(PATH.join(packageRootPath, ".sm"));
		FS.writeFileSync(PATH.join(packageRootPath, ".sm", "source.json"), JSON.stringify({
			locator: {
				pointer: uri
			}
		}));

		return scanner.fsTree(options).then(function(tree) {
			return status.embellishFsTree(tree, options).then(function() {
				var opts = UTIL.copy(options);
				opts.noBackup = true;
				return tree.install(opts).then(function() {
					if (options.switch) {
						return self.switch(options);
					}
				});
			});
		});

		return deferred.promise;
	}

	self.switch = function(options) {
		var opts = UTIL.copy(options);
		opts.select = ".";
		opts.format = "JSON";
		return self.status(opts).then(function(nodes) {
			function runScript(name) {
				if (
					!nodes[0].descriptors.package ||
					!nodes[0].descriptors.package.scripts ||
					!nodes[0].descriptors.package.scripts[name]
				) {
					return;
				}
				try {
					var command = HELPERS.makeNodeCommanFromString(nodes[0].descriptors.package.scripts[name]).split(" ");
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
				activateTpl = activateTpl.replace(/__SM_WORKSPACE_HOME__/g, nodes[0].path);
				activateTpl = activateTpl.replace(/__SM_WORKSPACE_NAME__/g, nodes[0].name);
				FS.writeFileSync(PATH.join(packageRootPath, ".sm-activate-workspace"), activateTpl);
				FS.chmodSync(PATH.join(packageRootPath, ".sm-activate-workspace"), 0755);
				if (process.env.SM_WORKSPACE_HOME) {
	                TERM.stdout.writenl("\0red([sm] ERROR: Cannot switch workspace while in workspace. You must 'exit' workspace first.\0)");
					return Q.reject(true);
				}
				FS.writeFileSync(PATH.join(packageRootPath, ".sm-switch"), PATH.join(packageRootPath, ".sm-activate-workspace"));
				FS.chmodSync(PATH.join(packageRootPath, ".sm-switch"), 0755);
			}
		});
	}

	self.try = function(uri, options) {
		return Q.call(function() {
			var tryPath = PATH.join(self.getConfig(["paths", "try"]), HELPERS.uriToPath(uri).replace(/^https?\//, ""));
			if (!PATH.existsSync(tryPath)) {
				FS_RECURSIVE.mkdirSyncRecursive(tryPath);
			}
			var core = exports.for(tryPath);
			return core.__init({}).then(function() {
				var opts = UTIL.copy(options);
				opts.switch = true;
				return core.init(uri, opts).then(function() {
					if (PATH.existsSync(PATH.join(tryPath, ".sm-switch"))) {
						FS.renameSync(PATH.join(tryPath, ".sm-switch"), PATH.join(packageRootPath, ".sm-switch"));
					}
				});
			});
		});
	}

	self.export = function(path, options) {
		var opts = UTIL.copy(options);
		opts.format = "JSON";
		return self.status(opts).then(function(topPackage) {
	        return topPackage.getPlugin("sm").then(function(plugin) {
	            return plugin.export(path, options);
	        });
		});
	}

	self.bump = function(options) {
		var opts = UTIL.copy(options);
		opts.format = "JSON";
		opts.levels = 0;
		return self.status(opts).then(function(topPackage) {
	        return topPackage.getPlugin(topPackage.summary.pm.locator).then(function(plugin) {

	        	// TODO: Only call if `node.hints.actions.bump` is set. (not dirty, etc...)

	            return plugin.bump(options);
	        }).then(function() {
	        	if (options.publish) {
	        		return self.publish(options);
	        	}
	        });
		});
	}

	self.publish = function(options) {
		options.format = "JSON";
		options.levels = 0;
		return self.status(options).then(function(topPackage) {

        	// TODO: Only call if `node.hints.actions.publish` is set. (not dirty, etc...)

			var done = API.Q.ref();

			if (topPackage.summary.vcs) {
				done = Q.when(done, function() {
					return topPackage.getPlugin(topPackage.summary.vcs.type).then(function(pm) {

		                TERM.stdout.writenl("Pushing changes for vcs: " + topPackage.summary.vcs.type);

						return pm.publish(options);
					});
				});
			}

			return Q.when(done, function() {
				// If a publish script is specified we call it instead of the `topPackage.summary.pm.locator || topPackage.summary.pm.install`.
	        	if (topPackage.summary.scripts.publish) {

	        		// TODO: Use generic script executer here.
	        		// ASSUMES: `<script> ...`.

	                TERM.stdout.writenl("Running `publish` script: " + topPackage.summary.scripts.publish);

	        		var command = topPackage.summary.scripts.publish.split(" ");
	        		var opts = UTIL.copy(options);
	        		opts.cwd = topPackage.path;
	        		return OS.spawnInline(command.shift(), command, opts);

	        	} else {
					return Q.when(done, function() {
						return topPackage.getPlugin(topPackage.summary.pm.locator || topPackage.summary.pm.install).then(function(pm) {

			                TERM.stdout.writenl("Running publish for pm: " + pm.pluginId);

							return pm.publish(options);
						});
					});
	        	}
			});
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
			return OS.spawnInline(command.shift(), command, opts);
		});
	}

	self.install = function(options) {
		var installed = {};
		options.format = "JSON";
		// TODO: Add support for `options.selector`.
		return self.status(options).then(function(tree) {
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
						node.install(options).then(function(node) {
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
			return traverse(tree).then(function() {
				return tree.install(options).then(function(node) {
					tree.print();
					return traverse(tree);
				});
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
            var done = Q.ref();
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
			            return node.getPlugin("stree").then(function(plugin) {
                            return plugin.save(node, options);
                        });
                    });
                });
            }
            return Q.when(done, function() {
	            // Now update `sm-catalog.json`.
	            if (dirty.length > 0) return;
	            var done = Q.ref();
	            var changed = [];
	            tree.traverse(function(node) {
	                if (node.circular) return false;

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
									return node.top.catalogs["sm-catalog"].updatePackage(node.relpath, {
										pointer: node.hints.actions.save[1].getLocation("pointer")
									});

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
		            return tree.getPlugin("stree").then(function(plugin) {
                        return plugin.save(tree, options);
                    });
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
		options.format = "JSON";
		options.levels = 0;
		return self.status(options).then(function(topPackage) {
			if (topPackage.descriptors.package &&
				topPackage.descriptors.package.scripts &&
				topPackage.descriptors.package.scripts.run
			) {
				// TODO: Refactor to generic script runner module.
				// e.g. `./node_modules/app-node-webkit/bin/nw .`.
				var command = null;
				if (/^\.\//.test(topPackage.descriptors.package.scripts.run)) {
					// We want to run a script relative to package.
					command = PATH.join(topPackage.path, topPackage.descriptors.package.scripts.run);
				} else {
					// e.g. `node server.js`
					command = topPackage.descriptors.package.scripts.run;
				}
				var opts = UTIL.copy(options);
				opts.cwd = topPackage.path;
				opts.returnOutput = true;
				return OS.spawnInline(command.split(" ")[0], command.split(" ").slice(1), opts);
//                TERM.stdout.writenl("\0red(ERROR: Unable to call script '" + topPackage.descriptors.package.scripts.run + "'.\0)");
//	            throw true;
			} else {
                TERM.stdout.writenl("\0red(ERROR: No `run` script found in package descriptor for package '" + topPackage.path + "'.\0)");
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

	        var help = topPackage.descriptors.package.help;

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
			});
		    TERM.stdout.writenl("");
		});
	}

	// TODO: Add tests for this.
	// TODO: Add support for `options.format === "JSON"`.
	self.report = function(options) {
	    var done = Q.ref();

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
			var done = Q.ref();
			nodes.forEach(function(node) {
				done = Q.when(done, function() {
		            return node.getPlugin(node.summary.pm.install).then(function(plugin) {
		                return plugin.test(node, options);
		            });
				});
			});
			return done;
		});
	}

	return self;
}
