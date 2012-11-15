
// TODO: Use `sm` to ensure package is installed.


const PATH = require("path");
const FS = require("fs");
const CONSOLE = require("sourcemint-util-js/lib/console");
const ERROR = require("sourcemint-util-js/lib/error");
// @see https://github.com/visionmedia/mocha/wiki/Using-mocha-programmatically
const MOCHA = require("mocha");
const CHAI = require("chai");



exports.main = function(callback) {
	try {

		CHAI.Assertion.includeStack = true;

		// TODO: Set filter to not show info for certain files.
		CONSOLE.enableFileLineInfo();

		var mocha = new MOCHA({
			timeout: 2000
		});
		mocha.suite._bail = true;
		var testFileRe = /^[^_].*\.js$/;
		FS.readdirSync(__dirname).filter(function(filename) {
			return testFileRe.test(filename);
		}).forEach(function(filename) {
		    mocha.addFile(PATH.join(__dirname, filename));
		});
		mocha.run(callback);
	} catch(err) {
		return callback(err);
	}
}


if (require.main === module) {
	exports.main(function(err) {
		if (err) return ERROR.exitProcessWithError(err);
		process.exit(0);
	});
}
