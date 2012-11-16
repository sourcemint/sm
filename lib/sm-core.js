
const PATH = require("path");
const EXEC = require("child_process").exec;
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const OS = require("sourcemint-util-js/lib/os");
const URI_PARSER = require("./uri-parser");
const PLUGIN = require("sm-plugin");
const SCANNER = require("./scanner");
const STATUS = require("./status");


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

	var scanner = SCANNER.for(packageRootPath);
	// TODO: Do this via an event so we can have multiple listeners.
	scanner.onNewNode = function(node) {
		node.getPlugin = function(pluginName) {
			return self.getPlugin({
				Q: Q,
				UTIL: UTIL,
				TERM: TERM,
				URI_PARSER: URI_PARSER
			}, node, pluginName);
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
console.log("options", options);			
			return status.embellishFsTree(tree, options).then(function() {
				if (options.format === "JSON") return tree;

			    var topNode = null;
			    var printOptions = {
			    	mode: "tree"
			    };

	            tree.traverse(function(node) {


			        if (topNode === null) {
			            topNode = node;
			        }

			        // Don't go deeper than first level if we don't want to see all and there are no errors or updates in children.
/*
			        if (
			            options.all !== true && node.level > 1 &&
			            !node.status.deepStatus.errors &&
			            !node.status.deepStatus.vcs &&
			            ((!node.status.deepStatus.newLocator && !node.status.deepStatus.newOutLocator) || node.status.status.inParent)
			        ) {
			            return false;
			        }
*/
			        node.print(printOptions);

			        // Don't go deeper if no deep errors found (deep newOutLocator may be present) and we had a newOutLocator ourself.
			        // We only want to show the first newOutLocator and ignore all below (if no errors) (as they will likely update if parent updates
			        // and parent needs to be updated first anyway).
/*
			        if (
			            options.all !== true && node.level >= 1 &&
			            !node.status.deepStatus.errors &&
			            !node.status.deepStatus.newLocator &&
			            node.status.status.newOutLocator
			        ) {
			            return false;
			        }	            	
*/
	            });

/*
		        if (printOptions.displayHints) {
		            var hints = [];
		            for (var type in printOptions.displayHints) {
		                for (var key in printOptions.displayHints[type]) {
		                    hints.push([key, printOptions.displayHints[type][key]]);
		                }
		            }
		            TERM.stdout.writenl("");
		            [
		                // TODO: More finer-graid ordering to provide suggestions as to what to do first.
		                ["red", "MISSING"],
		                ["red", "UNDECLARED"],
		                ["red", "bold"],
		                ["red", "normal"],
		                ["magenta", "bold"],
		                ["magenta", "normal"],
		                false
		            ].forEach(function(filter) {
		                for (var i=0 ; i<hints.length ; i++) {
		                    if (!filter || (hints[i][0].indexOf(filter[0]) !== -1 && hints[i][0].indexOf(filter[1]) !== -1)) {
		                        TERM.stdout.writenl("  " + hints[i][1]);
		                        hints.splice(i, 1);
		                        i--;
		                    }
		                }
		            });
		            TERM.stdout.writenl("");
		        }

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

	        // TODO: Make command to open packages with configurable via ~/.sourcemint/config.json`.
	        return OS.which("stree").then(function(streePath) {
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
	                    if (streePath) {
	                        var done = Q.when();
	                        dirty.forEach(function(node) {
	                            done = Q.when(done, function() {
	                                return OS.exec(streePath + " " + node.path);
	                            });
	                        });
	                        return done;
	                    } else {
	                        TERM.stdout.writenl("  \0cyan(If you install `stree` http://www.SourcetreeApp.com (no affiliation with sourcemint)\0)");
	                        TERM.stdout.writenl("  \0cyan(these packages will be automatically opened for you to commit.\0)");
	                        TERM.stdout.writenl("");
	                    }
	                }
	            });
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
