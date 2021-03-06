
const PATH = require("path");
const FS = require("sm-util/lib/fs");
const SM_CLI = require("../lib/sm-cli");
const ERROR = require("sm-util/lib/error");
const Q = require("sm-util/lib/q");
const OS = require("sm-util/lib/os");


exports.main = function(callback) {

	function exportSource(callback) {

		SM_CLI.for(PATH.dirname(__dirname)).respond(["", "",
			"export",
			"--delete",
//			"--verbose",
			PATH.join(__dirname, "../dist/source")
		]).then(function() {

			// Create NPM package.

			SM_CLI.for(PATH.dirname(__dirname)).respond(["", "",
				"status",
				"--format", "JSON",
				"--levels", "0"
			]).then(function(node) {

				var sourcePath = PATH.join(__dirname, "../dist/source");

				var descriptor = JSON.parse(FS.readFileSync(PATH.join(sourcePath, "package.json")));
				[
					"description",
					"license",
					"author",
					"maintainers",
					"contributors",
					"bugs",
					"homepage",
					"repository"
				].forEach(function(name) {
					descriptor[name] = node.descriptor.package[name];
				});
				descriptor.scripts = {
					postinstall: node.descriptor.package.scripts.postinstall
				};
				descriptor.pm = "npm";
				descriptor.publish = true;

	            FS.writeFileSync(PATH.join(sourcePath, "package.json"), JSON.stringify(descriptor, null, 4));

				var releaseName = node.summary.name + "-" + node.summary.version;
				var npmPath = PATH.join(__dirname, "../dist/npm");

				if (FS.existsSync(npmPath)) {
					FS.removeSync(npmPath);
				}
				FS.mkdirsSync(npmPath);

				FS.copy(sourcePath, npmPath, function(err) {
					if (err) return callback(err);

		            FS.writeFileSync(PATH.join(npmPath, ".npmignore"), [
		            	".sm/"
		            ].join("\n"));

		            // TODO: Remove this once `.npmignore` file works properly.
		            FS.removeSync(PATH.join(npmPath, "node_modules/sm-plugin/node_modules/sm-plugin-7zip"));

/*
					OS.spawnInline("npm", [ "pack" ], {
						cwd: npmPath
					}).then(function() {

						FS.renameSync(PATH.join(npmPath, releaseName + ".tgz"), PATH.join(npmPath, "../" + releaseName + ".tgz"));
*/

						// Create S3 package.

						var smPath = PATH.join(__dirname, "../dist/sm");

						if (FS.existsSync(smPath)) {
							FS.removeSync(smPath);
						}
						FS.mkdirsSync(smPath);

						FS.copy(npmPath, smPath, function(err) {
							if (err) return callback(err);
							var descriptor = JSON.parse(FS.readFileSync(PATH.join(smPath, "package.json")));
							descriptor.pm = "sm";
				            FS.writeFileSync(PATH.join(smPath, "package.json"), JSON.stringify(descriptor, null, 4));


							var descriptor = JSON.parse(FS.readFileSync(PATH.join(npmPath, "package.json")));
							// We don't want NPM to put `sm` on the `PATH` as that usually results in errors during install.
							// TODO: Does this work properly now even when using `-g`?
							delete descriptor.bin;
				            FS.writeFileSync(PATH.join(npmPath, "package.json"), JSON.stringify(descriptor, null, 4));					


							return callback(null);
						});
//					}, callback);
				});
			}, callback);
		});
	}

	return exportSource(callback);
}


if (require.main === module) {
	exports.main(function(err) {
		if (err) {
			return ERROR.exitProcessWithError(err);
		}
		return process.exit(0);
	});
}
