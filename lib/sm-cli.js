
const PATH = require("path");
const FS = require("fs");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const COMMANDER = require("commander");
const SM_CORE = require("./sm-core");

var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new SM(packageRootPath);
	}
	return instances[packageRootPath];
}


var SM = function(packageRootPath) {
	var self = this;

	var core = SM_CORE.for(packageRootPath);

	var program = COMMANDER;

	function makeOptions(extra) {
	    var opts = {
	    	verbose: program.verbose || false,
	    	debug: program.debug || false,
//	    	time: options.time || false,
//	    	now: options.now || false,
//	    	"dry-run": options["dry-run"] || false,
	    	format: program.format
	    };
	    if (extra) {
	    	UTIL.update(opts, extra);
	    }
	    return opts;
	}

	var callPromise = null;

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
		.option("--format <format>", "Output format")
		.option("--verbose", "Show verbose progress")
		.option("--debug", "Show extra verbose progress");

	program
		.command("status")
		.description("Display package status")
        .action(function() {
        	core.status(makeOptions()).then(callPromise.resolve, callPromise.reject);
        });

	program
		.command("install")
		.description("Install package and required dependencies")
        .action(function() {

//console.log('INSTALL!', env, options);

			callPromise.resolve("YUP!");			
        });

	self.respond = function(args) {
		callPromise = Q.defer();
		try {
			program.parse(args);
		} catch(err) {
			callPromise.reject(err);
		}
		return callPromise.promise;
	}

	self.status = core.status.bind(self);

	return self;
}
