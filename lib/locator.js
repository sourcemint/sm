
const ASSERT = require("assert");
const SEMVER = require("semver");
const URI_PARSER = require("./uri-parser");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const WAITFOR = require("sourcemint-util-js/lib/wait-for");
const URI = require("sourcemint-util-js/lib/uri");


exports.makeLocator = function(node, descriptor, options, callback) {

	try {

		descriptor = UTIL.copy(descriptor);
		delete descriptor.viaAttribute;
		delete descriptor.descriptor;
		delete descriptor.bundled;
		delete descriptor.optional;

		ASSERT(typeof descriptor.pm !== "undefined", "`descriptor.pm` must be set");
		ASSERT(typeof descriptor.name !== "undefined", "`descriptor.name` must be set");

		if (typeof descriptor.pointer === "undefined") {
			if (typeof descriptor.location !== "undefined") {
				descriptor.pointer = descriptor.location;
				delete descriptor.location;
			} else
			if (typeof descriptor.version !== "undefined") {
				descriptor.pointer = descriptor.version;
				delete descriptor.version;
			}
		}

		if (typeof descriptor.pointer === "undefined") return callback(null, false);

//console.log("MAKE LOCATOR FOR", descriptor);

		function resolve(pluginId) {
			var locator = new Locator(descriptor);
			function resolve(pluginId, plugin) {
		    	return plugin.resolveLocator(locator, options).then(function() {
					ASSERT(typeof locator.version !== "undefined" || typeof locator.selector !== "undefined", "`locator.version` or `locator.selector` must be set");
					ASSERT(typeof locator.vendor !== "undefined", "`locator.vendor` must be set");
			    	return callback(null, locator);
		    	}, function(err) {
		    		err.message += " (while `resolveLocator()` for '" + pluginId + "')";
		    		throw err;
		    	});
			}
		    return node.getPlugin(pluginId).then(function(plugin) {
	    		return resolve(pluginId, plugin);
	    	}, function(err) {
		    	// Plugin for `pluginId` not found.
		    	// Default to `archive` plugin.
		    	return node.getPlugin("archive").then(function(plugin) {
		    		return resolve("archive", plugin);
		    	});
		    }).fail(callback);
		}

		// See if 'pointer' is an exact version.
		if (SEMVER.valid(descriptor.pointer)) {
			if (typeof descriptor.version !== "undefined") {
				throw new Error("Cannot resolve locator! `version` property may not be set!");
			}
			descriptor.version = SEMVER.valid(descriptor.pointer);
			// `pointer` is just a version so we ask `descriptor.pm` to resolve locator.
			return resolve(descriptor.pm);
		}
		// See if 'pointer' is a SEMVER version range.
		if (SEMVER.validRange(descriptor.pointer) !== null) {
			if (typeof descriptor.selector !== "undefined") {
				throw new Error("Cannot resolve locator! `selector` property may not be set!");
			}
			descriptor.selector = descriptor.pointer;
			// `pointer` is just a selector so we ask `descriptor.pm` to resolve locator.
			return resolve(descriptor.pm);
		}
		// See if pointer is a URI.
		var parsedPointer = URI_PARSER.parse2(descriptor.pointer);
		if (parsedPointer) {
			// Remove domain ending to leave host name. (e.g. remove `.com`).
			var hostname = parsedPointer.hostname.split(".");
			for (var i=hostname.length-1 ; i>=0 ; i--) {
				if (URI.TLDS.indexOf(hostname[i].toUpperCase()) !== -1) {
					hostname.splice(i, 1);				
				}
			}
			// Subdomains should be suffixes, not prefixes.
			hostname.reverse();
			var pluginId = hostname.join("-");
			// `pointer` is a URI so we ask plugin `pluginId` (based on hostname) to resolve locator.
			return resolve(pluginId);
		}
		// `pointer` was is a URI so we ask plugin `descriptor.pm` to resolve locator as last resort.
		return resolve(descriptor.pm);
	} catch(err) {
		return callback(err);
	}
}




