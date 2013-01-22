
const ASSERT = require("assert");
const SM_NS = ["config", "github.com/sourcemint/sm/0"];

var API = null;
exports.setAPI = function(api) {
	API = api;
}

exports.for = function(basePath) {
    return new Config(basePath);
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

	var programDescriptorPath = API.PATH.join(self.basePath, "program.json");

	return API.Q.call(function() {
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
	if (typeof path !== "string") return path;
	if (path && /^\./.test(path)) {
		return API.PATH.join(this.basePath, path);
	}
	if (path && /^~\//.test(path)) {
		ASSERT(typeof process.env.HOME !== "undefined", "`process.env.HOME` is required!");
		return API.PATH.join(process.env.HOME, path.substring(2));
	}
	return path;
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
