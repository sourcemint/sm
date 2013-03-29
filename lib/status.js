
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("graceful-fs");
const FS_EXTRA = require("sm-util/lib/fs");
const Q = require("sm-util/lib/q");
const OS = require("sm-util/lib/os");
const UTIL = require("sm-util/lib/util");
const TERM = require("sm-util/lib/term");
const WAITFOR = require("sm-util/lib/wait-for");
const LOCATOR = require("./locator");
const CATALOG = require("./catalog");
const HELPERS = require("./helpers");
const SEMVER = require("semver");
const PINF = require("pinf");


var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new Status(packageRootPath);
	}
	return instances[packageRootPath];
}


var Status = function(packageRootPath) {
	var self = this;

	self.embellishFsTree = function(fsTree, options, callback) {
	    options = options || {};
        function traverse(callback) {
            if (typeof fsTree.traverse === "function") {
                fsTree.traverse(callback);
            } else {
                // We have a list of nodes to traverse instead of a tree.
                // We need to traverse all parent nodes from top down for each node
                // so that all the contextual information for the node is available.
                // NOTE: When we have a list of nodes, the deep status is NOT available.
                var traversed = {};
                var traverse = [];
                fsTree.forEach(function(node) {
                    var tNode = node;
                    while(tNode.parent) {
                        traverse.push(tNode);
                        tNode = tNode.parent;
                    }
                    traverse.push(tNode);
                    traverse.reverse().forEach(function(tNode) {
                        if (!traversed[tNode.relpath]) {
                            traversed[tNode.relpath] = true;
                            callback(tNode);
                        }
                    });
                });
            }
        }
    	var waitFor = WAITFOR.parallel(function(err) {
    		if (err) return callback(err);
            var waitFor = WAITFOR.parallel(function(err) {
                if (err) return callback(err);

                try {
                    if (fsTree.top && typeof fsTree.top.collectDeepHints === "function") {
                        fsTree.top.collectDeepHints();
                    }
                } catch(err) {
                    return callback(err);
                }

                return callback(null, fsTree);
            });
            traverse(function(node) {
                waitFor(function(done) {
                    return finalize(node, options, function(err) {
                        if (err) return done(err);

                        return generateHints(node, options, done);
                    });
                });
            });
            waitFor();
    	});
    	traverse(function(node) {

            if (node.scanOnly) return;

            addFunctions(node, options);

    		waitFor(function(done) {

                populateLocator(node, options);

    		    return loadStatus(node, options, function(err) {
                    if (err) return done(err);

                    return summarize(node, options, function(err) {
                        if (err) return done(err);

                        return loadLatest(node, options, function(err) {
                            if (err) return done(err);

                            return done();
                        });
                    });
                });
    		});
    	});
    	waitFor();
	}

	return self;
}


function populateLocator(node, options) {
    var self = node;
    function findDependency(dependencies) {
        if (Array.isArray(dependencies)) {
            for (var i=0 ; i<dependencies.length ; i++) {
                if (dependencies[i] === self.name) {
                    // Found but no version specified.
                    return "*";
                }
            }
        } else {
            for (var key in dependencies) {
                if (key === self.name) {
                    if (dependencies[key] === "" || dependencies[key] === "latest") {
                        return "*";
                    } else {
                        return dependencies[key];
                    }
                }
            }
        }
        return false;
    }

    function normalizeMapping(locator) {
        if (UTIL.isArrayLike(locator.pointer)) {
            locator.pm = locator.pointer[0];
            locator.config = UTIL.deepCopy(locator.pointer[2] || {});
            locator.pointer = locator.pointer[1];
            locator.descriptor = (locator.config && locator.config.descriptor) || {};
            if (locator.config && locator.config.descriptor) delete locator.config.descriptor;
        }
    }

    var locator = {
        // The name of the attribute used.
        viaAttribute: false,
        // The name of the declared package manager to use.
        pm: false,
        // The 'selector' (in case of default registry; i.e. npm) or 'location' uri.
        pointer: false,
        // Config for the package installer.
        config: {},
        // Overrides for the package descriptor.
        descriptor: {},
        // Flag to indicate whether dependency is or should be bundled.
        bundled: false,
        // Flag to indicate whether dependency is optional.
        optional: false,
        // Flag to indicate whether dependency is needed for dev only.
        dev: false
    };

    if (self.parent) {
        if (self.parent.descriptors.merged.mappings && (locator.pointer = findDependency(self.parent.descriptors.merged.mappings))) {
            locator.viaAttribute = "mappings";
            normalizeMapping(locator);
        } else
        if (self.parent.descriptors.merged.devMappings && (locator.pointer = findDependency(self.parent.descriptors.merged.devMappings))) {
            locator.viaAttribute = "devMappings";
            locator.dev = true;
            normalizeMapping(locator);
        } else
        if (self.parent.descriptors.merged.optionalMappings && (locator.pointer = findDependency(self.parent.descriptors.merged.optionalMappings))) {
            locator.viaAttribute = "optionalMappings";
            locator.optional = true;
            normalizeMapping(locator);
        } else
        if (self.parent.descriptors.merged.dependencies && (locator.pointer = findDependency(self.parent.descriptors.merged.dependencies))) {
            // TODO: Only default to `npm` if we are running on nodejs. Otherwise leave empty.
            locator.pm = "npm";
            locator.viaAttribute = "dependencies";
        } else
        if (self.parent.descriptors.merged.devDependencies && (locator.pointer = findDependency(self.parent.descriptors.merged.devDependencies))) {
            // TODO: Only default to `npm` if we are running on nodejs. Otherwise leave empty.
            locator.pm = "npm";
            locator.viaAttribute = "devDependencies";
            locator.dev = true;
        } else
        if (self.parent.descriptors.merged.optionalDependencies && (locator.pointer = findDependency(self.parent.descriptors.merged.optionalDependencies))) {
            // TODO: Only default to `npm` if we are running on nodejs. Otherwise leave empty.
            locator.pm = "npm";
            locator.viaAttribute = "optionalDependencies";
            locator.optional = true;
        }
        if (self.parent.descriptors.merged.bundleDependencies && findDependency(self.parent.descriptors.merged.bundleDependencies)) {                
            // TODO: Only default to `npm` if we are running on nodejs. Otherwise leave empty.
            if (locator.pointer === false) {
                locator.pointer = "__DERIVE__";
                locator.pm = "npm";
            }
            locator.bundled = true;
        }
    } else
    if(self.level === 0 && options.topPointer) {
        locator.pointer = options.topPointer;
        locator.viaAttribute = "mappings";
        normalizeMapping(locator);
    }
    if (locator.pointer !== false && /^\.{1,2}\//.test(locator.pointer) && self.parent) {
        var oldPointer = locator.pointer;
        locator.pointer = PATH.join(self.parent.path, locator.pointer);
        // Path may not traverse higher than declaring package.
        if (locator.pointer.substring(0, self.parent.path.length) !== self.parent.path) {
            throw new Error("Dependency location '" + oldPointer + "' may not point higher than declaring package ");
        }
    }
    // Fix `0.x.`.
    if (/.\.$/.test(locator.pointer)) {
        locator.pointer = locator.pointer.substring(0, locator.pointer.length -1);
    }
    self.descriptors.locator = (locator.pointer !== false)?locator:false;

    // "mappings": { "alias": "." }
    if (self.descriptors.locator && self.descriptors.locator.pointer === ".") {
        self.descriptors.locator = self.parent.descriptors.locator;
        if (options.debug) console.log("[sm] Set locator from parent.");
    }

    // If any required dependencies are not installed we ensure that locators will be resolved.
    if (!self.exists && self.descriptors.locator && self.descriptors.locator.viaAttribute) {
        if ([
            "dependencies",
            "mappings"
        ].indexOf(self.descriptors.locator.viaAttribute) !== -1) {
            if (!options.getConfig(["package", "resolve"])) {
                options.setConfig("local", ["package", "resolve"], true);
            }
        }
    }
}

function loadStatus(node, options, callback) {

	// Always get status for some default plugins.
	// TODO: Adjust these based on the platform.    
	node.status = {
		"git": true,
		"npm": true
	};
    node.latest = {};

	function loadOutstanding(callback) {
		var count = 0;
		var waitFor = WAITFOR.parallel(function(err) {
			if (err) return callback(err);
			if (count > 0) {
				return loadOutstanding(callback);
			}
			return callback(null);
		});
		UTIL.forEach(node.status, function(pair) {
			if (pair[1] === true) {
				count += 1;
				waitFor(function(done) {
					return node.getPlugin(pair[0], function(err, plugin) {
                        if (err) return done(err);
						// A plugin may request to fetch status for other plugins.
						node.requestStatusFor = function(pluginId) {
							if (typeof node.status[pluginId] !== "undefined") return;
							node.status[pluginId] = true;
						}
						return plugin.status(options, function(err, status) {
                            if (err) return done(err);
							delete node.requestStatusFor;
							node.status[pair[0]] = status || false;
                            return done();
                        });
					});
				});
			}
		});
		waitFor();
	}

	loadOutstanding(callback);
}

