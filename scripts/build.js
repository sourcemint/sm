
const PATH = require("path");
const SM_CLI = require("../lib/sm-cli");
const ERROR = require("sm-util/lib/error");
const COPY = require("ncp").ncp;
const FS = require("fs");
const FS_RECURSIVE = require("sm-util/lib/fs-recursive");
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
					descriptor[name] = node.descriptors.package[name];
				});
				descriptor.pm = "npm";
				descriptor.publish = true;

	            FS.writeFileSync(PATH.join(sourcePath, "package.json"), JSON.stringify(descriptor, null, 4));

				var releaseName = node.summary.name + "-" + node.summary.version;
				var npmPath = PATH.join(__dirname, "../dist/npm");

				if (PATH.existsSync(npmPath)) {
					FS_RECURSIVE.rmdirSyncRecursive(npmPath);
				}
				FS_RECURSIVE.mkdirSyncRecursive(npmPath);

				COPY(sourcePath, npmPath, function(err) {
					if (err) return callback(err);
/*
					OS.spawnInline("npm", [ "pack" ], {
						cwd: npmPath
					}).then(function() {

						FS.renameSync(PATH.join(npmPath, releaseName + ".tgz"), PATH.join(npmPath, "../" + releaseName + ".tgz"));
*/
						return callback(null);
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
