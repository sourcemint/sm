
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const TERM = require("sm-util/lib/term");
const ERROR = require("sm-util/lib/error");
const CONFIG = require("../lib/config");
const SM_CLI = require("../lib/sm-cli");


exports.main = function(callback) {

	try {

		if (process.version !== "v0.6.19") {

			TERM.stdout.writenl("\0red(");
			TERM.stdout.writenl("  ERROR: You need NodeJS v0.6.19 to run `sm` due to https://github.com/sourcemint/sm/issues/3");
			TERM.stdout.writenl("  WORKAROUND: Use https://github.com/creationix/nvm to activate NodeJS v0.6.19:");
			TERM.stdout.writenl("");
			TERM.stdout.writenl("    \0bold(curl https://raw.github.com/creationix/nvm/master/install.sh | sh");
			TERM.stdout.writenl("    \0bold(nvm run 0.6.19");
			TERM.stdout.writenl("");
			TERM.stdout.writenl("  Then re-run `npm install -g sm`.");
			TERM.stdout.writenl("  Make sure to `nvm use 0.6.19` before using `sm` in future.");
			TERM.stdout.writenl("  NOTE: The need for NodeJS v0.6.19 specifically and `nvm` is only temporary until the issue above is resolved.");
			TERM.stdout.writenl("\0)");

			return callback(true);
		}

		var homeBasePath = CONFIG.getHomeBasePath();

		if (PATH.existsSync(homeBasePath)) {

			// Default sm toolchain already setup.

			TERM.stdout.writenl("\0green(");
			TERM.stdout.writenl("  Found existing default sm toolchain at: " + homeBasePath);
			TERM.stdout.writenl("  To \0bold(ACTIVATE\0) this toolchain run: ");
			TERM.stdout.writenl("");
			TERM.stdout.writenl("    \0bold(" + PATH.join(homeBasePath, ".sm/bin/sm") + " --install-command\0)");
			TERM.stdout.writenl("");
			TERM.stdout.writenl("  This will put the `sm` command of this toolchain on your `PATH`.");
			TERM.stdout.writenl("\0)");

			return callback(null);

		} else {

			// Default sm toolchain not setup. Setup now.

			TERM.stdout.writenl("Installing default sm toolchain at: " + homeBasePath);

			if (!PATH.existsSync(homeBasePath)) {
				FS.mkdirSync(homeBasePath);
			}

			SM_CLI.for(PATH.dirname(__dirname)).respond([ "", "", "status", "--levels", "0"]).then(function() {

				TERM.stdout.writenl("\0green(");
				TERM.stdout.writenl("  Installed default sm toolchain at: " + homeBasePath);
				TERM.stdout.writenl("  To \0bold(ACTIVATE\0) this toolchain run: ");
				TERM.stdout.writenl("");
				TERM.stdout.writenl("    \0bold(" + PATH.join(homeBasePath, ".sm/bin/sm") + " --install-command\0)");
				TERM.stdout.writenl("");
				TERM.stdout.writenl("  This will put the `sm` command of this toolchain on your `PATH`.");
				TERM.stdout.writenl("\0)");

				return callback(null);

			}, callback);
		}
	} catch(err) {
		return callback(err);
	}
}


if (require.main === module) {
	exports.main(function(err) {
		if (err) {
			return ERROR.exitProcessWithError(err);
		}
		return process.exit(0);
	});
}
