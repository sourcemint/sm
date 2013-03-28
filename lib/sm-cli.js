
const PATH = require("path");
const FS = require("sm-util/lib/fs");
const Q = require("sm-util/lib/q");
const UTIL = require("sm-util/lib/util");
const TERM = require("sm-util/lib/term");
const OS = require("sm-util/lib/os");
const EXEC = require("child_process").exec;
const SPAWN = require("child_process").spawn;
const COMMANDER = require("commander");
const SM_CORE = require("./sm-core");
const LOGGER = require("./logger");
const CONFIG = require("./config");


exports.for = function(packageRootPath) {
	return new SM(packageRootPath);
}


var SM = function(packageRootPath) {
	var self = this;

	var core = SM_CORE.for(packageRootPath);

	var callPromise = null;
	var calling = false;

	function makeProgram(act) {

		var program = new COMMANDER.Command();

		var makeOptions = program.makeOptions = function(extra) {
		    var opts = {
		    	force: program.force || false,
		    	verbose: program.verbose || (process.env.PINF_VERBOSE ? true : false),
		    	debug: program.debug || (process.env.PINF_DEBUG ? true : false),
		    	time: Math.floor(Date.now()/1000),
		    	now: program.now || false,
	//	    	"dry-run": options["dry-run"] || false,
		    	format: program.format,
				getConfig: core.getConfig,
				setConfig: core.setConfig,
				inline: program.inline || false,
				progress: program.progress || false
		    };
		    if (extra) {
		    	UTIL.update(opts, extra);
		    }
		    // TODO: Don't do this once we have better logging?
		    if (opts.debug) opts.verbose = true;
		    if (!opts.logger) {
		    	opts.logger = LOGGER.forOptions(opts);
		    }
		    return opts;
		}

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
			.option("--progress", "Show progress for long running operations.")
			.option("-f, --force", "Force action to check deeper or repeat.")
			.option("--install-command", "Install `sm` command in PATH.")
			.option("--install-npm", "Install latest `npm`.")
			.option("--init-toolchain <templateUri>", "Initialize a new toolchain (seed git repository) from template.")
			.option("--inline", "When calling a PINF program from a PINF program, inherit program descriptors.")
			.option("-v, --verbose", "Show verbose progress.")
			.option("--debug", "Show extra verbose progress.");

		var originalOutputHelp = program.outputHelp;
		program.outputHelp = function() {
			if (!calling && program.rawArgs.length === 2) {
				if (!act) return;
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
			.command("status [selector]")
			.description("Display package status.")
			.option("-a, --all", "Show transitive dependencies (dependencies of dependencies).")
			.option("-i, --info", "Show extra info.")
			.option("-d, --dev", "Show transitive dev dependencies.")
			.option("--levels <number>", "Number of levels to include.")
	        .action(function(selector, options) {
				if (!act) return;
	        	calling = true;
	        	core.status(selector, makeOptions({
	        		all: options.all || false,
	        		info: options.info || false,
	        		dev: options.dev || false,
	        		levels: (typeof options.levels !== "undefined") ? parseInt(options.levels) : false,
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
				if (!act) return;
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
				if (!act) return;
	        	calling = true;
	        	core.switch(makeOptions({
	        		startWorkspace: options.startWorkspace,
	        		stopWorkspace: options.stopWorkspace
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("install [selector]")
			.description("Install package and required dependencies.")
			.option("--link <path>", "Path to local package to link (instead of downloading remote package).")
			.option("--production", "Don't install dev dependencies.")
	        .action(function(selector, options) {
				if (!act) return;
	        	calling = true;
	        	var link = options.link || false;
	        	if (link && /^\./.test(link)) {
	        		link = "../" + link;
	        	}
	        	core.install(makeOptions({
	        		production: options.production || false,
	        		select: selector || false,
	        		link: link
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("edit <selector> [uri]")
			.description("Edit a dependency.")
	        .action(function(selector, uri) {
				if (!act) return;
	        	calling = true;
	        	core.edit(selector, uri, makeOptions({
	        		now: false
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("diff")
			.description("Look for changes compared to install cache.")
	        .action(function() {
				if (!act) return;
	        	calling = true;
	        	core.diff(makeOptions({
	        		now: false
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("try <uri>")
			.description("Quickly install and siwtch to the package to try it out.")
			.option("-p, --project", "Make package into an editable project.")
			.option("-g, --global", "Make package globally available.")
			.option("--delete", "Remove existing try install if exists.")
			.option("--cache", "Clone from local cache if available (will not aggressively fetch latest remote info).")
	        .action(function(uri, options) {
				if (!act) return;
	        	calling = true;
	        	core.try(uri, makeOptions({
	        		delete: options.delete || false,
	        		project: options.project || false,
	        		global: options.global || false,
	        		now: !options.cache
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("run")
			.description("Run program.")
			.option("--mode <mode>", "Mode to run program runtime in (default: production).")
	//		.option("--module <id>", "Module to run.")
			// @issue https://github.com/visionmedia/commander.js/issues/118
			// TODO: Support module options by including after `--` in command.
	//		.option("--callArgs <args>", "Arguments to pass along.")
	        .action(function(options) {
				if (!act) return;
	        	calling = true;
	        	core.run(makeOptions({
	        		mode: options.mode || false
	//        		callModule: options.module,
	//        		callArgs: options.callArgs
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("export <path>")
			.description("Derive standalone package.")
			.option("--delete", "Remove existing export if exists.")
			.option("--include-dependencies", "Include dependencies.")
	        .action(function(path, options) {
				if (!act) return;
	        	calling = true;
	        	core.export(path, makeOptions({
	        		delete: options.delete || false,
	        		includeDependencies: options.includeDependencies || false
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("build")
			.description("Build distribution releases of package.")
	        .action(function(path, options) {
				if (!act) return;
	        	calling = true;
	        	core.build(makeOptions()).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("save")
			.description("Commit all changes and freeze dependency tree by writing `sm-catalog.json`.")
	        .action(function() {
				if (!act) return;
	        	calling = true;
	        	core.save(makeOptions()).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("bump")
			.description("Bump package version.")
			.option("--patch", "Bump patch version.")
			.option("--minor", "Bump minor version.")
			.option("--major", "Bump major version.")
			.option("-p, --publish", "Publish package after bumping.")
	        .action(function(options) {
				if (!act) return;
			    if (!options.minor && !options.major) {
			        options.patch = true;
			    }
	        	calling = true;
	        	core.bump(makeOptions({
	        		incrementPatch: options.patch || false,
	        		incrementMinor: options.minor || false,
	        		incrementMajor: options.major || false,
	        		publish: options.publish || false
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("publish")
			.description("Publish package by pushing all changes online.")
			.option("-r, --recursive", "Publish all changes for all dependency packages.")
	        .action(function(options) {
				if (!act) return;
	        	calling = true;
	        	core.publish(makeOptions({
	        		recursive: options.recursive || false
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("deploy")
			.description("Deploy program.")
	        .action(function() {
				if (!act) return;
	        	calling = true;
	        	core.deploy(makeOptions()).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("report")
			.description("Display detailed report for program (package and dependencies).")
	        .action(function() {
				if (!act) return;
	        	calling = true;
	        	core.report(makeOptions()).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("info [name|relpath]")
			.description("Display detailed information for package.")
	        .action(function(arg) {
				if (!act) return;
	        	calling = true;
	        	core.info(arg || ".", makeOptions()).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("test")
			.description("Run tests for package.")
			.option("--cover", "Enable test coverage.")
			.option("--filter <regexp>", "Only run some tests.")
	        .action(function(options) {
				if (!act) return;
	        	calling = true;
	        	core.test(makeOptions({
	        		cover: options.cover || false,
	        		filter: options.filter || false
	        	})).then(callPromise.resolve, callPromise.reject);
	        });

		program
			.command("help")
			.description("Help for package")
	        .action(function() {
				if (!act) return;
	        	calling = true;
	        	core.help(makeOptions()).then(callPromise.resolve, callPromise.reject);
	        });

	    return program;
	}

	self.respond = function(args) {
		function respond(args, expanded) {

			var dirIndex = args.indexOf("--dir");
			if (dirIndex !== -1) {
				var path = PATH.resolve(args[dirIndex + 1]);
				args.splice(dirIndex, 2);
				return exports.for(path).respond(args);
			}

			callPromise = Q.defer();

			var program = makeProgram(false);
			program.parse(args);

			return core.__init(program.makeOptions()).then(function() {

				var program = makeProgram(true);
				program.parse(args);

				if (program.installCommand) {
					installCommand().then(callPromise.resolve, callPromise.reject);
				} else
				if (program.installNpm) {
					installNpm().then(callPromise.resolve, callPromise.reject);
				} else
				if (program.initToolchain) {
					core.init(
						program.initToolchain,
						program.makeOptions({
							dev: true
						})
					).then(function() {
						TERM.stdout.writenl("\0green(");
						TERM.stdout.writenl("  A new toolchain has successfully been created at: " + packageRootPath);
						TERM.stdout.writenl("  To \0bold(ACTIVATE\0) this toolchain run: ");
						TERM.stdout.writenl("");
						TERM.stdout.writenl("    \0bold(" + PATH.join(packageRootPath, ".sm/bin/sm") + " --install-command\0)");
						TERM.stdout.writenl("");
						TERM.stdout.writenl("  This will put the `sm` command of this toolchain on your `PATH`.");
						TERM.stdout.writenl("\0)");
					}).then(callPromise.resolve, callPromise.reject);
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

	var targetCommandPath = null;
	var commandName = "sm";

	// If the bin path is set explicitly we use it.
	if (process.env.SM_BIN_PATH) {
		targetCommandPath = process.env.SM_BIN_PATH;
	} else {
		// See if the sm command of a toolchain is being called.
		if (FS.existsSync(PATH.join(CONFIG.getHomeBasePath(), ".sm/bin/sm"))) {
			targetCommandPath = PATH.join(CONFIG.getHomeBasePath(), ".sm/bin/sm");
		}
	}
	// Fall back to our exact bin.
	if (!targetCommandPath) {
		targetCommandPath = PATH.join(__dirname, "../bin/sm-cli");
	}

    var commandPath = null;

	return Q.fcall(function() {

        var binPath = getBinPath();

        commandPath = PATH.join(binPath, commandName);

        function finalVerify() {
			var deferred = Q.defer();
            EXEC("which " + commandName, function(error, stdout, stderr) {
                if (error) {
                    return deferred.reject(new Error("`which " + commandName + "` failed to find `" + commandName + "` on PATH."));
                }
                return deferred.resolve(commandPath);
            });
            return deferred.promise;
        }

        if (FS.existsSync(commandPath)) {
            if (FS.readlinkSync(commandPath) === targetCommandPath) {
                return finalVerify();
            }
            FS.unlinkSync(commandPath);
        }

        FS.symlinkSync(targetCommandPath, commandPath);
        FS.chmodSync(commandPath, 0755);
        if (OS.isSudo() && typeof FS.lchownSync === "function") {
            FS.lchownSync(commandPath, parseInt(process.env.SUDO_UID), parseInt(process.env.SUDO_GID));
        }

        return finalVerify();

    }).fail(function(err) {
        if (err.code === "EACCES") {
        	console.error("Permission denied! Could not install command at '" + commandPath + "'.");
        	throw new Error("Permission denied! Could not install command at '" + commandPath + "'.");
        } else {
            throw err;
        }
    }).fail(function(err) {
        TERM.stderr.writenl("\0red(" + err.stack + "\0)");
        throw err;
    }).then(function(commandPath) {
        TERM.stderr.writenl("\0green(`" + commandName + "` has successfully been installed in your PATH at '" + commandPath + "'!\0)");
	}, function(err) {
        TERM.stderr.writenl("\0red([sm] ERROR: Installing `" + commandName + "` in your PATH at '" + commandPath + "'! Try re-running with `\0bold(sudo " + targetCommandPath + " --install-command\0)`. `sudo` is only needed to install the `sm` command, not when you call `sm` later.\0)");
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
	        if (!FS.existsSync(binPathDefault)) {
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

