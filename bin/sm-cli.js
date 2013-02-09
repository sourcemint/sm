
const PATH = require("path");
const FS = require("sm-util/lib/fs");
const SM_CLI = require("../lib/sm-cli");
const ERROR = require("sm-util/lib/error");


try {

	if (FS.existsSync(PATH.join(process.cwd(), ".sm", ".switch"))) {
		FS.unlinkSync(PATH.join(process.cwd(), ".sm", ".switch"));
	}

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
