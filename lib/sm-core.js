
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
			return status.embellishFsTree(tree, options).then(function() {

//console.log(options);
//console.log(tree);

				return tree;
			});
		});
	}

	self.fix = function(options) {
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

	return self;
}
