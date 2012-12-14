

const SM_NS = ["config", "github.com/sourcemint/sm"];

var API = null;
exports.setAPI = function(api) {
	API = api;
}

exports.for = function(profilePath) {
    return new Profile(profilePath);
}


var Profile = function(profilePath) {
	var self = this;
	self.profilePath = profilePath;
	self.program = null;
}

Profile.prototype.__init = function(program) {
	var self = this;
	self.program = program;

	var programRuntimeDescriptorPath = API.PATH.join(self.profilePath, "program.rt.json");
	return API.Q.call(function() {
		if (!API.PATH.existsSync(programRuntimeDescriptorPath)) {
			API.FS_RECURSIVE.mkdirSyncRecursive(API.PATH.dirname(programRuntimeDescriptorPath));
			API.FS.writeFileSync(programRuntimeDescriptorPath, JSON.stringify({
				config: {
					"github.com/sourcemint/sm": {
						"paths": {
							"home": self.profilePath
						}
					}
				}
			}, null, 4));
		}
	}).then(function() {

		self.programRuntimeDescriptor = new API.JSON_STORE(programRuntimeDescriptorPath);

		if (!self.programRuntimeDescriptor.has(SM_NS.concat(["paths", "try"]))) {
			self.programRuntimeDescriptor.set(
				SM_NS.concat(["paths", "try"]),
				API.PATH.join(self.programRuntimeDescriptor.get(SM_NS.concat(["paths", "home"])), "try")
			)
		}

		var tryPath = self.programRuntimeDescriptor.get(SM_NS.concat(["paths", "try"]));
		if (!API.PATH.existsSync(tryPath)) {
			API.FS.mkdirSync(tryPath);
		}

	});
}

Profile.prototype.getConfig = function(ns) {
	return this.programRuntimeDescriptor.get(SM_NS.concat(ns));
}
