
const PATH = require("path");
const ASSERT = require("assert");
const PINF = require("pinf");
const JSON_STORE = require("sm-util/lib/json-store");
const UTIL = require("sm-util/lib/util");
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
	self.programCredentials = null;
}

Profile.prototype.__init = function(program, packageRootPath) {
	var self = this;
	self.program = program;

	if (!API.FS.existsSync(self.profilePath)) {
		API.FS.mkdirsSync(self.profilePath);		
	}
	var credentialsDescriptorPath = API.PATH.join(self.profilePath, "credentials.json");

	try {
		/*
		// TODO: Log in debug mode.
		console.log(self.programCredentials = PINF.forProgram({
			CWD: packageRootPath,
			PINF_MODE: process.env.PINF_MODE || false
		})(module).config());
		*/
		self.programCredentials = PINF.forProgram({
			CWD: packageRootPath,
			PINF_MODE: process.env.PINF_MODE || false
		})(module).credentials();
	} catch(err) {
		console.warn(err);
	}

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
	var credentials = this.credentialsDescriptor.get(ns);
	if (this.programCredentials) {
		credentials = UTIL.deepMerge(credentials || {}, JSON_STORE.getFromObject(this.programCredentials, ns) || {});
	}
	return credentials;
}

Profile.prototype.setCredentials = function(ns, value) {
	if (!this.credentialsDescriptor) return;
	if (!API.UTIL.isArrayLike(ns)) {
		ns = [ ns ];
	}
	if (this.programCredentials && JSON_STORE.getFromObject(this.programCredentials, ns)) {
		throw new Error("Cannot set credentials for ns '" + ns.join(" -> ") + "' as credentials are being set by program.");
	}
	return this.credentialsDescriptor.set(ns, value);
}