function summarize(node, options, callback) {
    try {

        if (node.descriptors.package) {
            if (node.descriptors.package.catalog && node.descriptors.package.shrinkwrap) {
                TERM.stdout.writenl("");
                TERM.stdout.writenl("\0red([sm] ERROR: You cannot set both `catalog: true` and `shrinkwrap: true` in package descriptor for '" + node.path + "'. Pick one!.\0)");
                TERM.stdout.writenl("");
                throw true;
            }
            if (node.descriptors.package.catalog && node.descriptors.package.pm !== "sm") {
                TERM.stdout.writenl("");
                TERM.stdout.writenl("\0red([sm] ERROR: If you set `catalog: true` in package descriptor for '" +self.path + "' you must also set `pm: \"sm\"`!\0)");
                TERM.stdout.writenl("");
                throw true;
            }
        }

        var inParent = (!node.exists && !node.symlinked && node.parent && node.parent.findNameInTransitiveParents(node)) || false;
        if (node.circular || inParent) {
            var parentNode = node.circular || inParent;            
            var locator = node.descriptors.locator;
            node.descriptors = UTIL.copy(parentNode.descriptors);
            node.descriptors.locator = locator;
            node.exists = parentNode.exists;
        }

        node.descriptor = {
            package: node.descriptors.merged || false,
            // TODO: Get rid of this as we don't seem to need it.
            program: node.descriptors.program || false
        };

        function summarize(callback) {

            // Take a best guess at all package attributes by using:
            //   1) Positively declared values first
            //   2) Inferring from environment
            //   3) Inferring from other attributes
            // The goal is to have values for as many attributes as possible.
            var info = node.summary = {
                name: node.name,
                uid: false,
                relpath: node.relpath,
                level: node.level,
                path: node.path,
                dir: node.dir,
                symlinked: node.symlinked,
                inParent: (inParent)?(node.level - inParent.level):false,
                version: false,
                versionStream: false,
                rev: false,
                dynamic: false,
                publish: false,
                public: false,
                installed: node.exists,
                declared: false,
                bundled: false,
                optional: false,
                dev: false,
                pm: {
                    locator: false,
                    install: false,
                    publish: false
                },
                declaredLocator: false,
                actualLocator: false,
                latestLocator: false,
                newLocator: false,
                newInLocator: false,
                newOutLocator: false,
                sticky: false,
                newStickyLocator: false,
                locked: false,
                newLockedLocator: false,
                engineName: false,
                engineVersion: false,
                newEngineVersion: false,
                vcs: false,
    //            git: false,
                // TODO: Deep copy object?
                scripts: (node.descriptor.package && node.descriptor.package.scripts) || false,
                // TODO: Deep copy object?
                directories: (node.descriptor.package && node.descriptor.package.directories) || {},
                repositoryUri: false,
                homepageUri: false
            };
            if (typeof info.directories.lib === "undefined") {
                info.directories.lib = "lib";
            }

            if (node.status.git) {
                info.vcs = {
                    type: "git",
                    raw: node.status.git,
                    dirty: node.status.git.dirty || false,
                    rev: node.status.git.rev || false,
                    tagged: node.status.git.tagged || false,
                    version: node.status.git.version || false,
                    selector: node.status.git.selector || false,
                    writable: node.status.git.writable || false,
                    ahead: node.status.git.ahead || false,
                    behind: node.status.git.behind || false
                };
                if (node.status.git.writable) {
                    info.vcs.mode = "write";
                } else {
                    info.vcs.mode = "read";
                }
                if (node.status.git.raw.remoteUri) {
                    info.vcs.pointer = node.status.git.raw.remoteUri;
                    // HACK: We should ask all plugins to match uri.
                    if (/github\.com/.test(info.vcs.pointer)) {
                        info.vcs.pm = "github";
                    }
                }
            } else {
                // TODO: Check for other VCSs.
            }

            // Detect install script (like npm does)
            if (!info.scripts || !info.scripts.install) {
                if (FS.existsSync(PATH.join(node.path, "install"))) {
                    if (!info.scripts) info.scripts = {};
                    info.scripts.install = "install";
                }
            }

            if (node.descriptors.locator) {
                if (!info.pm.locator && typeof node.descriptors.locator.pm !== "undefined") {
                    info.pm.locator = node.descriptors.locator.pm;
                }
                if (!info.pm.install && node.descriptors.locator.descriptor && typeof node.descriptors.locator.descriptor.pm !== "undefined") {
                    info.pm.install = node.descriptors.locator.descriptor.pm;
                }
            } else
            if (node.descriptors.smSource) {
                if (!info.pm.locator && node.descriptors.smSource.locator && node.descriptors.smSource.locator.pm) {
                    info.pm.locator = node.descriptors.smSource.locator.pm;
                }
                if (!info.pm.install && node.descriptors.smSource.descriptor && typeof node.descriptors.smSource.descriptor.pm !== "undefined") {
                    info.pm.install = node.descriptors.smSource.descriptor.pm;
                }
            }
            if (!info.pm.install && node.descriptor.package && typeof node.descriptor.package.pm !== "undefined") {
                info.pm.install = node.descriptor.package.pm;
            }
            if (!info.pm.install && info.vcs && node.latest[info.vcs.type] && node.latest[info.vcs.type].descriptor && typeof node.latest[info.vcs.type].descriptor.pm !== "undefined") {
                info.pm.install = node.latest[info.vcs.type].descriptor.pm;
            }
            if (!info.pm.install) info.pm.install = (info.pm.locator)?info.pm.locator:"sm";
            if (!info.pm.locator) info.pm.locator = info.pm.install;
            if (!info.pm.publish) info.pm.publish = info.pm.locator;

            if (node.descriptors.smSource && node.descriptors.smSource.dynamic) {
                info.dynamic = node.descriptors.smSource.dynamic;
            }

            function repositoryFromDescriptor(descriptor) {
                var repositories = descriptor.repository || descriptor.repositories || false;
                if (repositories && !UTIL.isArrayLike(repositories)) {
                    repositories = [ repositories ];
                }
                var url = false;
                if (repositories) {
                    var repository = repositories[0];
                    var url = false;
                    if (typeof repository === "string") {
                        url = repository;
                    } else
                    if(typeof repository === "object" && repository.url) {
                        url = repository.url;
                    }
                }
                try {
                    var parsedUrl = URI_PARSER.parse(url);
                    if (parsedUrl && parsedUrl.uris && parsedUrl.uris.homepage) {
                        url = parsedUrl.uris.homepage;
                    }
                } catch(err) {}
                return url;
            }
            if (node.descriptor.package) {
                info.uid = node.descriptor.package.uid || false;
                info.repositoryUri = repositoryFromDescriptor(node.descriptor.package);
                info.homepageUri = (typeof node.descriptor.package.homepage === "string" && node.descriptor.package.homepage) || false;
                info.version = node.descriptor.package.version || false;
                if (info.version) {
                    var m = info.version.match(/^(\d*\.\d*\.\d*-([^\.]*)\.)(\d*)$/);
                    if (m) {
                        info.versionStream = m[2];
                    }
                }
                info.publish = node.descriptor.package.publish || false;
                info.public = node.descriptor.package.public || false;
            }
            if (info.vcs && node.status[info.vcs.type]) {
                info.rev = node.status[info.vcs.type].rev || false;
                /*
                // NOTE: We don't need this any more as the version next to the package name will show rev or version
                //       depending on whether repo is tagged or not.
                // TODO: Remove this once we know for sure we don't need it. (Feb 2013)
                // If VCS is not dirty and current rev is tagged it must equal version in package descriptor.
                if (
                    !info.vcs.dirty &&
                    node.status[info.vcs.type].version &&
                    !SEMVER.eq(node.status[info.vcs.type].version, info.version)
                ) {
                    TERM.stdout.writenl("\0yellow([sm] WARNING: Package descriptor for package '" + node.path + "' does not set `version` to `" + node.status[info.vcs.type].version + "` which is the latest version tagged in " + info.vcs.type + ".\0)");
                }
                */
            } else
            if (node.descriptor.package && node.descriptor.package.rev) {
                info.rev = node.descriptor.package.rev;
            }
            if (info.vcs && node.latest[info.vcs.type] && node.latest[info.vcs.type].descriptor) {
                if (!info.repositoryUri) info.repositoryUri = repositoryFromDescriptor(node.latest[info.vcs.type].descriptor);
                if (!info.homepageUri) info.homepageUri = node.latest[info.vcs.type].descriptor.homepage || false;
            }
            if (info.pm.locator && node.latest[info.pm.locator] && node.latest[info.pm.locator].descriptor) {
                if (!info.repositoryUri) info.repositoryUri = repositoryFromDescriptor(node.latest[info.pm.locator].descriptor);
                if (!info.homepageUri) info.homepageUri = node.latest[info.pm.locator].descriptor.homepage || false;
            }
            if (!info.repositoryUri && info.vcs && node.status[info.vcs.type]) {
                info.repositoryUri = node.status[info.vcs.type].raw.remoteUri;
            }

            // Determine where package is from.
            var locatorPointer = {};
            // If parent package specifies a locator it is king.
            if (node.descriptors.locator) {
                locatorPointer = node.descriptors.locator;
            } else
            // If package is then cloned we look at the clone uri.
            if (info.vcs && info.vcs.pointer) {
                locatorPointer = { pointer: info.vcs.pointer };
            } else
            // Have not found any concrete source yet so we look for install meta info.
            if (node.descriptors.smSource && node.descriptors.smSource.locator) {
                locatorPointer = node.descriptors.smSource.locator;
            } else
            // We have a likely bundled package where pm can detect info about package
            // due to pm specific properties in package descriptor.
            if (info.pm.locator && node.status[info.pm.locator] && UTIL.len(node.status[info.pm.locator]) > 0) {
                locatorPointer = node.status[info.pm.locator];
            } else
            // See if package descriptor specifies repository.
            if (node.summary.repositoryUri) {
                locatorPointer = { pointer: node.summary.repositoryUri };
            } else
            // See if package descriptor specifies uid.
            if (info.uid) {
                locatorPointer = { pointer: info.uid };
            } else
            // See if package descritpor specifies homepage.
            if (node.summary.homepageUri) {
                locatorPointer = { pointer: node.summary.homepageUri };
            }
            locatorPointer.pm = info.pm.locator;
            locatorPointer.name = info.name;
            if (locatorPointer.optional === true) {
                info.optional = true;
            }
            if (locatorPointer.dev === true) {
                info.dev = true;
            }

            if (locatorPointer.bundled === true && locatorPointer.pointer === "__DERIVE__") {
                if (node.summary.uid) {
                    locatorPointer.pointer = node.summary.uid;
                    if (node.summary.version) {
                        locatorPointer.version = node.summary.version;
                    }
                    if (node.summary.rev) {
                        locatorPointer.rev = node.summary.rev;
                    }
                } else
                if(node.summary.version) {
                    locatorPointer.pointer = node.summary.version;
                }
            }

            return LOCATOR.makeLocator(node, locatorPointer, options, function(err, locator) {
                if (err) return callback(err);

                if (locator) {

                    info.declaredLocator = locator;

                    if (!info.uid) {
                        info.uid = locator.getLocation("uid") || false;
                    }
                    if (!info.homepageUri) {
                        info.homepageUri = locator.getLocation("homepage") || false;
                    }
                    if (!info.uid) {
                        info.uid = info.repositoryUri || info.homepageUri || false;
                    }
                    if (!info.homepageUri) {
                        info.homepageUri = info.repositoryUri || false;
                    }
                }

                function formatPointers(callback) {

                    function formatHomepageUri(callback) {
                        if (!info.homepageUri) return callback(null);
                        return LOCATOR.makeLocator(node, {
                            pm: locatorPointer.pm,
                            name: locatorPointer.name,
                            pointer: info.homepageUri
                        }, options, function(err, locator) {
                            if (err) return callback(err);
                            if (locator) {
                                info.homepageUri = locator.getLocation("homepage") || info.homepageUri;
                            }
                            return callback(null);
                        });
                    }

                    function formatUid(callback) {
                        if (!info.uid) return callback(null);
                        return LOCATOR.makeLocator(node, {
                            pm: locatorPointer.pm,
                            name: locatorPointer.name,
                            pointer: info.uid
                        }, options, function(err, locator) {
                            if (err) return callback(err);
                            if (locator) {
                                info.uid = locator.getLocation("uid") || info.uid;
                            }
                            return callback(null);
                        });
                    }

                    return formatHomepageUri(function(err) {
                        if (err) return callback(err);
                        return formatUid(function(err) {
                            if (err) return callback(err);
                            return callback(null);
                        });
                    });
                }

                function setDeclaredLocator(callback) {
                    try {
                        if (info.declaredLocator) {
                            info.pm.locator = info.declaredLocator.pm;
                            if (info.installed) {
                                function setActualLocator(locator) {
                                    if (!locator) return;
                                    info.actualLocator = locator.clone();
                                    if (info.rev) {
                                        info.actualLocator.setRev(info.rev);
                                    } else {
                                        if (info.actualLocator.rev) {
                                            info.rev = info.actualLocator.rev;
                                        }
                                    }
                                    info.actualLocator.setVersion(info.version);
                                }
                                if (info.vcs) {
                                    var locator = {
                                        pointer: info.vcs.pointer + "#" + info.vcs.rev
                                    }
                                    locator.pm = info.vcs.pm || info.vcs.type;
                                    locator.name = info.name;
                                    return LOCATOR.makeLocator(node, locator, options, function(err, locator) {
                                        if (err) return callback(err);
                                        setActualLocator(locator);
                                        return callback(null);
                                    });
                                } else
                                if (node.descriptors.smSource && node.descriptors.smSource.locator) {
                                    var locator = UTIL.copy(node.descriptors.smSource.locator);
                                    if (typeof locator === "string") {
                                        locator = {
                                            pointer: locator
                                        };
                                    }
                                    locator.pm = info.pm.locator;
                                    locator.name = info.name;
                                    return LOCATOR.makeLocator(node, locator, options, function(err, locator) {
                                        if (err) return callback(err);
                                        setActualLocator(locator);
                                        return callback(null);
                                    });
                                } else {
                                    setActualLocator(info.declaredLocator);
                                }
                            }
                        } else {
                            info.pm.locator = false;
                        }
                        return callback(null);
                    } catch(err) {
                        return callback(err);
                    }
                }

                function finalize(callback) {
                    try {
                        if (info.symlinked === "inside" || info.inParent) {
                            info.declared = true;
                            if (node.descriptors.locator && node.descriptors.locator.bundled) {
                                info.bundled = true;
                            }
                        }

                        // We default to the NodeJS engine.
                        // TODO: Determine engine based on program and package descriptors. Program descriptor should declare
                        //       (<commonName>: <version>|<sourcemintPlatformUri>) engines to be used while
                        //       package descriptors via engines[<commonName>] should declare compatibility.
                        // NOTE: The engine to be used is determined by the parent package or platform default.
                        info.engineName = "node";
                        var engineVersion = process.version.replace(/^v/, "");
                        info.engineVersion = engineVersion;
                        if (node.descriptors.smSource && node.descriptors.smSource.engine) {
                            info.engineVersion = node.descriptors.smSource.engine.version;
                            if (info.engineVersion !== engineVersion || info.engineName != node.descriptors.smSource.engine.name) {
                                // Only record the fact that the engine has changed if our package descriptor
                                // specifies which engine to use.
                                if (node.descriptor.package && node.descriptor.package.engines) {
                                    info.newEngineVersion = engineVersion;
                                }
                            }
                        }
                        return callback(null);
                    } catch(err) {
                        return callback(err);
                    }
                }

                return formatPointers(function(err) {
                    if (err) return callback(err);

                    return setDeclaredLocator(function (err) {
                        if (err) return callback(err);

                        return finalize(callback);
                    });
                });
            });
        }

        return summarize(function(err) {
            if (err) return callback(err);

            return callback(null);
        });

    } catch(err) {
        return callback(err);        
    }
}

