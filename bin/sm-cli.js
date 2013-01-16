
const SM_CLI = require("../lib/sm-cli");
const ERROR = require("sourcemint-util-js/lib/error");

try {
	SM_CLI.for(process.cwd()).respond(process.argv).then(function() {
		process.exit(0);
	}, function(err) {
		if (typeof err === "object" && /Exit silently \(look for printed error above\)/.test(err.message)) {
			err = true;
		}
		return ERROR.exitProcessWithError(err);
	});
} catch(err) {
	return ERROR.exitProcessWithError(err);
}
