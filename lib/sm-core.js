
const PATH = require("path");
const EXEC = require("child_process").exec;
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const OS = require("sourcemint-util-js/lib/os");
const URL_PROXY_CACHE = require("sourcemint-util-js/lib/url-proxy-cache");
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");
const SEMVER = require("semver");
const URI_PARSER = require("./uri-parser");
const PLUGIN = require("sm-plugin");
const SCANNER = require("./scanner");
const STATUS = require("./status");
const HELPERS = require("./helpers");


process.on("uncaughtException", function (err) {
    // NOTE: `err.stack` seems to be useless here.
    TERM.stderr.writenl("\0red(UNCAUGHT EXCEPTION: " + err + "\0)");
});


var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new SMCore(packageRootPath);
	}
	return instances[packageRootPath];
}


var SMCore = function(packageRootPath) {
	var self = this;

	var homeBasePath = PATH.join(process.env.HOME, ".sourcemint");

	var scanner = SCANNER.for(packageRootPath);
	// TODO: Do this via an event so we can have multiple listeners.
	scanner.onNewNode = function(node) {
		node.getPlugin = function(pluginName) {
			return self.getPlugin({
				HELPERS: HELPERS,
				Q: Q,
				UTIL: UTIL,
				TERM: TERM,
				URI_PARSER: URI_PARSER,
				URL_PROXY_CACHE: URL_PROXY_CACHE,
				FS_RECURSIVE: FS_RECURSIVE,
				SEMVER: SEMVER,
				OS: OS
			}, node, pluginName);
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
	}
	var status = STATUS.for(packageRootPath);

	self.getPlugin = PLUGIN.for;

	self.require = function(uri) {

//console.log("REQUIRE", uri);

		return Q.resolve({
			id: "module1"
		});

		return Q.ref();
	}

	self.status = function(options) {
		return scanner.fsTree(options).then(function(tree) {
			if (options.loadStatus === false) {
				return tree;
			}

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

/*
		        if (options.command === "edit") {
		            TERM.stdout.writenl("  \0green(Package setup for editing.\0)\n");
		        } else
		        if (options.command === "install") {
		            if (printOptions.actionHints.install) {
		                // NOTE: This message could be more specific as not all red will cause install to fail.
		                TERM.stdout.writenl("  \0red(ERROR: Found \0bold(red\0) after install. Try re-running: \0bold(sm install\0)\0)\n");
		                return Q.reject(true);
		            } else {
		                TERM.stdout.writenl("  \0green(\0bold(All good!\0) Nothing [more] to install.\0)\n");
		            }
		        } else
		        if (options.command === "update") {
		            if (printOptions.actionHints.install || printOptions.actionHints.update) {
		                TERM.stdout.writenl("  \0red(ERROR: Found \0bold(red\0) after update. Try re-running: \0bold(sm update\0)\0)\n");
		                return Q.reject(true);
		            } else {
		                TERM.stdout.writenl("  \0green(\0bold(All good!\0) Nothing [more] to update.\0)\n");
		            }
		        } else
		        if (options.command === "clone") {
		            if (options.install === true && printOptions.actionHints.install) {
		                TERM.stdout.writenl("  \0red(ERROR: Found \0bold(red\0) after cloning. Try running `\0bold(sm install\0)` in the cloned directory.\0)\n");
		                return Q.reject(true);
		            } else {
		                TERM.stdout.writenl("  \0green(\0bold(All good!\0) Cloned successfully.\0)\n");
		            }
		        } else {
		            if (printOptions.actionHints.install || printOptions.actionHints.update) {
		                return Q.reject(true);
		            } else {
		                TERM.stdout.writenl("  \0green(\0bold(All good!\0) Use `status -n` to fetch & display latest remote info.\0)\n");
		            }
		        }
*/
			});
		});
	}

	self.fix = function(options) {
		options.format = "JSON";
		return self.status(options).then(function(tree) {

            var dirty = [];
            var done = Q.ref();
            tree.traverse(function(node) {
                if (node.circular) return false;
                // TODO: Use `node.summary.vcs`.
                if (node.status.git && node.status.git.dirty) {
                    dirty.push(node);
                }
            });
            return Q.when(done, function() {
                if (dirty.length === 0) {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("  \0yellow(No packages with \0red([\0bold(dirty\0)]\0) VCS found!\0)");
                    TERM.stdout.writenl("  \0yellow(Looks like you are ready to: \0bold(sm save\0)\0)");
                    TERM.stdout.writenl("");
                } else {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("\0bold(Found packages with dirty VCS:\0)");
                    TERM.stdout.writenl("");
                    dirty.forEach(function(node) {
                        node.print({
                            prefix: " "
                        });
                    });
                    TERM.stdout.writenl("");

                    var done = Q.when();
                    dirty.forEach(function(node) {
                        done = Q.when(done, function() {
					        // TODO: Make command/plugin to open packages with configurable via ~/.sourcemint/config.json`.
				            return node.getPlugin("stree").then(function(plugin) {
	                            return plugin.fix(node, options);
	                        });
                        });
                    });
                    return done;
                }
            });
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
                TERM.stdout.writenl("\0yellow(No 'help' property found in package descriptor for package '" + topPackage.path + "'.\0)");
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

	return self;
}