function loadLatest(node, options, callback) {

    if (!node.summary.declaredLocator) return callback(null);

    function setLatest(name, latest) {
        node.latest[name] = latest || false;
    }

    var waitFor = WAITFOR.parallel(function (err) {
        if (err) return callback(err);
        if (node.summary.pm.locator && typeof node.latest[node.summary.pm.locator] === "undefined") {
            return node.getPlugin(node.summary.pm.locator, function(err, plugin) {                
                if (err) return callback(err);
                return plugin.latest(options, function(err, latest) {
                    if (err) return callback(err);
                    setLatest(node.summary.pm.locator, latest);
                    return callback(null);
                });
            });
        }
        return callback(null);
    });
    Object.keys(node.status).forEach(function(pluginName) {
        waitFor(function(done) {
            return node.getPlugin(pluginName, function(err, plugin) {
                if (err) return done(err);
                return plugin.latest(options, function(err, latest) {
                    if (err) return done(err);
                    setLatest(pluginName, latest);
                    return done();
                });
            });
        });
    });
    waitFor();
}

function finalize(node, options, callback) {
    try {

        if (node.scanOnly) return callback(null);

        var info = node.summary;

//console.log("node", node.name);

        node.catalogs = {};
        [
            ["npm-shrinkwrap", "dependencies", "tree"],
            ["sm-catalog", "packages", "list"],
            ["sm-catalog.locked", "packages", "list"],
        ].forEach(function (catalog) {
            node.catalogs[catalog[0]] = new CATALOG.Catalog(
                PATH.join(node.path, catalog[0] + ".json"),
                node.descriptors[catalog[0]] || {},
                {
                    format: catalog[2],
                    packagesAttribute: catalog[1],
                    parent: (node.parent && node.parent.catalogs[catalog[0]]) || null
                }
            );
        });

        function determineLocked(callback) {
            if (info.level === 0) return callback(null);
            info.locked = node.catalogs["sm-catalog.locked"].isDeclared(node.name) ||
                          false;
            if (info.locked) {
                var locator = UTIL.copy(info.locked);
                if (info.declaredLocator) {
                    locator.pm = info.declaredLocator.pm;
                    locator.name = info.declaredLocator.descriptor.name;
                } else {
                    locator.pm = info.pm.locator || info.pm.install;
                    locator.name = info.name;
                }
                return LOCATOR.makeLocator(node, locator, options, function(err, locator) {
                    if (err) return callback(err);
                    info.locked = locator;
                    return callback(null);
                });
            }
            return callback(null);
        }

        function determineSticky(callback) {
            if (info.level === 0) return callback(null);
            info.sticky = node.catalogs["sm-catalog"].isDeclared(node.name) ||
                          node.catalogs["npm-shrinkwrap"].isDeclared(node.name) ||
                          false;
            // We only respect sticky if we are not in edit mode.
            if (info.sticky && !info.vcs) {
                var locator = UTIL.copy(info.sticky);
                if (info.actualLocator) {
                    locator.pm = info.actualLocator.pm;
                    locator.name = info.actualLocator.descriptor.name;
                } else
                if (info.declaredLocator) {
                    locator.pm = info.declaredLocator.pm;
                    locator.name = info.declaredLocator.descriptor.name;
                } else {
                    locator.pm = info.pm.locator || info.pm.install;
                    locator.name = info.name;
                }
                return LOCATOR.makeLocator(node, locator, options, function(err, locator) {
                    if (err) return callback(err);
                    if (locator) {
                        info.sticky = locator;
                        if (!info.actualLocator || !info.sticky.equals(info.actualLocator)) {
                            info.newStickyLocator = info.sticky;
                        }
                    }
                    return callback(null);
                });
            }
            return callback(null);
        }

        function determineLatest(callback) {

            if (!info.declaredLocator) return callback(null);

            return info.declaredLocator.getLatestSatisfying(node, options, function(err, locator) {
                if (err) return callback(err);
                if (!locator) {
                    if (info.declaredLocator.url && info.actualLocator.url && info.declaredLocator.url != info.actualLocator.url) {
                        info.newLocator = info.declaredLocator;
                    }
                    return callback(null);
                }

                function latest() {
                    return info.declaredLocator.getLatest(node, options, function(err, locator) {
                        if (err) return callback(err);

                        function setLatestLocator(callback) {
                            if (locator) {
                                info.latestLocator = locator;
                            } else
                            if (node.latest[info.declaredLocator.pm] && node.latest[info.declaredLocator.pm].version) {

                                var latestLocator = {};
                                latestLocator.pm = info.declaredLocator.pm;
                                latestLocator.name = info.declaredLocator.descriptor.name;
                                latestLocator.version = node.latest[info.declaredLocator.pm].version;
                                return LOCATOR.makeLocator(node, latestLocator, options, function(err, latestLocator) {
                                    if (err) return callback(err);
                                    if (latestLocator) {
                                        info.latestLocator = latestLocator;
                                    }
                                    return callback(null);
                                });
                            }
                            return callback(null);
                        }

                        return setLatestLocator(function(err) {
                            if (err) return callback(err);

                            if (
                                locator &&
                                locator.isResolved() &&
                                !(info.actualLocator && locator.equals(info.actualLocator)) &&
                                !(info.newInLocator && locator.equals(info.newInLocator)) &&
                                !(info.newStickyLocator && locator.equals(info.newStickyLocator)) &&
                                !(info.newLockedLocator && locator.equals(info.newLockedLocator))
                            ) {
                                // sm-plugin-github @ 0.1.0 - b66045255dca033afc622c0f22c80337a314f709 <n- 0.1.0 - 77ed322616d3f5bff871d5d48dd0eeeb21b9d577  github ~0.1.0
                                if (!info.newInLocator && info.actualLocator.version === locator.version) {
                                    return info.actualLocator.isOlderThan(node, locator, options, function(err, older) {
                                        if (err) return callback(err);
                                        if (older) {
                                            info.newInLocator = locator;
                                        }
                                        return callback(null);
                                    });
                                } else {
                                    if (info.actualLocator && locator.rev) {
                                        // If not under version control we don't care if there is a new version.
                                        if (!node.summary.vcs) return callback(null);
                                        return info.actualLocator.isOlderThan(node, locator, options, function(err, older) {
                                            if (err) return callback(err);
                                            if (older) {
                                                info.newOutLocator = locator;
                                            }
                                            return callback(null);
                                        });
                                    }
                                    info.newOutLocator = locator;
                                    return callback(null);
                                }
                            } else {
                                return callback(null);
                            }
                        });
                    });
                }

                if (
                    info.level > 0 &&
                    locator &&
                    locator.isResolved() &&
                    !(info.actualLocator && locator.equals(info.actualLocator)) &&
                    !(info.newStickyLocator && locator.equals(info.newStickyLocator)) &&
                    !(info.newLockedLocator && locator.equals(info.newLockedLocator))
                ) {
                    if (info.actualLocator) {
                        return info.actualLocator.isOlderThan(node, locator, options, function(err, older) {
                            if (err) return callback(err);
                            if (older) {
                                info.newInLocator = locator;
                            }
                            return latest();
                        });
                    } else {
                        info.newInLocator = locator;
                        return latest();
                    }
                }
                return latest();
            });
        }

        return determineLocked(function(err) {
            if (err) return callback(err);

            return determineSticky(function(err) {
                if (err) return callback(err);

                return determineLatest(function(err) {
                    if (err) return callback(err);

                    return callback(null);
                });
            });
        });

    } catch(err) {
        return callback(err);
    }
}


