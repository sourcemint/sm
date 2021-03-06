
// TODO: Use `sm` to ensure package is installed.


const PATH = require("path");
const FS = require("sm-util/lib/fs");
const CONSOLE = require("sm-util/lib/console");
const ERROR = require("sm-util/lib/error");
const UTIL = require("sm-util/lib/util");
const SM = require("..");
// @see https://github.com/visionmedia/mocha/wiki/Using-mocha-programmatically
var MOCHA = null;
var CHAI = null;
function requireTestModules(callback) {
	MOCHA = require("mocha");
	CHAI = require("chai");
	return callback(null);
}


exports.main = function(callback) {
	try {

		function ensureTestDependencies(callback) {
			if (FS.existsSync(PATH.join(__dirname, "node_modules"))) {
				return requireTestModules(callback);
			}
			return SM.for(__dirname).install(function(err) {
				if (err) return callback(err);
				return requireTestModules(callback);
			});
		}

		return ensureTestDependencies(function(err) {
			if (err) return callback(err);

	    	if (!FS.existsSync(PATH.join(__dirname, "tmp"))) {
	    		FS.mkdirSync(PATH.join(__dirname, "tmp"));
	    	}

			CHAI.Assertion.includeStack = true;

			// TODO: Set filter to not show info for certain files.
			CONSOLE.enableFileLineInfo();

			var mocha = new MOCHA({
				timeout: 2000
			});
			mocha.suite._bail = true;

			var testFileRe = /^[^_].*\.js$/;
			var filterIndex = process.argv.indexOf("--filter");
			if (filterIndex !== -1) {
				testFileRe = new RegExp(process.argv[filterIndex + 1]);
			}

			FS.readdirSync(__dirname).filter(function(filename) {
				return testFileRe.test(filename);
			}).forEach(function(filename) {
			    mocha.addFile(PATH.join(__dirname, filename));
			});
			mocha.run(callback);

		});

	} catch(err) {
		return callback(err);
	}
}

exports.getBaseOptions = function(extra) {
	var options = {
		verbose: true,
		debug: true
	};
	if (extra) {
		UTIL.update(options, extra);
	}
	return options;
}


if (require.main === module) {
	exports.main(function(err) {
		if (err) return ERROR.exitProcessWithError(err);
		process.exit(0);
	});
}
