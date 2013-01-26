
const ASSERT = require("assert");
const PATH = require("path");
const SM_NS = ["config", "github.com/sourcemint/sm/0"];

var API = null;
exports.setAPI = function(api) {
	API = api;
}

exports.for = function(basePath) {
    return new Config(basePath);
}



exports.getHomeBasePath = function() {
	var homeBasePath = null;
	// If the `SM_HOME` variable is set we use it to determine the home for the toolchain.
	if (process.env.SM_HOME) {
		homeBasePath = process.env.SM_HOME;
	} else
	if (process.env.SM_BIN_PATH) {
		// The `SM_BIN_PATH` should be set to the directory of the link or command that invoked sm.
		// We can use this to determine the home of the toolchain as sm would typically reside
		// within the toolchain.
		function resolve(binPath) {
			function next() {
				// Follow symlink to check next context.
				if (API.FS.lstatSync(binPath).isSymbolicLink()) {
					return resolve(PATH.resolve(PATH.dirname(binPath), API.FS.readlinkSync(binPath)));
				} else {
					// Give up.
					return;
				}
			}
			var descriptorPath = PATH.join(binPath, "../../../..", "program.json");
			if (!PATH.existsSync(descriptorPath)) {
				return next();
			}
			var descriptor = null;
			try {
				descriptor = JSON.parse(API.FS.readFileSync(descriptorPath));
			} catch(err) {
				err.message += " (while parsing: " + ")";
				throw err;
			}
			if (
				descriptor &&
				descriptor.config &&
				descriptor.config["github.com/sourcemint/sm/0"] &&
				descriptor.config["github.com/sourcemint/sm/0"].toolchain &&
				descriptor.config["github.com/sourcemint/sm/0"].toolchain.paths &&
				descriptor.config["github.com/sourcemint/sm/0"].toolchain.paths.home
			) {
				homeBasePath = makeAbsolute(PATH.dirname(descriptorPath), descriptor.config["github.com/sourcemint/sm/0"].toolchain.paths.home);
			} else {
				return next();				
			}
		}
		resolve(process.env.SM_BIN_PATH);
	}
	if (!homeBasePath) {
		// Fall back to using the default location.
		ASSERT(typeof process.env.HOME === "string", "`HOME` environment variable must be set.");	
		homeBasePath = PATH.join(process.env.HOME, ".sm");
	}
	return homeBasePath;
}


var Config = function(basePath) {
	var self = this;
	self.basePath = basePath;
	self.program = null;
	self.programDescriptor = null;
}

Config.prototype.__init = function(program) {
	var self = this;
	self.program = program;

	var packageDescriptorPath = API.PATH.join(self.basePath, "package.json");
	var programDescriptorPath = API.PATH.join(self.basePath, "program.json");

	return API.Q.fcall(function() {
		if (!API.PATH.existsSync(programDescriptorPath)) {
			API.FS_RECURSIVE.mkdirSyncRecursive(API.PATH.dirname(programDescriptorPath));
			API.FS.writeFileSync(programDescriptorPath, JSON.stringify({
				config: {
					"github.com/sourcemint/sm/0": {
						"toolchain": {
	       					"vcs": "git",
	       					"os": "darwin",
	       					"platform": "node",
	       					"profile": "default",
	   						"paths": {
								"home": self.makeRelativePath(self.basePath)
							}
						}
					}
				}
			}, null, 4));
		}
		if (!API.PATH.existsSync(packageDescriptorPath)) {
			API.FS_RECURSIVE.mkdirSyncRecursive(API.PATH.dirname(packageDescriptorPath));
			var descriptor = JSON.parse(API.FS.readFileSync(PATH.join(__dirname, "../package.json")));
			API.FS.writeFileSync(packageDescriptorPath, JSON.stringify({
				"name": "toolchain",
				"version": "0.1.0",
				"pm": "sm",
				"mappings": {
					// Strip everything after pre-release tag if present.
					"sm": "github.com/sourcemint/sm/~" + descriptor.version.replace(/^([^-]*)((-[^\.]*).*?)?$/, "$1$3"),
					"node": descriptor.optionalMappings.node
				}
			}, null, 4));

			// See if `node_modules/sm` exists as every toolchain has its own version.
			// If not we link ourselves.
			// NOTE: We only do this when we also write the package descriptor (this way the versions will match).
			// With the `sm` npm package linked like this, update sm via `npm install sm`.

			var smLibPath = API.PATH.join(self.basePath, "node_modules", "sm");
			if (!PATH.existsSync(smLibPath)) {
				if (!PATH.existsSync(PATH.dirname(smLibPath))) {
					API.FS.mkdirSync(PATH.dirname(smLibPath));
				}
				API.FS.symlinkSync(PATH.join(__dirname, ".."), smLibPath);
			}
			var binLibPath = API.PATH.join(self.basePath, ".sm", "bin", "sm");
			if (!PATH.existsSync(PATH.dirname(binLibPath))) {
				API.FS_RECURSIVE.mkdirSyncRecursive(PATH.dirname(binLibPath));
			}
			if (!PATH.existsSync(binLibPath)) {
				API.FS.symlinkSync("../../node_modules/sm/bin/sm-cli", binLibPath);
			}
		}
	}).then(function() {

		self.programDescriptor = new API.JSON_STORE(programDescriptorPath);

		var homePath = self.makeAbsolutePath(self.programDescriptor.get(SM_NS.concat(["toolchain", "paths", "home"])));

		[
			"cache",
			"profiles",
			"try",
			"projects"
		].forEach(function(dir) {
			if (!self.programDescriptor.has(SM_NS.concat(["paths", dir]))) {
				self.programDescriptor.set(
					SM_NS.concat(["toolchain", "paths", dir]),
					self.makeRelativePath(API.PATH.join(homePath, dir))
				)
			}
			var path = self.makeAbsolutePath(self.programDescriptor.get(SM_NS.concat(["toolchain", "paths", dir])));
			if (!API.PATH.existsSync(path)) {
				API.FS.mkdirSync(path);
			}
		});
	});
}

Config.prototype.get = function(ns) {
	// TODO: Only absolute path on applicable properties (need schema).
	return this.makeAbsolutePath(this.programDescriptor.get(SM_NS.concat(ns)));
}

Config.prototype.makeAbsolutePath = function(path) {
	return makeAbsolute(this.basePath, path);
}

Config.prototype.makeRelativePath = function(path) {	
	var dirname = this.basePath;
	if (path.substring(0, dirname.length+1) === dirname + "/") {
		return "." + path.substring(dirname.length);
	}
	if (process.env.HOME && path.substring(0, process.env.HOME.length+1) === process.env.HOME + "/") {
		return "~" + path.substring(process.env.HOME.length);
	}
	return path;
}


function makeAbsolute(basePath, path) {
	if (typeof path !== "string") return path;
	if (path && /^\./.test(path)) {
		return API.PATH.join(basePath, path);
	}
	if (path && /^~\//.test(path)) {
		ASSERT(typeof process.env.HOME !== "undefined", "`process.env.HOME` is required!");
		return API.PATH.join(process.env.HOME, path.substring(2));
	}
	return path;
}