// This logic determines the status that is displayed to the user and what actions will happen when
// when `sm install|update [...]` is called. No part of the system should offer the user to do something
// that is not established/authorized here!
function generateHints(node, options, callback) {

    if (node.scanOnly) return callback(null);

    var info = node.summary;

    var hints = {
        display: {
//                missing: false
        },
        actions: {
//                install: false,
            // NOTE: Update actions always update top sticky if present.
//                update: false,
//                updateOptional: false
        }
    };

    function generate(callback) {
        try {

            // Don't mess with packages that are not directly in the tree.
            // i.e. ignore packages symlinked from the outside.
            if (
                info.symlinked === "outside" ||
                (
                    info.declaredLocator &&
                    info.declaredLocator.pm === "symlink" &&
                    info.declaredLocator.url &&
                    // Ensure link points to outside.
                    info.declaredLocator.url.substring(0, node.top.path.length) !== node.top.path
                )
            ) {
                // Do symlink the first package.
            } else
            // Ignore packages further down.
            if (info.path.substring(0, node.top.path.length) !== node.top.path) {
                return callback(null);
            }

            if (!info.installed) {
                if (info.optional) {
                    if (info.locked) {
                        hints.actions.installOptional = ["code", info.newLockedLocator];
                    } else
                    if (info.sticky) {
                        hints.actions.installOptional = ["code", info.newStickyLocator];
                    } else {
                        hints.actions.installOptional = ["code", info.newInLocator || info.newOutLocator || info.declaredLocator];
                    }
                } else
                if (node.summary.dev && options.production === true) {
                    // Don't install this dev dependency as we are asked to install in production mode.
                } else {
                    if (info.locked) {
                        if (info.newLockedLocator) {
                            hints.actions.install = ["code", info.newLockedLocator];
                        }
                    } else
                    if (info.sticky) {
                        if (info.newStickyLocator) {
                            hints.actions.install = ["code", info.newStickyLocator];
                        }
                    } else {
                        if (info.newInLocator || info.newOutLocator || info.declaredLocator) {
                            hints.actions.install = ["code", info.newInLocator || info.newOutLocator || info.declaredLocator];
                        }
                    }
                    if (hints.actions.install) {
                        hints.display.missing = ["red", "bold", "MISSING", "\0red(To fix \0bold(MISSING\0) run: \0bold(sm install\0)\0)", hints.actions.install[1]];
                    }
                }
            } else {

                if (node.name && !node.catalogs["sm-catalog"].isDeclared(node.name)) {
                    hints.actions.save = ["top-catalog", info.actualLocator || info.declaredLocator];
                }

                if (info.locked && info.newLockedLocator) {
                    hints.actions.install = ["code", info.newLockedLocator];
                    hints.display.locked = ["red", "bold", "<l-", "\0red(To fix \0bold(<l-\0) run: \0bold(sm install\0)\0)", hints.actions.install[1]];
                } else
                if (info.sticky) {
                    if (info.newStickyLocator) {
                        hints.actions.install = ["code", info.newStickyLocator];
                        hints.display.sticky = ["red", "bold", "<s-", "\0red(To fix \0bold(<s-\0) run: \0bold(sm install\0)\0)", hints.actions.install[1]];
                    } else
                    if (info.newInLocator) {
                        if (info.level <= 1) {
                            hints.actions.updateOptional = ["top-package", info.newInLocator];
                            hints.display.sticky = ["magenta", "bold", "<n-", "\0magenta(To fix \0bold(<n-\0) run: \0bold(sm update \0yellow(name\0)\0)\0)", hints.actions.updateOptional[1]];
                        } else {
                            hints.actions.updateOptional = ["top-locked", info.newInLocator];
                            hints.display.sticky = ["magenta", "normal", "<n-", "\0magenta(To fix <n- run: \0bold(sm update \0yellow(relpath\0)\0)\0)", hints.actions.updateOptional[1]];
                        }
                    }
                } else
                if (info.newLocator) {
                    hints.actions.install = ["code", info.newLocator];
                    hints.display.declared = ["red", "bold", "<-", "\0red(To fix \0bold(<-\0) run: \0bold(sm install\0)\0)", hints.actions.install[1]];
                } else
                if (info.newInLocator) {
                    hints.actions.update = ["code", info.newInLocator];
                    hints.display.in = ["red", "bold", "<n-", "\0red(To fix \0bold(<n-\0) run: \0bold(sm update\0)\0)", hints.actions.update[1]];
                } else
                if (info.newOutLocator) {
                    if (info.level <= 1) {
                        hints.actions.updateOptional = ["top-package", "arg-pointer"];
                        hints.display.out = ["magenta", "bold", "<o-", "\0magenta(To fix \0bold(<o-\0) run: \0bold(sm update \0yellow(name [pointer]\0)\0)\0)", info.newOutLocator];
                    } else {
                        hints.actions.updateOptional = ["top-locked", info.newOutLocator];
                        hints.display.out = ["magenta", "normal", "<o-", "\0magenta(To fix <o- run: \0bold(sm update \0yellow(relpath\0)\0)\0)", hints.actions.updateOptional[1]];
                    }
                }

                if (!hints.actions.install && info.newEngineVersion) {
                    hints.actions.install = ["code", info.actualLocator];
                    // TODO: Set new engine version hint.
                    // line.push("\0red((" + info.engineName + ": " + info.engineVersion + " <p- " + info.newEngineVersion + ")\0)");
                    // statusHints["-engine-must-"] = true;
                }

                if (this.level > 0 && !info.declared) {
                    if (!info.dynamic) {
                        if (info.level <= 1) {
                            hints.actions.install = ["top-package", "arg-pointer"];
                            hints.display.undeclared = ["red", "bold", "UNDECLARED", "\0red(To fix \0bold(UNDECLARED\0) remove package or run: \0bold(sm install \0yellow(name [pointer]\0)\0)\0)", info.locator];
                        } else {
                            hints.actions.install = ["top-locked", info.locator];
                            hints.display.undeclared = ["red", "normal", "UNDECLARED", "\0red(To fix UNDECLARED remove package or run: \0bold(sm install \0yellow(relpath\0)\0)\0)", hints.actions.install[1]];
                        }
                    }
                }

                if (info.vcs) {
                    if (info.vcs.dirty) {
                        hints.actions.fix = ["code"];
                        hints.display.dirty = ["red", "bold", "dirty", "\0red(To fix \0bold(dirty\0) run: \0bold(sm save\0)\0)"];
                    } else {
                        if (info.vcs.behind) {
                            hints.actions.updateOptional = ["code", "origin"];
                            hints.display.behind = ["magenta", "bold", "behind", "\0magenta(To fix \0bold(behind\0) run: \0bold(sm update\0)\0)"];
                        } else
                        if (info.vcs.ahead) {
                            if (!hints.actions.publish) hints.actions.publish = [];
                            hints.actions.publish.push(["code", "origin"]);
                            hints.display.ahead = ["magenta", "bold", "ahead", "\0magenta(To fix \0bold(ahead\0) run: \0bold(sm publish\0)\0)"];
                        }
                        if (!info.vcs.tagged) {
                            if (info.pm.publish && info.level <= 1) {
                                hints.actions.bump = ["package"];
                                hints.display.bump = ["magenta", "normal", "-b>", "\0magenta(To fix -b> run: \0bold(sm bump\0)\0)"];
                            }
                        }
                    }
                    if (options.force && !hints.actions.bump && info.pm.publish && info.level <= 1) {
                        hints.actions.bump = ["package"];
                        hints.display.bump = ["magenta", "normal", "-b>", "\0magenta(To fix -b> run: \0bold(sm bump\0)\0)"];
                    }
                    if (!options.getConfig(["package", "resolve"])) {
                        options.setConfig("local", ["package", "resolve"], true);
                    }
                }

                if (info.pm.publish && info.publish) {
                    if (
                        (
                            info.actualLocator &&
                            info.actualLocator.version &&
                            (!info.vcs || (
                                !info.vcs.dirty &&
                                !info.vcs.behind
                            ))
                        ) || options.force
                    ) {
                        function generatePublish(callback) {
                            if (!hints.actions.publish) hints.actions.publish = [];
                            hints.actions.publish.push(["package"]);
                            hints.display.publish = ["magenta", "normal", "-(*)>", "\0magenta(To fix -(*)> run: \0bold(sm publish\0)\0)", info.actualLocator];
                            return callback(null);
                        }

                        if (!info.latestLocator || !info.latestLocator.version) {
                            return generatePublish(callback);
                        } else {
                            var opts = UTIL.copy(options);
                            opts.byVersion = true;         
                            return info.latestLocator.isOlderThan(node, info.actualLocator, opts, function(err, older) {
                                if (err) return callback(err);
                                if (!older) {
                                    if (options.force) {
                                        return generatePublish(callback);
                                    }
                                    return callback(null);
                                }
                                return generatePublish(callback);
                            });
                        }
                    }
                }
            }
            return callback(null);
        } catch(err) {
            return callback(err);        
        }
    }

    return generate(function(err) {
        if (err) return callback(err);

        node.hints = hints;

        return callback(null);
    });
}