var Locator = function(descriptor) {
	this.descriptor = descriptor;
	this.pm = descriptor.pm || false;
	this.vendor = this.descriptor.pm || false;
	this.id = this.descriptor.name || false;
	this.rev = this.descriptor.rev || false;
	this.setVersion(this.descriptor.version || false);
	this.selector = this.descriptor.selector || false;
	this.url = false;
}
Locator.prototype.getLocation = function(type) {
	throw new Error("This function should be replaced when `plugin.resolveLocator()` is called above!");
}
Locator.prototype.setRev = function(rev) {
	this.rev = rev;
}
Locator.prototype.setVersion = function(version) {
	if (version) version = version.replace(/^v/, "");
	this.version = version;
}
Locator.prototype.isResolved = function() {
	if (this.rev || this.version) return true;
	return false;
}
Locator.prototype.clone = function() {
	var locator = new Locator(UTIL.copy(this.descriptor));
	for (var name in this) {
		locator[name] = this[name];
	}
	return locator;
}
Locator.prototype.equals = function(locator) {
	if (!locator) return false;
	if (this.rev && locator.rev) {
		if (this.rev === locator.rev) return true;
		return false;
	}
	if (this.version && locator.version && this.version === locator.version) return true;
	if (this.url && locator.url && this.url === locator.url) return true;
	// TODO: Implement more compare rules?
    //console.log("COMPARE", this, locator);
	return false;
}
Locator.prototype.toString = function(format) {
    if (format === "minimal") {
    	if (this.rev !== false) {
	    	if (this.version !== false) return this.version + " - " + this.rev;
    		return this.rev;
    	}
    	if (this.version !== false) return this.version;
    	if (this.url !== false) return this.url;
// TODO: display pure URIs.
    	return "[invalid locator: " + JSON.stringify(this) + "]";
    } else
    if (format === "location" || format === "uri" || !format) {
    	return this.getLocation("pointer");
    }
}
Locator.prototype.isOlderThan = function(node, locator, options, callback) {
	var self = this;
	if (!self.rev || !locator.rev) {
		throw new Error("TODO: Implement `version` comparison.");
	}
	// NOTE: `rev` is only set when dealing with packages from VCS.
	if (!node.summary.vcs) {
		throw new Error("Cannot see if locator is older as we do not have VCS info available!");
	}
    return node.getPlugin(node.summary.vcs.type).then(function(plugin) {
    	return plugin.hasRevInHistory(locator.rev, options).then(function(found) {
			return callback(null, !found);
    	});
    }).fail(callback);
}
Locator.prototype.getLatest = function(node, options, callback) {
	try {
		var self = this;
		var latest = false;
		if (node.summary.vcs) {
			ASSERT(typeof node.latest[node.summary.vcs.type] !== "undefined");
			latest = node.latest[node.summary.vcs.type];
		} else
		if (node.latest[self.pm]) {
			latest = node.latest[self.pm];
		}
		if (!latest) return callback(null, false);
		var locator = self.clone();
		locator.setRev(latest.rev || false);
		locator.setVersion(latest.version || false);
		return callback(null, locator);
	} catch(err) {
		return callback(err);
	}
}
Locator.prototype.getLatestSatisfying = function(node, options, callback) {
	var self = this;

	var selector = self.selector || self.version || self.rev || false;

	function findBestSatisfying(versions, selector, loadDescriptor, callback) {
		var availableVersions = (UTIL.isArrayLike(versions))?versions:Object.keys(versions);
		if (availableVersions.length === 0) return callback(null, false);
		var version = false;
		var versionIndex = -1;
		var engineVersion = node.summary.newEngineVersion || node.summary.engineVersion || false;
		function iterate(callback) {
			if (availableVersions.length <= 0) return callback(null, false);
			version = SEMVER.maxSatisfying(availableVersions, selector) || false;
			if (!version) {
				if (availableVersions.indexOf(selector) === -1) return callback(null, false);
				version = selector;
			}
			if (!node.summary.engineName || !engineVersion) {
				// We don't have a desired engine/platform so we just use latest satisfying version.
				return callback(null, version);
			}
			function check(descriptor) {
				// Check if version specifies `engines` and if it does ensure it matches our engine/platform version.
				if (
					!descriptor ||
					!descriptor.engines ||
					!descriptor.engines[node.summary.engineName] ||
					SEMVER.satisfies(engineVersion, descriptor.engines[node.summary.engineName])									
				) {
					return callback(null, version);
				}
				// Engine does not match so we throw out the version we just got and look for previous.
				versionIndex = availableVersions.indexOf(version);
				if (versionIndex === -1) throw new Error("Sanity stop.");
				availableVersions.splice(versionIndex, 1);

				return iterate(callback);
			}
			if (UTIL.isArrayLike(versions)) {
				return loadDescriptor(version, function(err, descriptor) {
					if (err) return callback(err);
					return check(descriptor);
				});
			} else {
				return check(versions[version]);
			}
		}
		return iterate(callback);
	}

	function makeLocator(rev, version) {
		var locator = self.clone();
		locator.setRev(rev || false);
		locator.setVersion(version || false);
		return locator;
	}

	function checkVCS(callback) {
		if (!node.summary.vcs) return callback(null, false);
		if (!selector) {
			return self.getLatest(node, options, callback);
		}
		function checkSelector(callback) {
		    return node.getPlugin(node.summary.vcs.type).then(function(plugin) {
		    	return plugin.descriptorForSelector(self, selector, options).then(function(info) {
		    		var versions = {};
		    		versions[selector] = info.descriptor;
		    		return findBestSatisfying(versions, selector, null, function(err, found) {
		    			if (err) return callback(err);
		    			if (!found) {
		    				TERM.stdout.writenl("\0yellow([sm] WARNING: `engines` declared in latest 'package.json' at '" + selector + "' is not compatible with your 'engine'!\0)");
		    				return callback(null, false);
		    			}
		    			return callback(null, makeLocator(info.rev, info.version));
		    		});
		    	});
		    }).fail(callback);
		}
//console.log(node.summary.vcs.type, node.latest[node.summary.vcs.type]);

		if (node.latest[node.summary.vcs.type] && node.latest[node.summary.vcs.type].versions) {
			var lastRev = false;
    		return findBestSatisfying(node.latest[node.summary.vcs.type].versions, selector, function(version, callback) {
			    return node.getPlugin(node.summary.vcs.type).then(function(plugin) {
			    	return plugin.descriptorForSelector(self, version, options).then(function(info) {
			    		lastRev = info.rev;
			    		return callback(null, info.descriptor);
			    	});
			    }).fail(callback);
    		}, function(err, found) {
    			if (err) return callback(err);
    			if (!found) return checkSelector(callback);
    			return callback(null, makeLocator(lastRev, found));
    		});
		}
		return checkSelector(callback);
	}

	try {
		return checkVCS(function(err, locator) {
			if (err) return callback(err);
			if (locator) return callback(null, locator);
			if (!node.latest[self.pm] || !node.latest[self.pm].versions) return callback(null, false);
			var lastRev = false;
    		return findBestSatisfying(node.latest[self.pm].versions, selector, function(version, callback) {
			    return node.getPlugin(self.pm).then(function(plugin) {
			    	return plugin.descriptorForSelector(self, version, options).then(function(info) {
			    		if (!info) return callback(null, false);
			    		lastRev = info.rev;
			    		return callback(null, info.descriptor);
			    	});
			    }).fail(callback);
    		}, function(err, found) {
    			if (err) return callback(err);
				if (!found) return callback(null, false);
				return callback(null, makeLocator(lastRev, found));
    		});
		});
	} catch(err) {
		return callback(err);
	}
}
