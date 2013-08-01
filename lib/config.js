
const ASSERT = require("assert");
const PATH = require("path");
const JSON_STORE = require("sm-util/lib/json-store");
const SM_NS = ["config", "github.com/sourcemint/sm/0"];

var API = null;
exports.setAPI = function(api) {
	API = api;
}

exports.for = function(basePath) {
    return new Config(basePath);
}



exports.getHomeBasePath = function(ignoreEnvVars) {
	var homeBasePath = null;
	if (!ignoreEnvVars) {
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
				if (!API.FS.existsSync(descriptorPath)) {
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
					homeBasePath = makeAbsolutePath(PATH.dirname(descriptorPath), descriptor.config["github.com/sourcemint/sm/0"].toolchain.paths.home);
				} else {
					return next();
				}
			}
			resolve(process.env.SM_BIN_PATH);
		}
	}
	if (!homeBasePath) {
		// See if we have a parent toolchain directory.
		function resolve(basePath) {
			var programDescriptorPath = PATH.join(basePath, "program.json");
			if (API.FS.existsSync(programDescriptorPath)) {
				try {
					var descriptor = new API.JSON_STORE(programDescriptorPath);
					if (descriptor.has(SM_NS.concat(["toolchain", "paths", "home"]))) {
						return makeAbsolutePath(PATH.dirname(descriptor.file), descriptor.get(SM_NS.concat(["toolchain", "paths", "home"])));
					}
				} catch(err) {}
			}
			var parentPath = PATH.dirname(basePath);
			if (parentPath === basePath) {
				return null;
			}
			return resolve(parentPath);
		}

		homeBasePath = resolve(process.cwd());

		if (!homeBasePath) {
			// Fall back to using the default location.
			ASSERT(typeof process.env.HOME === "string", "`HOME` environment variable must be set.");	
			homeBasePath = PATH.join(process.env.HOME, ".sm");
		}
	}
	return homeBasePath;
}

exports.getSmBinPath = function(homeBasePath) {
	// See if we have a parent toolchain directory.
	function resolve(basePath) {
		var smBinPath = PATH.join(basePath, ".sm/bin/sm");
		if (API.FS.existsSync(smBinPath)) {
			return smBinPath;
		}
		var parentPath = PATH.dirname(basePath);
		if (parentPath === basePath) {
			return null;
		}
		return resolve(parentPath);
	}
	return resolve(homeBasePath);
}


var Config = function(basePath) {
	var self = this;
	self.basePath = basePath;
	self.programOptions = null;
	self.packageRootPath = null;
	self.programDescriptor = null;
	self.catalog = null;
}

