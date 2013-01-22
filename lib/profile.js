
const PATH = require("path");
const ASSERT = require("assert");
const SM_NS = ["config", "github.com/sourcemint/sm/0"];

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
	self.credentialsDescriptor = null;
	self.programDescriptor = null;
}

Profile.prototype.__init = function(program) {
	var self = this;
	self.program = program;

	if (!PATH.existsSync(self.profilePath)) {
		API.FS_RECURSIVE.mkdirSyncRecursive(self.profilePath);		
	}
	var credentialsDescriptorPath = API.PATH.join(self.profilePath, "credentials.json");

	self.credentialsDescriptor = new API.JSON_STORE(credentialsDescriptorPath);
	if (!self.credentialsDescriptor.exists()) {
		self.credentialsDescriptor.init();
	}
}

Profile.prototype.getName = function() {
	return PATH.basename(this.profilePath);
}

Profile.prototype.getCredentials = function(ns) {
	if (!this.credentialsDescriptor) return;
	if (!API.UTIL.isArrayLike(ns)) {
		ns = [ ns ];
	}
	return this.credentialsDescriptor.get(ns);
}

Profile.prototype.setCredentials = function(ns, value) {
	if (!this.credentialsDescriptor) return;
	if (!API.UTIL.isArrayLike(ns)) {
		ns = [ ns ];
	}
	return this.credentialsDescriptor.set(ns, value);
}