function addFunctions(node, options) {

    node.findNameInTransitiveParents = function(node) {
        if (
            this.children[node.name] &&
            this.children[node.name] !== node &&
            this.children[node.name].exists
        ) return this.children[node.name];
        if (!this.parent) return false;
        return this.parent.findNameInTransitiveParents(node);
    }

    node.collectDeepHints = function() {
        var self = this;
        // Deep hints hold all hints for self and children.
        self.deepHints = {
            display: {},
            actions: {},
            vcs: false
        };
        if (self.children) {
            var hints;
            for (var name in self.children) {
                if (typeof self.children[name].collectDeepHints === "function") {
                    hints = self.children[name].collectDeepHints();
                    UTIL.forEach(hints.display, function(hint) {
                        if (!self.deepHints.display[hint[0]]) self.deepHints.display[hint[0]] = [];
                        self.deepHints.display[hint[0]] = UTIL.unique(self.deepHints.display[hint[0]].concat(hint[1]));
                    });
                    UTIL.update(self.deepHints.actions, hints.actions);
                    if (hints.vcs) {
                        self.deepHints.vcs = hints.vcs;
                    }
                }
            }
        }
        UTIL.forEach(self.hints.display, function(hint) {
            if (!hint[1]) return;
            self.deepHints.display[hint[0]] = [ hint[1][3] ];
        });
        UTIL.forEach(self.hints.actions, function(hint) {
            if (!hint[1]) return;
            self.deepHints.actions[hint[0]] = hint[1];
        });
        if (self.summary.vcs) {
            self.deepHints.vcs = true;
        }
        return self.deepHints;
    }

    node.print = function(options) {

        // TODO: Clean this up. Especially the `options.mode` based formatting (add indent at end).

        var self = this;

        options = options || {};
        if (!options.displayHints) options.displayHints = {};
        if (!options.actionHints) options.actionHints = {};

        function renderHint(hint) {
            if (hint[1] === "normal") {
                return "\0" + hint[0] + "(" + hint[2] + "\0)";
            } else {
                return "\0" + hint[0] + "(\0" + hint[1] + "(" + hint[2] + "\0)\0)";
            }
        }

        var node = this;
        var info = node.summary;
        var hints = node.hints;

//console.log("DESCRIPTORS", node.descriptors);
//console.log("INFO", info);

        var line = [];

// TODO: Move padding to bottom.
        var padding = "  ";
        if (options.mode === "tree") {
            for (var i=0 ; i<=node.level ; i++) padding += "  ";
        } else {
            padding += "  ";
        }
        if (info.vcs) {
            if (info.vcs.mode === "write") {
                line.push(" \0cyan(W\0) " + padding.substring(3));
            } else
            if (info.vcs.mode === "read") {            
                line.push(" \0cyan(R\0) " + padding.substring(3));
            }
        } else {
            line.push(padding);
        }
        line.push("\0" + ((hints.display.missing)?"red":((hints.actions.installOptional)?"magenta":"yellow")) + "(" + ((node.level <= 1)?("\0bold(" + info.name + "\0)"):info.name));
        line.push(((node.descriptors.locator && node.descriptors.locator.viaAttribute && /^dev/.test(node.descriptors.locator.viaAttribute))?"\0cyan(D\0)":"@"));
        var segment = "";

        if (hints.display.missing) {
            segment = renderHint(hints.display.missing) + " \0" + hints.display.missing[0] + "(" + hints.display.missing[4].toString("minimal") + "\0)";
        } else {
            if (info.actualLocator) {
                if (options.info) {
                    segment = info.actualLocator.toString("minimal");
                } else {
                    if (
                        info.actualLocator.version &&
                        info.actualLocator.rev &&
                        info.vcs &&
                        info.actualLocator.rev === info.vcs.rev
                    ) {
                        segment = info.actualLocator.toString("version");
                    } else {
                        segment = info.actualLocator.toString("minimal");
                    }
                }
            } else
            if (!node.exists && info.declaredLocator) {
                segment = info.declaredLocator.toString("minimal");
            } else {
                segment = info.version;
            }
            if (info.locked) {
                if (hints.display.locked) {
                    segment += " :";
                } else {
                    segment += " |";
                }
            }
        }
        line.push(segment + "\0)");

        if (hints.actions.installOptional) {
            line.push("\0magenta(OPTIONAL\0)");
        } else
        if (info.dynamic) {
            line.push("\0white(DYNAMIC\0)");
        } else
        if (hints.display.undeclared) {
            line.push(renderHint(hints.display.undeclared));
        }

        if (hints.display.locked) {
            line.push(renderHint(hints.display.locked) + " \0" + hints.display.locked[0] + "(" + hints.display.locked[4].toString("minimal") + "\0)");
        }

        if (hints.display.sticky) {
            line.push(renderHint(hints.display.sticky) + " \0" + hints.display.sticky[0] + "(" + hints.display.sticky[4].toString("minimal") + "\0)");
        }

        if (hints.display.declared) {
            line.push(renderHint(hints.display.declared) + " \0" + hints.display.declared[0] + "(" + hints.display.declared[4].toString("minimal") + "\0)");
        }

        if (hints.display.in) {
            line.push(renderHint(hints.display.in) + " \0" + hints.display.in[0] + "(" + hints.display.in[4].toString("minimal") + "\0)");
        }

        if (info.pm.locator) {
            segment = " \0" + ((hints.actions.install)?"red":"green") + "(" + info.declaredLocator.pm;
            if (info.declaredLocator && info.declaredLocator.selector && info.declaredLocator.selector !== info.declaredLocator.toString("minimal")) {
                segment += " " + info.declaredLocator.selector;
            }
            line.push(segment + "\0)");
        }

        if (hints.display.out) {
            line.push("\0magenta(" + renderHint(hints.display.out) + " " + hints.display.out[4].toString("minimal") + "\0)");
        }

/*
        if (info.newEngineVersion) {
            ok = false;
            line.push("\0red((" + info.engineName + ": " + info.engineVersion + " <p- " + info.newEngineVersion + ")\0)");
            statusHints["-engine-must-"] = true;
        }
*/

        if (hints.display.bump) {
            line.push(renderHint(hints.display.bump));
        }

        var vcsStatusHint = false;
        if (hints.display.dirty) {
            vcsStatusHint = hints.display.dirty;
        }
        if (hints.display.behind) {
            vcsStatusHint = hints.display.behind;
        }
        if (hints.display.ahead) {
            vcsStatusHint = hints.display.ahead;
        }
        if (info.vcs) {
            line.push(" \0" + ((vcsStatusHint)?vcsStatusHint[0]:"green") + "(" + info.vcs.type);
            if (info.declaredLocator.selector && info.vcs.selector && info.declaredLocator.selector === info.vcs.selector) {
                line.push("\0orange(" + info.vcs.selector + "\0)");
            } else
            if (info.vcs.selector) {
                line.push(info.vcs.selector);
            } else {
                line.push("(no branch)");
            }
            if (info.vcs.tagged) {
                line.push("(" + info.vcs.tagged + ")");
            }
            line.push("\0)" + ((vcsStatusHint)?renderHint(vcsStatusHint):""));
        }

        if (hints.display.publish) {
            line.push("\0" + hints.display.publish[0] + "(-(" + hints.display.publish[4].toString("minimal") + ")> \0bold(" + info.pm.publish + "\0)\0)");
        }
/*
if (info.name === "commander") {
    console.log(node.summary);
}
*/
        if (node.level === 0 && options.mode === "tree") {
            if (!options.info) {
                line.push(" (" + node.path + ")");
            }
        } else
        if (info.symlinked) {
            if (info.symlinked === "outside") {
                line.push(" \0cyan(" + node.path + "\0)");
            } else {    // `info.symlinked === "inside"`
                line.push(" \0cyan(./" + node.path.substring(node.parent.path.length + 1) + "\0)");
            }
        } else
        if (info.inParent) {
            var up = " ";
            for(var i=0;i<info.inParent;i++) up += "../../";
            line.push(up.substring(0, up.length-1));
        }
        if (options.info || options.mode !== "tree") {
            if (info.inParent) {
                line.push(" (" + (info.relpath || info.path) + ") ");
            } else {
                line.push(" " + (info.relpath || info.path) + " ");
            }
        }

        if (options.info) {
            line.push(" \0yellow(" + info.homepageUri + "\0) ");
        }

        if (info.inParent) {
            line = line.map(function(segment) {
                return segment.replace(/\0(orange|yellow|cyan|magenta|green|red|)\(/g, "\0white(");
            });
        }

        if (node.circular) {
            line = line.map(function(segment) {
                return segment.replace(/\0\w*\(/g, "\0white(");
            });
            line = line.slice(0, 4).join(" ") + " \0cyan(\xA4\0)";
        } else {
            line = line.join(" ");
        }

        if (options.mode !== "tree") {
            // Remove extra spaces in beginning of line if we are not printing a tree.
            line = line.split("@");
            line[0] = line[0].replace(/\s{1,}/g, " ");
            line = line.join("@");
            line = (options.prefix || "[sm]") + line;
        }

        for (var type in hints.display) {
            if (hints.display[type]) {
                if (!options.displayHints[type]) {
                    options.displayHints[type] = {};
                }
                var key = hints.display[type].slice(0, 3).join("-");
                options.displayHints[type][key] = hints.display[type][3];
            }
        }
        for (var name in hints.actions) {
            options.actionHints[name] = true;
        }

        TERM.stdout.writenl(line);
    }

    node.downloadAndExtract = function(locator, options) {

        ASSERT(typeof locator === "object", "`locator` must be an object");
/*
        var found = false;
        for (var name in node.summary) {
            if (node.summary[name] === locator) {
                found = true;
                break;
            }
        }
        if (!found) return Q.reject(new Error("`locator` must be one of the locators from `node.summary`"));
*/
        function isVcsCacheAvailable(force, callback) {
            var latest = false;
            [
                "git"
                // TODO: Add other VCS here.
            ].forEach(function(type) {
                if (latest) return;
                // See if we have a VCS repository in cache.
                latest = node.latest[type] || false;
            });
            function makeExtractor(latest) {
                return function(options) {
                    var deferred = Q.defer();
                    node.getPlugin(latest.type, function(err, plugin) {
                        if (err) return deferred.reject(err);
                        var uri = locator.getLocation("pointer");
                        var installCachePath = node.getCachePath("install", uri);
                        if (options.vcsOnly !== true) {
                            var genericCachePath = installCachePath.replace(/\/cache\/install\/[^-]*-[^\/]*\//, "/cache/install/");
                            if ((FS.existsSync(genericCachePath) && (installCachePath = genericCachePath)) || FS.existsSync(installCachePath)) {
                                // Assume install cache exists and was properly installed previously.
                                options.logger.info("Skip extracting `" + latest.cachePath + "` to `" + installCachePath + "` (found in cache)");
                                return deferred.resolve({
                                    status: 304,
                                    pointer: uri,
                                    cachePath: installCachePath
                                });
                            }
                        } else {
                            installCachePath = node.path;
                        }

                        options.logger.info("Extracting `" + latest.cachePath + "` to `" + installCachePath + "`");
                        return plugin.extract(latest.cachePath, installCachePath, locator, options).then(function() {
                            return {
                                status: 200,
                                pointer: uri,
                                cachePath: installCachePath
                            };
                        }).fail(function(err) {
                            if (FS.existsSync(installCachePath)) {
                                FS_EXTRA.removeSync(installCachePath);
                            }
                            throw err;
                        }).then(deferred.resolve, deferred.reject);
                    });
                    return deferred.promise;
                };
            }
            if (latest) {
                return callback(null, makeExtractor(latest));
            } else
            if (force) {
                // TODO: Determine which VCS to use based on info from `node.summary`.
                return node.getPlugin("git", function(err, plugin) {
                    if (err) return callback(err);
                    var opts = UTIL.copy(options);
                    opts.forceClone = true;
                    opts.locator = locator;
                    return plugin.latest(opts, function(err, latest) {
                        if (err) return callback(err);
                        if (!latest) {
                            // TODO: Populate `summary.vcsLocator` with any info we can and use it for `opts.locator` above to
                            //       avoid getting here as much as possible.
                            return callback(new Error("Could not clone source from '" + locator + "'. Try specifying a VCS uri."));
                        }
                        return callback(null, makeExtractor(latest));
                    });
                });
            }
            return callback(null, false);
        }

        var deferred = Q.defer();
        isVcsCacheAvailable(options.vcsOnly || (node.level === 0 && options.keepTopVcs), function(err, extractor) {
            if (err) return deferred.reject(err);
            if (extractor) {
                return extractor(options).then(deferred.resolve, deferred.reject);
            } else {

                // Try and mirror the package/resource starting with the *best* uri.
                
                function checkPlugins(locator, callback) {
                    var cacheInfo = {
                        status: false
                    };
                    var waitFor = WAITFOR.serial(function(err) {
                        if (err) return callback(err);
                        if (cacheInfo.status === false) {
                            return callback(null, false);
                        }
                        return callback(null, cacheInfo);
                    });
                    [
                        // TODO: Use the `locator` api of the plugins instead of `install` api.
                        "gzip",
                        "zip",
                        "dmg",
                        "bzip",
                        "7zip",
                        "url",
                        "path",
                        "symlink"
                    ].forEach(function(type) {
                        waitFor(function(done) {
                            if (cacheInfo.status !== false) return done();
                            var uri = locator.getLocation(type);
                            if (!uri) {
                                options.logger.info("Skip download of `" + locator + "` via plugin `" + type + "` as uri could not be resolved.");
                                return done();
                            }
                            var installCachePath = node.getCachePath("install", uri);
                            var genericCachePath = installCachePath.replace(/\/cache\/install\/[^-]*-[^\/]*\//, "/cache/install/");
                            if ((FS.existsSync(genericCachePath) && (installCachePath = genericCachePath)) || FS.existsSync(installCachePath)) {
                                // Assume install cache exists and was properly installed previously.
                                options.logger.info("Skip downloading `" + uri + "` via `" + type + "` plugin (found in cache)");
                                cacheInfo = {
                                    status: 304,
                                    pointer: uri,
                                    cachePath: installCachePath
                                };
                                return done();
                            }

                            return node.getPlugin(type, function(err, plugin) {
                                if (err) return done(err);

                                options.logger.info("Downloading `" + uri + "` via `" + type + "` plugin");

                                var deferred = Q.defer();

                                plugin.download(uri, options, function(err, response) {
                                    if (err) return deferred.reject(err);
                                    return deferred.resolve(response);
                                });

                                return Q.when(deferred.promise, function(response) {

                                    ASSERT(typeof response.status === "number", "`response.status` must be an integer");
                                    ASSERT(typeof response.cachePath !== "undefined", "`response.cachePath` must be set");

                                    if (response.status !== 200 && response.status !== 304) {
                                        throw new Error("Download of '" + uri + "' failed with status '" + response.status + "'");
                                    }

                                    options.logger.info("Extracting `" + response.cachePath + "` to `" + installCachePath + "`");

                                    return plugin.extract(response.cachePath, installCachePath, locator, options).then(function() {
                                        cacheInfo = {
                                            status: 200,
                                            pointer: uri,
                                            cachePath: installCachePath
                                        };
                                        return done();
                                    });
                                }).fail(function(err) {
                                    if (FS.existsSync(installCachePath)) {
                                        FS_EXTRA.removeSync(installCachePath);
                                    }
                                    return done(err);
                                });
                            });
                        });
                    });
                    waitFor();
                }

                return checkPlugins(locator, function(err, cacheInfo) {
                    if (err) return deferred.reject(err);
                    if (cacheInfo) return deferred.resolve(cacheInfo);
                    function fail(locator) {
                        if (node.parent) {
                            console.error("PARENT NODE", node.parent.summary);
                        }
                        console.error("NODE", node.summary);
                        console.error("locator", locator);
                        // TODO: Write debug info with blocking IO so we don't need to wait here.
                        return setTimeout(function() {
                            return deferred.reject(new Error("Unable to derive download URL for locator `" + locator + "`"));
                        }, 1000);
                    }

                    if (!locator.url) return fail(locator);
                    // If a URL us set we fall back to it as a last resort.
                    // This is typically needed if a `sm-catalog.json` file is present and we are not resolving locators.
                    return LOCATOR.makeLocator(node, {
                        archive: locator.url,
                        pm: "archive",
                        name: node.name
                    }, options, function(err, locator) {
                        if (err) return deferred.reject(err);
                        return checkPlugins(locator, function(err, cacheInfo) {
                            if (err) return deferred.reject(err);
                            if (cacheInfo) return deferred.resolve(cacheInfo);
                            return fail(locator);
                        });
                    });
                });
            }
        });
        return deferred.promise;
    }

    node.install = function(options) {

        var instructions = node.hints.actions.install || node.hints.actions.installOptional;

        if (!instructions) {
            if (!node.parent) {
                instructions = ["top-package", "install"];
            } else {
                instructions = ["package", "install"];
            }
        }

        if (!instructions) {
            return Q.reject(new Error("Nothing to install!"));
        }

        try {

            function linkTo(linkPath) {
                return Q.fcall(function() {
                    var nodePath = PATH.join(node.top.path, node.relpath);
                    if (FS.existsSync(nodePath)) {
                        if (FS.lstatSync(nodePath).isSymbolicLink()) {
                            if (FS.readlinkSync(nodePath) === linkPath) {
                                return;
                            }
                        }
                        if (options.noBackup !== true) {
                            var backupPath = nodePath + "~backup-" + Date.now();
                            options.logger.debug("Backing up '" + nodePath + "' to '" + backupPath + "'");
                            FS.renameSync(nodePath, backupPath);
                        } else {
                            FS_EXTRA.removeSync(nodePath);
                        }
                    }
                    if (!FS.existsSync(PATH.dirname(nodePath))) {
                        FS_EXTRA.mkdirsSync(PATH.dirname(nodePath));
                    }
                    options.logger.debug("Linking '" + linkPath + "' to '" + nodePath + "'");
                    FS.symlinkSync(linkPath, nodePath);

                    return node.refresh(options);
                });
            }

            if (options.link) {
                return linkTo(options.link);
            } else
            if ((
                    instructions[0] === "top-package" ||
                    instructions[0] === "package"
                ) &&
                instructions[1] === "install"
            ) {
                var deferred = Q.defer();
                node.getPlugin(node.summary.pm.install, function(err, plugin) {
                    if (err) return deferred.reject(err);

                    options.logger.debug("Asking package manager `" + node.summary.pm.install + "` to install package.");

                    return plugin.install(node.path, options).then(function() {
                        return node.refresh(options);
                    }).then(deferred.resolve, deferred.reject);
                });
                return deferred.promise;
            } else
            if (instructions[0] === "code") {
/*
                if (!instructions[1].isResolved()) {
                    TERM.stdout.writenl("\0red([sm] ERROR: Could not determine `rev` nor `version` for locator '" + instructions[1] + "'. Most likely the package is not available for download.\0)");
                    return Q.reject(true);
                }
*/

                function isCentralPackage() {
                    return Q.fcall(function() {
                        function tryToLink(streamFilename) {
                            var packagePath = PATH.join(node.getCore().getConfig(["toolchain", "paths", "packages"]), streamFilename);
                            var nodePath = PATH.join(node.top.path, node.relpath);
                            if (FS.existsSync(packagePath)) {
                                if (!FS.lstatSync(packagePath).isSymbolicLink() || FS.readlinkSync(packagePath) !== nodePath) {
                                    return linkTo(packagePath);
                                }
                            }
                            return false;
                        }
                        // See if we have a central package we should link to based on declared locator.
                        // TODO: We may not be able to just fall back to `declaredLocator` if
                        //       `instructions[0] === "code"` has a locator at `instructions[1]` that is
                        //       not an automatic derivative of `declaredLocator`.
                        if (node.summary.declaredLocator) {
                            var streamFilename = node.summary.declaredLocator.getLocation("stream-filename");
                            if (streamFilename) {
                                return tryToLink(streamFilename);
                            } else {
                                // We cannot derive streamFilename from locator. Let's lookup uid in descriptor.
                                if (
                                    node.latest.npm &&
                                    node.latest.npm.versions &&
                                    node.latest.npm.versions[node.latest.npm.version] &&
                                    node.latest.npm.versions[node.latest.npm.version].uid &&
                                    node.summary.declaredLocator.selector
                                ) {
                                    var uid = node.latest.npm.versions[node.latest.npm.version].uid;
                                    var m = node.summary.declaredLocator.selector.match(/^~(\d*\.\d*)\.\d*$/);
                                    if (m) {
                                        return tryToLink(PINF.uriToFilename(uid.replace(/^https?:\/\/|\/$/g, "") + "/" + m[1]));
                                    }
                                }
                            }
                        }
                        return false;
                    });
                }

                return isCentralPackage().then(function(installedNode) {
                    if (installedNode) return installedNode;

                    options.logger.info("Installing `" + node.path + "` from `" + instructions[1] + "` via package manager `" + node.summary.pm.install + "`");

                    return node.downloadAndExtract(instructions[1], options).then(function(response) {

                        var cachePath = response.cachePath;

                        var deferred = Q.defer();

                        node.getPlugin(node.summary.pm.install, function(err, plugin) {
                            if (err) return deferred.reject(err);

                            function copyVcsOnly() {
                                if (FS.existsSync(PATH.join(node.path, ".git"))) {
                                    return Q.reject(new Error("`.git` dir already found at: " + PATH.join(node.path, ".git")));
                                }
                                // TODO: Let VCS plugin copy VCS dir.
                                var deferred = Q.defer();
                                FS_EXTRA.copy(PATH.join(cachePath, ".git"), PATH.join(node.path, ".git"), function(err) {
                                    if (err) return deferred.reject(err);
                                    return deferred.resolve();
                                });
                                return deferred.promise;
                            }

                            // If we got a new cache dir and only need VCS we just copy and don't install.
                            // When done we need to delete cache dir again (as we did not install it).
                            if (response.status === 200 && options.vcsOnly) {
                                return copyVcsOnly().then(function() {
                                    if (FS.existsSync(cachePath)) {
                                        FS_EXTRA.removeSync(cachePath);
                                    }
                                });
                            }

                            var done = Q.resolve();
                            // If cache is new we need to install it.
                            if (response.status === 200) {
                                done = Q.when(done, function() {
                                    options.logger.debug("Asking package manager `" + node.summary.pm.install + "` to install package.");
                                    var opts = UTIL.copy(options);
                                    opts.production = true;
                                    return plugin.install(cachePath, opts).fail(function(err) {
                                        if (FS.existsSync(cachePath)) {
                                            FS_EXTRA.removeSync(cachePath);
                                        }
                                        throw err;
                                    }).then(function() {
                                        var engineVersionSpecific = false;
                                        if (FS.existsSync(PATH.join(node.path, "package.json"))) {
                                            try {
                                                var descriptor = JSON.parse(FS.readFileSync(PATH.join(node.path, "package.json")));
                                                if (descriptor && descriptor.engines) {
                                                    // If any engines are declared we assume specific engines at specific
                                                    // versions are required.
                                                    engineVersionSpecific = true;
                                                }
                                            } catch(err) {}
                                        }
                                        if (!engineVersionSpecific) {
                                            // Package is not engine specific so we move it to the generic cache.
                                            var genericCachePath = cachePath.replace(/\/cache\/install\/[^-]*-[^\/]*\//, "/cache/install/");
                                            if (!FS.existsSync(genericCachePath)) {
                                                if (!FS.existsSync(PATH.dirname(genericCachePath))) {
                                                    FS_EXTRA.mkdirsSync(PATH.dirname(genericCachePath));
                                                }
                                                FS.renameSync(cachePath, genericCachePath);
                                                cachePath = genericCachePath;
                                            }
                                        }
                                    });
                                });
                            }

                            return Q.when(done, function() {
                                // Copy from cache to final destination.
                                if (options.vcsOnly) {
                                    return copyVcsOnly();
                                } else {
                                    if (FS.existsSync(node.path) && options.noBackup !== true) {
                                        var backupPath = node.path + "~backup-" + Date.now();
                                        options.logger.debug("Backing up '" + node.path + "' to '" + backupPath + "'");
                                        FS.renameSync(node.path, backupPath);
                                    }
                                    if (!FS.existsSync(PATH.dirname(node.path))) {
                                        FS_EXTRA.mkdirsSync(PATH.dirname(node.path));
                                    }
                                    options.logger.debug("Copying '" + cachePath + "' to '" + node.path + "'");
                                    var deferred = Q.defer();
                                    FS_EXTRA.copy(cachePath, node.path, function(err) {
                                        if (err) return deferred.reject(err);
                                        if ((node.level === 0 && options.keepTopVcs)) return deferred.resolve();
                                        // Sanitize.
                                        // TODO: Also remove `.svn` and other VCS dirs.
                                        if (FS.existsSync(PATH.join(node.path, ".git"))) {
                                            FS_EXTRA.removeSync(PATH.join(node.path, ".git"));
                                        }
                                        // If we copied a symlink we remove it from the install cache.
                                        if (FS_EXTRA.lstatSync(cachePath).isSymbolicLink()) {
                                            FS_EXTRA.removeSync(cachePath)
                                        }
                                        return deferred.resolve();
                                    });
                                    return deferred.promise;
                                }
                            }).then(function() {
                                // Don't write `.sm/source.json` file if symlink.
                                if (FS_EXTRA.lstatSync(node.path).isSymbolicLink()) return;
                                var deferred = Q.defer();
                                function writeFile() {
                                    FS.writeFile(PATH.join(node.path, ".sm", "source.json"), JSON.stringify({
                                        time: options.time,
                                        dynamic: options.dynamic || false,
                                        locator: {
                                            pointer: response.pointer,
                                            pm: node.descriptors.locator.pm || false
                                        },
                                        descriptor: (node.descriptors.locator && node.descriptors.locator.descriptor) || false,
                                        engine: {
                                            name: node.summary.engineName,
                                            version: node.summary.newEngineVersion || node.summary.engineVersion
                                        }
                                    }), function(err) {
                                        if (err) return deferred.reject(err);
                                        deferred.resolve();
                                    });
                                }
                                FS.exists(PATH.join(node.path, ".sm"), function(exists) {
                                    if (!exists) {
                                        FS.mkdir(PATH.join(node.path, ".sm"), function(err) {
                                            if (err) return deferred.reject(err);
                                            writeFile();
                                        });
                                    } else {
                                        writeFile();
                                    }
                                });
                                return deferred.promise;
                            }).then(function() {
                                return node.refresh(options);
                            }).then(deferred.resolve, deferred.reject);
                        });
                        return deferred.promise;
                    });
                });

            } else {
                return Q.reject(new Error("NYI: " + JSON.serialize(instructions)));
            }
        } catch(err) {
            return Q.reject(err);
        }
    }

    node.publish = function(options) {

        var instructions = node.hints.actions.publish;

        if (!instructions) {
            return Q.reject(new Error("Nothing to publish!"));
        }

        var done = Q.resolve();

        instructions.forEach(function(instruction) {
            done = Q.when(done, function() {
                // TODO: Rename to `vcs`.
                if (instruction[0] === "code") {

                    if (instruction[1] === "origin") {

                        if (!node.summary.vcs) {
                            throw new Error("Cannot publish code as no VCS found.");
                        }

                        var deferred = Q.defer();
                        node.getPlugin(node.summary.vcs.type, function(err, pm) {
                            if (err) return deferred.reject(err);

                            TERM.stdout.writenl("Pushing changes for vcs '" + node.summary.vcs.type + "' for package: " + node.path);

                            return pm.publish(options).then(function() {
                                return node.refresh(options);
                            }).then(deferred.resolve, deferred.reject);
                        });
                        return deferred.promise;

                    } else {
                        throw new Error("NYI: " + instruction[1]);
                    }
                } else
                if (instruction[0] === "package") {

                    return Q.fcall(function() {
                        // If a publish script is specified we call it instead of `node.summary.pm.publish`.
                        if (node.summary.scripts.publish) {
                            // TODO: Use generic script executer here. Command formatter is in `HELPER`.
                            // ASSUMES: `<script> ...`.
                            TERM.stdout.writenl("Running `publish` script '" + node.summary.scripts.publish) + "' for package: " + node.path;
                            var command = node.summary.scripts.publish.split(" ");
                            var opts = UTIL.copy(options);
                            opts.cwd = node.path;
                            if (options.format === "JSON") opts.returnOutput = true;
                            return OS.spawnInline(command.shift(), command, opts);
                        } else {
                            var deferred = Q.defer();
                            node.getPlugin(node.summary.pm.publish, function(err, pm) {
                                if (err) return deferred.reject(err);
                                TERM.stdout.writenl("Running publish for pm '" + pm.pluginId + "' for package: " + node.path);
                                return pm.publish(options).then(deferred.resolve, deferred.reject);
                                return deferred.resolve();
                            });
                            return deferred.promise;
                        }
                    }).then(function() {
                        // TODO: Indicate that new info should be loaded from online.
                        return node.refresh(options);
                    });

                } else {
                    throw new Error("NYI: " + instruction[0]);
                }

            });
        });

        return done;
    }

    node.deploy = function(options) {
        // TODO: Use `pm.deploy` from package descriptor to pick deploy plugin but always
        //       run `deploy` script only if declared.
        var deferred = Q.defer();
        node.getPlugin("sm", function(err, plugin) {
            if (err) return deferred.reject(err);
            return plugin.deploy(options).then(deferred.resolve, deferred.reject);
        });
        return deferred.promise;
    }

    node.postinstall = function(options) {
        var deferred = Q.defer();
        node.getPlugin(node.summary.pm.install, function(err, plugin) {
            if (err) return deferred.reject(err);
            return plugin.postinstall(node, options).then(deferred.resolve, deferred.reject);
        });
        return deferred.promise;
    }

    node.edit = function(locator, options) {
        var self = this;
        var opts = UTIL.copy(options);
        opts.vcsOnly = true;
        opts.keepTopVcs = true;
        opts.now = true;
        opts.time = Date.now();
        return self.downloadAndExtract(locator, opts).then(function() {
            return node.refresh(options);
        });
    }

    node.diff = function(options) {
        var self = this;
        // Fast comparison of all files in tree based on mtimes as compared
        // to mtime of parent dir.
        // NOTE: This does not detect file deletions.
        function diffTree(packagePath, options, callback) {
            var walker = new self.API.WALKER.Walker(packagePath);
            var opts = self.API.UTIL.copy(options);
            opts.includeDependencies = true;
            opts.respectDistignore = false;
            opts.respectNestedIgnore = true;
            if (options.progress) {
                self.API.TERM.stdout.write(".");
            }
            return walker.walk(opts, function(err, list) {
                if (err) return callback(err);
                if (options.progress) {
                    self.API.TERM.stdout.write(".");
                }
                var changes = {};
                function findParentPackage(relpath) {
                    while(true) {
                        if (list[PATH.join(relpath, "package.json")]) {
                            break;
                        }
                        var path = PATH.dirname(relpath);
                        if (path === relpath) {
                            break;
                        }
                        relpath = path;
                    }
                    return self.API.FS.realpathSync(PATH.join(packagePath, relpath));
                }
                list["/"] = self.API.FS.statSync(packagePath).mtime.getTime();
                for (var relpath in list) {
                    if (
                        list[relpath].dir !== true &&
                        // mtime of modified file must be newer than mtime of parent directory (by at least 1 minute).
                        list[relpath].mtime > (list[PATH.dirname(relpath)].mtime + (60 * 1000))
                    ) {
                        var parentPackage = findParentPackage(PATH.dirname(relpath));
                        if (!changes[parentPackage]) changes[parentPackage] = {};
                        var realRelpath = self.API.FS.realpathSync(PATH.join(packagePath, relpath));
                        changes[parentPackage][realRelpath.substring(parentPackage.length)] = "modified";
                    }
                }
                var waitfor = self.API.WAITFOR.serial(function(err) {
                    if (err) return callback(err);
                    if (options.progress) {
                        self.API.TERM.stdout.write("\n");
                    }
                    return callback(null, changes);
                });
                // Check if packages have VCS present. If one does we remove all files
                // that are covered by VCS and ask VCS to give us the diff.
                var vcsPackages = {};
                for (var pkgPath in changes) {
                    waitfor(pkgPath, function(pkgPath, done) {
                        if (options.progress) {
                            self.API.TERM.stdout.write(".");
                        }
                        // A package may containe nested packages in the same VCS repository.
                        function findVCS(packagePath) {
                            while(true) {
                                if (self.API.FS.existsSync(PATH.join(packagePath, ".git"))) break;
                                var path = PATH.dirname(packagePath);
                                if (path === packagePath) {
                                    packagePath = false;
                                    break;
                                }
                                packagePath = path;
                            }
                            return packagePath;
                        }
                        function loadVCS(packagePath, callback) {
                            if (vcsPackages[packagePath]) return callback(null, vcsPackages[packagePath]);
                            var walker = new self.API.WALKER.Walker(packagePath);
                            var opts = self.API.UTIL.copy(options);
                            opts.includeDependencies = false;
                            opts.respectDistignore = false;
                            opts.respectNestedIgnore = true;
                            return walker.walk(opts, function(err, list) {
                                if (err) return callback(err);
                                vcsPackages[packagePath] = list;
                                // Now that we have all files in the package we remove any files that are dirty.
                                // This will cause the dirty files to stay in `changes` below.
                                var opts = self.API.UTIL.copy(options);
                                opts.format = "JSON";
                                return self.API.SM_CORE.for(packagePath).status(".", opts).then(function(node) {
                                    node = node[0];
                                    if (!node.summary.vcs || !node.summary.vcs.dirty) return callback(null, vcsPackages[packagePath]);
                                    return node.getPlugin(node.summary.vcs.type, function(err, plugin) {
                                        if (err) return callback(err);
                                        return plugin.diff(options, function(err, files) {
                                            if (err) return callback(err);
                                            if (files) {
                                                for (var relpath in files) {
                                                    delete vcsPackages[packagePath][relpath];
                                                }
                                            }
                                            return callback(null, vcsPackages[packagePath]);
                                        });
                                    });
                                }).fail(callback);
                            });
                        }
                        var vcsPackagePath = findVCS(pkgPath);
                        if (!vcsPackagePath) return done();
                        return loadVCS(vcsPackagePath, function(err, list) {
                            if (err) return done(err);
                            var subPath = "";
                            if (pkgPath !== vcsPackagePath) {
                                subPath = pkgPath.substring(vcsPackagePath.length);
                            }
                            var found = false;
                            for (var relpath in list) {
                                relpath = relpath.substring(subPath.length);
                                if (changes[pkgPath] && changes[pkgPath][relpath]) {
                                    found = true;
                                    delete changes[pkgPath][relpath];
                                }
                            }
                            if (changes[pkgPath] && UTIL.len(changes[pkgPath]) === 0) {
                                delete changes[pkgPath];
                            }
                            return done();
                        });
                    });
                }
                return waitfor();
            });
        }

        var deferred = self.API.Q.defer();
        diffTree(this.summary.path, options, function(err, changes) {
            if (err) return deferred.reject(err);
            return deferred.resolve(changes);
        });
        return deferred.promise;
        /*
        diffPackagePublished(rootNode, options, function(err, changes) {
            if (err) return deferred.reject(err);
            return deferred.resolve(changes);
        });
        */
        /*
        // TODO: This should be refactored into `diffTree()` above.
        // Get changed files by comparing packages by traversing into each
        // package and comparing it to VCS, manifest or cache. Use this to
        // determine changes compared to published packages. If this comes
        // back with no changes; all code is guaranteed as published.
        // TODO: Finish comparisons including deletions.
        // NOTE: This can be quite slow if traversing many packages.
        // TODO: Speed up with refactor of `sm` core.
        function diffPackagePublished(node, options, callback) {

            var packagePath = node.summary.path;

        //  console.log("node.summary", node.summary);

            var changes = (options.carry && options.carry.diffChanges) || {};

            if (changes[packagePath]) return callback(null, changes);

            if (options.verbose) {
                console.log("packagePath", packagePath);
            } else
            if (options.progress) {
                self.API.TERM.stdout.write(".");
            }

            if (!changes[packagePath]) changes[packagePath] = {};

            function allDone(callback) {
                if (!options.verbose && options.progress && options.progress !== "inline") {
                    self.API.TERM.stdout.write("\n");
                }
                return callback(null, changes);
            }

            function walkChildren(callback) {
                var walker = new self.API.WALKER.Walker(packagePath);
                return walker.walk(options, function(err, list) {
                    // Traverse into all dependency packages even if not in direct hirarchy.
                    // i.e. We also traverse packages if a package contains a package.json file in
                    // an arbitrary directory.
                    var roots = [];
                    function addDependencies(packagePath) {
                        // TODO: Adjust package dir based on `directories.package` in descriptor.
                        var packagesPath = PATH.join(packagePath, "node_modules");
                        if (self.API.FS.existsSync(packagesPath)) {
                            self.API.FS.readdirSync(packagesPath).forEach(function(filename) {
                                if (filename === ".bin") return;
                                if (/~backup-/.test(filename)) return;
                                roots.push(PATH.join(packagesPath, filename));
                            });
                        }
                    }
                    addDependencies(packagePath);
                    if (list) {
                        // Determine if a file has changed by comparing mtimes to mtime of source.json
                        // file which gets written after install (and not touched after).
                        var sourcesPath = packagePath;
                        while(true) {
                            var path = PATH.join(sourcesPath, ".sm/source.json");
                            if (self.API.FS.existsSync(path)) {
                                sourcesPath = path;
                                break;
                            }
                            path = PATH.dirname(sourcesPath);
                            if (path === sourcesPath) {
                                sourcesPath = false;
                                break;
                            }
                            sourcesPath = path;
                        }
                        var sourcesMtime = false;
                        if (!node.summary.vcs && sourcesPath) {
                            sourcesMtime = self.API.FS.statSync(sourcesPath).mtime.getTime();
                        }
                        for (var relpath in list) {
                            if (
                                sourcesMtime &&
                                list[relpath].mtime &&
                                !/^\/node_modules\/\.bin\/[^\/]*$/.test(relpath) &&
                                // NOTE: We don't include changes to `package.json` files here as they may be
                                //       touched by npm. The assumption is that when running `sm diff` we are
                                //       looking for changes to CODE files. If `package.json` is in fact modified
                                //       the package should be in edit mode!
                                !/\/package\.json$/.test(relpath) &&
                                list[relpath].mtime > sourcesMtime &&
                                // mtime of modified file must be newer than mtime of parent directory (by at least 1 minute).
                                list[relpath].mtime > (self.API.FS.statSync(PATH.join(packagePath, relpath, "..")).mtime.getTime() + (60 * 1000))
                            ) {
                                changes[packagePath][relpath] = "modified";
                            }
                            if (relpath !== "/package.json" && /\/package.json$/.test(relpath)) {
                                addDependencies(PATH.join(packagePath, relpath, ".."));
                            }
                        }
                    }
                    if (roots.length === 0) {
                        return allDone(callback);
                    }
                    var waitfor = self.API.WAITFOR.serial(function(err) {
                        if (err) return callback(err);
                        return allDone(callback);
                    });
                    roots.forEach(function(packagePath) {
                        if (changes[packagePath]) {
                            return;
                        }
                        return waitfor(function(done) {
                            var opts = self.API.UTIL.copy(options);
                            opts.format = "JSON";
                            if (options.progress) {
                                opts.progress = "inline";
                            }
                            opts.carry = {
                                diffChanges: changes
                            };
                            try {
                                return self.API.SM_CORE.for(packagePath).diff(opts).then(function(subChanges) {
                                    // NOTE: We ignore `subChanges` here as we carry the changes by reference in the options.
                                    return done();
                                }).fail(done);
                            } catch(err) {
                                return done(err);
                            }
                        });
                    });
                    return waitfor();
                });
            }

            if (node.summary.vcs) {
                // Package is under version control. Use VCS to get changed files.
                if (node.summary.vcs.dirty) {

                    return node.getPlugin(node.summary.vcs.type, function(err, plugin) {
                        if (err) return callback(err);

                        return plugin.diff(options, function(err, files) {
                            if (err) return callback(err);
                            if (files) {
                                changes[node.summary.path] = files;
                            }
                            return walkChildren(callback);
                        });
                    });

                } else {
                    // Not dirty. i.e. no changes in package.
                    return walkChildren(callback);
                }
            } else {

                // TODO: Compare against `.sm/manifest.json` if found (should be written on install).
                //       If not found in our package dir, go up all dirs to find it and look for matching
                //       entries for our package.

                return walkChildren(callback);
            }
        }
        */
    }
}