Config.prototype.__init = function(programOptions, packageRootPath) {
	var self = this;
	self.programOptions = programOptions;
	self.packageRootPath = packageRootPath;

	self.reinit = function() {
		return self.__init(self.programOptions, self.packageRootPath);
	}

	var packageDescriptorPath = API.PATH.join(self.basePath, "package.json");
	var programDescriptorPath = API.PATH.join(self.basePath, "program.json");
	var localProgramDescriptorPath = API.PATH.join(packageRootPath, ".sm", "program.json");

	return API.Q.fcall(function() {
		if (!API.FS.existsSync(programDescriptorPath)) {
			API.FS.mkdirsSync(API.PATH.dirname(programDescriptorPath));
			API.FS.writeFileSync(programDescriptorPath, JSON.stringify({
				config: {
					"github.com/sourcemint/sm/0": {
						"toolchain": {
	       					"vcs": "git",
	       					"os": "darwin",
	       					"platform": "node",
	       					"profile": "default",
	   						"paths": {
								"home": "."
							}
						},
						"package": {
							// Lookup package info online. Run with `--now` once to set to `true` in local `./sm/program.json`. 
							"resolve": false
						}
					}
				}
			}, null, 4));
		}
		if (!API.FS.existsSync(packageDescriptorPath)) {
			API.FS.mkdirsSync(API.PATH.dirname(packageDescriptorPath));
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
			if (!API.FS.existsSync(smLibPath)) {
				if (!API.FS.existsSync(PATH.dirname(smLibPath))) {
					API.FS.mkdirSync(PATH.dirname(smLibPath));
				}
				API.FS.symlinkSync(PATH.join(__dirname, ".."), smLibPath);
			}
			var binLibPath = API.PATH.join(self.basePath, ".sm", "bin", "sm");
			if (!API.FS.existsSync(PATH.dirname(binLibPath))) {
				API.FS.mkdirsSync(PATH.dirname(binLibPath));
			}
			if (!API.FS.existsSync(binLibPath)) {
				API.FS.symlinkSync("../../node_modules/sm/bin/sm-cli", binLibPath);
			}
		}
	}).then(function() {

		self.programDescriptor = new API.JSON_STORE(programDescriptorPath);

		if (!self.programDescriptor.has(SM_NS.concat(["toolchain"]))) {
			throw new Error("No toolchain config found at '" + self.programDescriptor.file + "'. We cannot turn an existing config into a toolchain config.");
		}
		var homePath = self.makeAbsolutePath(PATH.dirname(self.programDescriptor.file), self.programDescriptor.get(SM_NS.concat(["toolchain", "paths", "home"])));

		[
			"cache",
			"profiles",
			"try",
			"projects",
			"packages"
		].forEach(function(dir) {
			if (!self.programDescriptor.has(SM_NS.concat(["toolchain", "paths", dir]))) {
				self.programDescriptor.set(
					SM_NS.concat(["toolchain", "paths", dir]),
					self.makeRelativePath(homePath, API.PATH.join(homePath, dir))
				)
			}
			var path = self.makeAbsolutePath(PATH.dirname(self.programDescriptor.file), self.programDescriptor.get(SM_NS.concat(["toolchain", "paths", dir])));
			if (!API.FS.existsSync(path)) {
				API.FS.mkdirSync(path);
			}
		});
	}).then(function() {

		self.localProgramDescriptor = new API.JSON_STORE(localProgramDescriptorPath, {
			throwOnNoExist: false
		});

		var path = API.PATH.join(self.basePath, "sm-catalog.json");
		if (API.FS.existsSync(path)) {
			var data = API.FS.readFileSync(path);
	        data = data.toString().replace(/\$__DIRNAME/g, self.basePath);
			self.catalog = new API.CATALOG.Catalog(path, JSON.parse(data), {
	            format: "list",
	            packagesAttribute: "packages",
	            parent: null
	        });
	    }
	});
}

Config.prototype.get = function(ns) {
	// TODO: Only absolute path on applicable properties (need schema).
	var result = this.makeAbsolutePath(PATH.dirname(this.programDescriptor.file), this.programDescriptor.get(SM_NS.concat(ns)));
	var localResult = this.localProgramDescriptor.get(SM_NS.concat(ns));
	if (localResult) {
		// TODO: Only absolute path on applicable properties (need schema).
		localResult = this.makeAbsolutePath(PATH.dirname(this.localProgramDescriptor.file), localResult);
		if (result && typeof localResult === "object") {
			result = API.UTIL.deepMerge(result, localResult);
		} else {
			result = localResult;
		}
	}
	return result;
}

Config.prototype.set = function(scope, ns, value) {
	if (!this.localProgramDescriptor.exists()) {
		this.localProgramDescriptor.init();
	}
	if (scope === "default") {
		this.programDescriptor.set(SM_NS.concat(ns), value);
	} else
	if (scope === "local") {
		if (this.programDescriptor.has(SM_NS.concat(ns)) === null) {
			throw new Error("Can only set value in local config if value is set in default config. This ensures config options are somewhat documented.");
		}
		this.localProgramDescriptor.set(SM_NS.concat(ns), value);
	}
}

Config.prototype.makeAbsolutePath = function(basePath, path) {
	return makeAbsolutePath(basePath, path);
}

Config.prototype.makeRelativePath = function(basePath, path) {	
	var dirname = basePath;
	if (path.substring(0, dirname.length+1) === dirname + "/") {
		return "." + path.substring(dirname.length);
	}
	if (process.env.HOME && path.substring(0, process.env.HOME.length+1) === process.env.HOME + "/") {
		return "~" + path.substring(process.env.HOME.length);
	}
	return path;
}


function makeAbsolutePath(basePath, path) {
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
