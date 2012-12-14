
const SM_CLI = require("../lib/sm-cli");
const ERROR = require("sourcemint-util-js/lib/error");

SM_CLI.for(process.cwd()).respond(process.argv).then(function() {
	process.exit(0);
}, function(err) {
	return ERROR.exitProcessWithError(err);
});
