
const ASSERT = require("assert");
const SEMVER = require("semver");
const URI_PARSER = require("./uri-parser");
const UTIL = require("sm-util/lib/util");
const TERM = require("sm-util/lib/term");
const WAITFOR = require("sm-util/lib/wait-for");
const URI = require("sm-util/lib/uri");


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

//console.log("MAKE LOCATOR FOR", descriptor);

		function resolve(pluginId, callback) {
			// Only resolve locator if `--now` was used once.
			if (!options.getConfig(["package", "resolve"])) {
				if (!options.now) {
					if (options.logger) options.logger.debug("Skip resolving (`options.now !== true`).");
					return callback(null, null);
				} else {
					options.setConfig("local", ["package", "resolve"], true);
				}
			}

			var locator = new Locator(descriptor);
			function resolve(pluginId, plugin, callback) {
				if (options.logger) options.logger.debug("Resolving locator '" + JSON.stringify(descriptor) + "' via plugin '" + pluginId + "'.");
		    	var opts = UTIL.copy(options);
		    	if (descriptor.pm === "archive") {
		    		opts.matchArchiveUrl = true;
		    	}
		    	return plugin.resolveLocator(locator, opts, function(err, newLocator) {
					if (options.logger) options.logger.debug("newLocator", newLocator);
		    		if (err) {
			    		err.message += " (while `resolveLocator()` for '" + pluginId + "')";
			    		return callback(err);
		    		}
		    		try {
						ASSERT(typeof newLocator.version !== "undefined" || typeof newLocator.selector !== "undefined", "`locator.version` or `locator.selector` must be set");
						ASSERT(typeof newLocator.vendor !== "undefined", "`locator.vendor` must be set");
						// Locator was resolved if the `getLocation` function was set.
						if (newLocator.hasOwnProperty("getLocation")) {
							locator = newLocator;
						}
				    	return callback(null);
				    } catch(err) {
			    		err.message += " (while `resolveLocator()` for '" + pluginId + "')";
			    		return callback(err);
				    }
		    	});
			}
			function resolveViaArchive(callback) {
		    	// Plugin for `pluginId` not found.
		    	// Next try pm for locator.
		    	if (pluginId === descriptor.pm) {
			    	// Default to `archive` plugin.
			    	return node.getPlugin("archive", function(err, plugin) {
			    		if (err) return callback(err);
			    		return resolve("archive", plugin, callback);
			    	});
		    	} else {
				    return node.getPlugin(descriptor.pm, function(err, plugin) {
			    		if (err) {
					    	// Plugin for `pluginId` not found.
					    	// Default to `archive` plugin.
					    	return node.getPlugin("archive", function(err, plugin) {
					    		if (err) return callback(err);
					    		return resolve("archive", plugin, callback);
					    	});				    			
			    		}
			    		return resolve(descriptor.pm, plugin, callback);
			    	});
		    	}
			}
			function finalize(err) {
    			if (err) return callback(err);
				// Locator was resolved if the `getLocation` function was set.
				if (locator.hasOwnProperty("getLocation")) {
					return callback(null, locator);
				} else {
					return callback(null, false);
				}
			}
		    return node.getPlugin(pluginId, function(err, plugin) {
		    	if (err) {
//		    		if (options.debug) console.log("non-fatal error", err.stack);
		    		return resolveViaArchive(finalize);
		    	}
	    		return resolve(pluginId, plugin, function(err) {
	    			if (err) {
//			    		if (options.debug) console.log("non-fatal error", err.stack);
			    		return resolveViaArchive(finalize);
	    			}
	    			return finalize();
	    		});
	    	});
		}

		if (typeof descriptor.pointer !== "undefined") {
			// See if 'pointer' is an exact version.
			if (SEMVER.valid(descriptor.pointer) || descriptor.version) {
				/*
				if (typeof descriptor.version !== "undefined") {
					console.error("descriptor", descriptor);
					throw new Error("Cannot resolve locator! `version` property may not be set!");
				}
				*/
				descriptor.version = descriptor.version || SEMVER.valid(descriptor.pointer);
				// `pointer` is just a version so we ask `descriptor.pm` to resolve locator.
				return resolve(descriptor.pm, callback);
			}
			// See if 'pointer' is a SEMVER version range.
			if (SEMVER.validRange(descriptor.pointer) !== null) {
				if (typeof descriptor.selector !== "undefined") {
					throw new Error("Cannot resolve locator! `selector` property may not be set!");
				}
				descriptor.selector = descriptor.pointer;
				// `pointer` is just a selector so we ask `descriptor.pm` to resolve locator.
				return resolve(descriptor.pm, callback);
			}
			// See if pointer is a URI.
			var parsedPointer = URI_PARSER.parse2(descriptor.pointer);
			if (parsedPointer && parsedPointer.hostname) {
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
				return resolve(pluginId, callback);
			}
			return resolve(descriptor.pm, callback);
		} else
		if (typeof descriptor.archive !== "undefined") {
			descriptor.pointer = descriptor.archive;
			return resolve(descriptor.pm, function(err, locator) {
				if (err) return callback(err);
				if (locator) {
					locator.url = descriptor.archive;
				}
				return callback(null, locator);
			});
		} else {
			return callback(null, false);
		}
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
	if (this.rev || this.version || this.url) return true;
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
	// NOTE: Always try and return something even if what we exactly asked for does not exit.
    if (format === "version") {
    	if (this.version !== false) return this.version;
    	if (this.url !== false) return this.url;
// TODO: display pure URIs.
    	return "[invalid locator: " + JSON.stringify(this) + "]";
    } else
    if (format === "minimal") {
    	if (this.rev !== false) {
	    	if (this.version !== false) return this.version + " - " + this.rev;
    		return this.rev;
    	}
    	if (this.version !== false) return this.version;
    	if (this.url !== false) return this.url;
    	return "NA";
    } else
    if (format === "location" || format === "uri" || !format) {
    	return this.getLocation("pointer");
    }
}
Locator.prototype.isOlderThan = function(node, locator, options, callback) {
	var self = this;
	if (!self.rev || !locator.rev || options.byVersion) {
		if (self.version && locator.version) {
			return callback(null, SEMVER.lt(self.version, locator.version));
		}
		if (!self.version && locator.version) {
			// We cannot determine if older so we return false.
			return callback(null, false);
		}
		throw new Error("TODO: Implement more comparison.");
	}
	if (node.summary.vcs) {
	    return node.getPlugin(node.summary.vcs.type, function(err, plugin) {
	    	if (err) return callback(err);
	    	return plugin.isRevDescendant(self.rev, locator.rev, options, function(err, found) {
	    		if (err) return callback(err);
				return callback(null, found);
	    	});
	    });
	} else if (node.summary.rev) {		
	    return node.getPlugin(node.summary.pm.locator || node.summary.pm.install, function(err, plugin) {
	    	if (err) return callback(err);
	    	return plugin.isRevDescendant(self.rev, locator.rev, options, function(err, found) {
	    		if (err) return callback(err);
				return callback(null, found);
	    	});
	    });
	}
	throw new Error("Don't have necessary info to compare.");
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

			function next() {
				// Engine does not match so we throw out the version we just got and look for previous.
				versionIndex = availableVersions.indexOf(version);
				if (versionIndex === -1) throw new Error("Sanity stop.");
				availableVersions.splice(versionIndex, 1);

				return iterate(callback);
			}
			version = SEMVER.maxSatisfying(availableVersions, selector) || false;

			if (!version) {
				if (availableVersions.indexOf(selector) === -1) return callback(null, false);
				version = selector;
			}

			if (/\d*\.\d*\.\d*-/.test(selector)) {
				// `selector` has a pre-release tag. Ensure version has same tag.
				var re = new RegExp("\\d*\\.\\d*\\.\\d*-" + selector.match(/-([^\.]*)/)[1]);
				if (!re.test(version)) {
					return next();
				}
			} else {
				// `selector` does not have a pre-release tag we ensure version does not either.
				if (/\d*\.\d*\.\d*-/.test(version)) {
					// Check next version.
					return next();
				}
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
				return next();
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
		    return node.getPlugin(node.summary.vcs.type, function(err, plugin) {
		    	if (err) return callback(err);
		    	return plugin.descriptorForSelector(self, selector, options, function(err, info) {
		    		if (err) return callback(err);
		    		var versions = {};
		    		versions[selector] = info.descriptor;
		    		return findBestSatisfying(versions, selector, null, function(err, found) {
		    			if (err) return callback(err);
		    			if (!found) {
		    				// TODO: In one case we get here if `engines` in descriptor has changed and
		    				//		 has been comitted but repo in cache has not pulled latest changes.
		    				//		 We should update repo in cache whenever we commit to project repo
		    				//		 using a post-commit hook.
		    				if (options.verbose) TERM.stdout.writenl("\0yellow([sm] WARNING: `engines` declared in latest 'package.json' at '" + selector + "' for '" + node.summary.path + "' is not compatible with your 'engine'!\0)");
		    				return callback(null, false);
		    			}
		    			return callback(null, makeLocator(info.rev, info.version));
		    		});
		    	});
		    });
		}
//console.log(node.summary.vcs.type, node.latest[node.summary.vcs.type]);

		if (node.latest[node.summary.vcs.type] && node.latest[node.summary.vcs.type].versions) {
			var lastRev = false;
    		return findBestSatisfying(node.latest[node.summary.vcs.type].versions, selector, function(version, callback) {
			    return node.getPlugin(node.summary.vcs.type, function(err, plugin) {
			    	if (err) return callback(err);
			    	return plugin.descriptorForSelector(self, version, options, function(err, info) {
			    		if (err) return callback(err);
			    		lastRev = info.rev;
			    		return callback(null, info.descriptor);
			    	});
			    });
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
			    return node.getPlugin(self.pm, function(err, plugin) {
			    	if (err) return callback(err);
			    	return plugin.descriptorForSelector(self, version, options, function(err, info) {
			    		if (err) return callback(err);
			    		if (!info) return callback(null, false);
			    		lastRev = info.rev;
			    		return callback(null, info.descriptor);
			    	});
			    });
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
