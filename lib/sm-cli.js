
const PATH = require("path");
const FS = require("fs");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const OS = require("sourcemint-util-js/lib/os");
const EXEC = require("child_process").exec;
const SPAWN = require("child_process").spawn;
const COMMANDER = require("commander");
const SM_CORE = require("./sm-core");
const LOGGER = require("./logger");

const COMMAND_NAME = "sm";


exports.for = function(packageRootPath) {
	return new SM(packageRootPath);
}


var SM = function(packageRootPath) {
	var self = this;

	var core = SM_CORE.for(packageRootPath);

	var program = new COMMANDER.Command();

	function makeOptions(extra) {
	    var opts = {
	    	verbose: program.debug || program.verbose || false,
	    	debug: program.debug || false,
	    	time: Math.floor(Date.now()/1000),
	    	now: program.now || false,
//	    	"dry-run": options["dry-run"] || false,
	    	format: program.format
	    };
	    if (extra) {
	    	UTIL.update(opts, extra);
	    }
	    if (!opts.logger) {
	    	opts.logger = LOGGER.forOptions(opts);
	    }
	    return opts;
	}

	var callPromise = null;
	var calling = false;

	// TODO: Add usage coloring.
	program
		.version(JSON.parse(FS.readFileSync(PATH.join(__dirname, "../package.json"))).version)
		// TODO: Add masthead.
		/*
	    .masthead([
	        "\0magenta(------------------ sourcemint.org ------------------",
	        "|    \0bold(`sm` - Sourcemint Open Source Tooling\0)         |",
	        "|         ~ Package Management. Evolved. ~         |",
	        "|   News   : twitter.com/sourcemint                |",
	        "|   Discuss: groups.google.com/group/sou\rcemint    |",
	        "|   Source : github.com/sourcemint/sm-npm          |",
	        "|   Bugs   : github.com/sourcemint/sm-npm/issues   |",
	        "|   \0bold(DOCS\0)   : bit.ly/sm-wiki                        |",
	        "----- (c) 2012+ Christoph Dorn -- License: MIT -----\0)"
	    ].join("\n"));
		*/
		.option("-n, --now", "Aggressively fetch latest remote info.")
		.option("--dir <path>", "Path to package.")
		.option("--format <format>", "Output format.")
		.option("--install-command", "Install `sm` command in PATH.")
		.option("--install-npm", "Install latest `npm`.")
		.option("-v, --verbose", "Show verbose progress.")
		.option("--debug", "Show extra verbose progress.");

	var originalOutputHelp = program.outputHelp;
	program.outputHelp = function() {
		if (!calling && program.rawArgs.length === 2) {
        	calling = true;
        	core.status(makeOptions({
        		all: false,
        		info: false,
        		dev: false
        	})).then(callPromise.resolve, callPromise.reject);
		} else {
			originalOutputHelp.call(program);
		}
	}

	program
		// TODO: Add short command `s` to parser and usage info.
		.command("status")
		.description("Display package status.")
		.option("-a, --all", "Show transitive dependencies (dependencies of dependencies).")
		.option("-i, --info", "Show extra info.")
		.option("-d, --dev", "Show transitive dev dependencies.")
        .action(function(options) {
        	calling = true;
        	core.status(makeOptions({
        		all: options.all || false,
        		info: options.info || false,
        		dev: options.dev || false
        	})).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("init <uri>")
		.description("Initialize a package by pulling code from a URI.")
		.option("--delete", "Empty out `--dir` if it already has files in it.")
		.option("--dev", "Initialize package in write mode.")
		.option("--cache", "Clone from local cache if available (will not aggressively fetch latest remote info).")
		.option("-s, --switch", "Switch to package workspace after init.")
        .action(function(uri, options) {
        	calling = true;
        	core.init(uri, makeOptions({
        		delete: options.delete || false,
        		keepTopVcs: options.dev || false,
        		now: !options.cache,
        		switch: options.switch || false,
        	})).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("switch")
		.description("Switch to and activate the workspace for a package.")
		.option("--start-workspace", "Start workspace for package.")
		.option("--stop-workspace", "Stop workspace for package.")
        .action(function(options) {
        	calling = true;
        	core.switch(makeOptions({
        		startWorkspace: options.startWorkspace,
        		stopWorkspace: options.stopWorkspace
        	})).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("install")
		.description("Install package and required dependencies.")
        .action(function() {
        	calling = true;
        	core.install(makeOptions()).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("try <uri>")
		.description("Quickly install and siwtch to the package to try it out.")
		.option("--cache", "Clone from local cache if available (will not aggressively fetch latest remote info).")
        .action(function(uri, options) {
        	calling = true;
        	core.try(uri, makeOptions({
        		now: !options.cache
        	})).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("save")
		.description("Commit all changes and freeze dependency tree by writing `sm-catalog.json`.")
        .action(function() {
        	calling = true;
        	core.save(makeOptions()).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("report")
		.description("Display detailed report for program (package and dependencies).")
        .action(function() {
        	calling = true;
        	core.report(makeOptions()).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("info [name|relpath]")
		.description("Display detailed information for package.")
        .action(function(arg) {
        	calling = true;
        	core.info(arg || ".", makeOptions()).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("test")
		.description("Run tests for package.")
		.option("--cover", "Enable test coverage.")
        .action(function(options) {
        	calling = true;
        	core.test(makeOptions({
        		cover: options.cover || false
        	})).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("help")
		.description("Help for package")
        .action(function() {
        	calling = true;
        	core.help(makeOptions()).then(callPromise.resolve, callPromise.reject);
        });

	self.respond = function(args) {
		function respond(args, expanded) {

			var dirIndex = args.indexOf("--dir");
			if (dirIndex !== -1) {
				var path = PATH.resolve(args[dirIndex + 1]);
				args.splice(dirIndex, 2);
				return exports.for(path).respond(args);
			}

			callPromise = Q.defer();

			return core.__init(program).then(function() {

				program.parse(args);

				if (program.installCommand) {
					installCommand().then(callPromise.resolve, callPromise.reject);
				} else
				if (program.installNpm) {
					installNpm().then(callPromise.resolve, callPromise.reject);
				} else
				if (!calling) {
					if (program.rawArgs.length > 2) {
						TERM.stderr.writenl("\n  \0red(BAD ARGUMENT: " + program.rawArgs.slice(2).join(" ") + "\0)");
					}
					program.outputHelp();
				}

			}).fail(callPromise.reject).then(function() {

				return Q.when(callPromise.promise, function(result) {
					calling = false;
					return result;
				}, function(err) {
					calling = false;
					if (err === true) {
						err = new Error("Exit silently (look for printed error above)");
					}
					throw err;
				});

			});
		}
		return respond(args);
	}

	self.status = core.status.bind(self);

	return self;
}


function installCommand() {

	var COMMAND_PATH = PATH.join(__dirname, "../bin/sm-cli");
    var commandPath = null;

	return Q.call(function() {

        var binPath = getBinPath();

        commandPath = PATH.join(binPath, COMMAND_NAME);

        function finalVerify() {
			var deferred = Q.defer();
            EXEC("which " + COMMAND_NAME, function(error, stdout, stderr) {
                if (error) {
                    return deferred.reject(new Error("`which " + COMMAND_NAME + "` failed to find `" + COMMAND_NAME + "` on PATH."));
                }
                return deferred.resolve(commandPath);
            });
            return deferred.promise;
        }

        if (PATH.existsSync(commandPath)) {
            if (FS.readlinkSync(commandPath) === COMMAND_PATH) {
                return finalVerify();
            }
            FS.unlinkSync(commandPath);
        }

        FS.symlinkSync(COMMAND_PATH, commandPath);
        FS.chmodSync(commandPath, 0755);
        if (OS.isSudo() && typeof FS.lchownSync === "function") {
            FS.lchownSync(commandPath, parseInt(process.env.SUDO_UID), parseInt(process.env.SUDO_GID));
        }

        return finalVerify();

    }).fail(function(err) {
        if (err.code === "EACCES") {
        	throw new Error("Permission denied! Could not install command at '" + commandPath + "'.");
        } else {
            throw err;
        }
    }).fail(function(err) {
        TERM.stderr.writenl("\0red(" + err.stack + "\0)");
        throw err;
    }).then(function(commandPath) {
        TERM.stderr.writenl("\0green(`" + COMMAND_NAME + "` has successfully been installed in your PATH at '" + commandPath + "'!\0)");
	}, function(err) {
        TERM.stderr.writenl("\0red([sm] ERROR: Installing `" + COMMAND_NAME + "` in your PATH at '" + commandPath + "'! Try re-running with: \0bold(sudo " + COMMAND_PATH + " --install-command\0)\0)");
        throw true;
	});

	// @source npm
	function getBinPath() {
	    var prefixPath;
	    if (process.platform === "win32") {
	        // c:\node\node.exe --> prefix=c:\node\
	        prefixPath = PATH.join(process.execPath, "..");
	    } else {
	        // /usr/local/bin/node --> prefix=/usr/local
	        prefixPath = PATH.join(process.execPath, "..", "..");
	    }
	    var binPath = PATH.join(prefixPath, "bin");

	    // TODO: Fix this for windows.
	    var paths = process.env.PATH.split(":");

	    if (paths.indexOf(binPath) === -1) {
	        // don't assume node is on the user's path
	        var binPathDefault = "/usr/local/bin";
	        if (!PATH.existsSync(binPathDefault)) {
	            throw new Error("Did not find node-based bin path '" + binPath + "' nor default bin path '" + binPathDefault + "' on PATH '" + process.env.PATH + "'!");
	        }
	        binPath = binPathDefault;
	    }
	    return binPath;
	}
}

function installNpm() {
	var deferred = Q.defer();
	var error = null;
    var proc = SPAWN("sh", [
        PATH.join(__dirname, "npm-install.sh")
    ]);
    proc.on("error", function(err) {
    	return deferred.reject(err);
    });
    proc.stdout.on("data", function(data) {
        process.stdout.write(data);
    });
    proc.stderr.on("data", function(data) {
        process.stderr.write(data);
    	if (/Error: EPERM/.test(data.toString())) {
    		error = new Error("Permission denied");
    		setTimeout(function() {
	    		proc.kill();
	    		return deferred.reject(error);
    		}, 500);
    	} else
    	if (/npm ERR!/.test(data.toString())) {
    		error = new Error("Install error");
    		setTimeout(function() {
	    		proc.kill();
	    		return deferred.reject(error);
    		}, 500);
    	}
    });
    proc.on("exit", function(code) {
        if (code !== 0 || error) return deferred.reject(error || new Error("`npm` install error"));
        return deferred.resolve();
    });
    return deferred.promise.fail(function(err) {
        TERM.stderr.writenl("\n\0red(" + err.stack + "\0)");
        throw err;
    }).then(function() {
        TERM.stderr.writenl("\0green(Latest `npm` has successfully been installed!\0)");
	}, function(err) {
        TERM.stderr.writenl("\0red([sm] ERROR: Installing `npm`! Try re-running with: \0bold(sudo sm --install-npm\0)\0)");
        throw true;
	});
}

