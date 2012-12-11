
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("graceful-fs");
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const WAITFOR = require("sourcemint-util-js/lib/wait-for");
const LOCATOR = require("./locator");
const CATALOG = require("./catalog");
const HELPERS = require("./helpers");
const SEMVER = require("semver");


var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new Status(packageRootPath);
	}
	return instances[packageRootPath];
}


var Status = function(packageRootPath) {
	var self = this;

	self.embellishFsTree = function(fsTree, options) {
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
                        if (!traversed[tNode.path]) {
                            traversed[tNode.path] = true;
                            callback(tNode);
                        }
                    });
                });
            }
        }
	    var deferred = Q.defer();
    	var waitFor = WAITFOR.parallel(function(err) {
    		if (err) return deferred.reject(err);
            var waitFor = WAITFOR.parallel(function(err) {
                if (err) return deferred.reject(err);

                try {
                    if (fsTree.top && typeof fsTree.top.collectDeepHints === "function") {
                        fsTree.top.collectDeepHints();
                    }
                } catch(err) {
                    return deferred.reject(err);
                }

                return deferred.resolve(fsTree);
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

            addFunctions(node, options);

    		waitFor(function(done) {
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
		return deferred.promise;
	}

	return self;
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
					return node.getPlugin(pair[0]).then(function(plugin) {
						// A plugin may request to fetch status for other plugins.
						node.requestStatusFor = function(pluginId) {
							if (typeof node.status[pluginId] !== "undefined") return;
							node.status[pluginId] = true;
						}
						return plugin.status(options).then(function(status) {
							delete node.requestStatusFor;
							node.status[pair[0]] = status || false;
                        });
					}).then(done, done);
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

        var inParent = (!node.exists && node.parent && node.parent.findNameInTransitiveParents(node)) || false;
        if (node.circular || inParent) {
            var parentNode = node.circular || inParent;            
            var locator = node.descriptors.locator;
            node.descriptors = UTIL.copy(parentNode.descriptors);
            node.descriptors.locator = locator;
            node.exists = parentNode.exists;
        }

//console.log("node", node.name, node.latest);

        var info = node.summary = {
            name: node.name,
            relpath: node.relpath,
            level: node.level,
            path: node.path,
            dir: node.dir,
            symlinked: node.symlinked,
            inParent: (inParent)?(node.level - inParent.level):false,
            version: false,
            rev: false,
            installed: node.exists,
            declared: false,
            bundled: false,
            optional: false,
            pm: {
                locator: false,
                install: false
            },
            declaredLocator: false,
            actualLocator: false,
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
            scripts: (node.descriptors.package && node.descriptors.package.scripts) || false,
            // TODO: Deep copy object?
            directories: (node.descriptors.package && node.descriptors.package.directories) || {},
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
            }
        } else {
            // TODO: Check for other VCSs.
        }


        if (node.descriptors.locator) {
            if (!info.pm.locator && typeof node.descriptors.locator.pm !== "undefined") {
                info.pm.locator = node.descriptors.locator.pm;
            }
            if (!info.pm.install && node.descriptors.locator.descriptor && typeof node.descriptors.locator.descriptor.pm !== "undefined") {
                info.pm.install = node.descriptors.locator.descriptor.pm;
            }
        }
        if (!info.pm.install && node.descriptors.package && typeof node.descriptors.package.pm !== "undefined") {
            info.pm.install = node.descriptors.package.pm;
        }
        if (!info.pm.install && info.vcs && node.latest[info.vcs.type] && node.latest[info.vcs.type].descriptor && typeof node.latest[info.vcs.type].descriptor.pm !== "undefined") {
            info.pm.install = node.latest[info.vcs.type].descriptor.pm;
        }
        if (!info.pm.install) info.pm.install = (info.pm.locator)?info.pm.locator:"sm";
        if (!info.pm.locator) info.pm.locator = info.pm.install;


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
        if (node.descriptors.package) {
            info.repositoryUri = repositoryFromDescriptor(node.descriptors.package);
            info.homepageUri = node.descriptors.package.homepage || false;
            info.version = node.descriptors.package.version || false;
        }
        if (info.vcs && node.status[info.vcs.type]) {
            info.rev = node.status[info.vcs.type].rev || false;
            // If VCS is not dirty and current rev is tagged it must equal version in package descriptor.
            if (
                !info.vcs.dirty &&
                node.status[info.vcs.type].version &&
                !SEMVER.eq(node.status[info.vcs.type].version, info.version)
            ) {
                TERM.stdout.writenl("\0yellow([sm] WARNING: Package descriptor for package '" + node.path + "' does not set `version` to `" + node.status[info.vcs.type].version + "` which is the latest version tagged in " + info.vcs.type + ".\0)");
            }
        }
        if (info.vcs && node.latest[info.vcs.type] && node.latest[info.vcs.type].descriptor) {
            if (!info.repositoryUri) info.repositoryUri = repositoryFromDescriptor(node.latest[info.vcs.type].descriptor);
            if (!info.homepageUri) info.homepageUri = node.latest[info.vcs.type].descriptor.homepage || false;
        }
        if (info.pm.locator && node.latest[info.pm.locator] && node.latest[info.pm.locator].descriptor) {
            if (!info.repositoryUri) info.repositoryUri = repositoryFromDescriptor(node.latest[info.pm.locator].descriptor);
            if (!info.homepageUri) info.homepageUri = node.latest[info.pm.locator].descriptor.homepage || false;
        }


        var locator = {};
        if (node.descriptors.locator) {
            locator = node.descriptors.locator;
        } else
        if (info.vcs && info.vcs.pointer) {
            locator = { pointer: info.vcs.pointer };
        } else
        if (node.descriptors.smSource && node.descriptors.smSource.locator) {
            locator = node.descriptors.smSource.locator;
        } else
        if (info.pm.locator && node.status[info.pm.locator]) {
            locator = node.status[info.pm.locator];
        } else
        if (node.summary.repositoryUri) {
            locator = { pointer: node.summary.repositoryUri };
        } else
        if (node.summary.homepageUri) {
            locator = { pointer: node.summary.homepageUri };
        }
        locator.pm = info.pm.locator;
        locator.name = info.name;
        if (locator.optional === true) {
            info.optional = true;
        }
        if (locator.bundled === true && locator.pointer === "__DERIVE__") {
            locator.pointer = node.summary.version;

/*

console.log(Object.keys(node.parent.children));
console.log(node.parent.children[locator.name]);

throw new Error("TODO: Get `pointer` by looking at bundled child.");
*/
        }

        return LOCATOR.makeLocator(node, locator, options, function(err, locator) {
            if (err) return callback(err);

            info.declaredLocator = locator;

            function setDeclaredLocator(callback) {
                if (info.declaredLocator) {
                    info.pm.locator = info.declaredLocator.pm;
                    if (info.installed) {
                        function setActualLocator(locator) {
                            info.actualLocator = locator.clone();
                            if (info.rev) {
                                info.actualLocator.setRev(info.rev);
                            } else {
                                if (info.actualLocator.rev) {
                                    info.rev = info.actualLocator;
                                }
                            }
                            info.actualLocator.setVersion(info.version);
                        }
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
            }

            function finalize(callback) {
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
                info.engineName = "node";
                var engineVersion = process.version.replace(/^v/, "");
                info.engineVersion = engineVersion;
                if (node.descriptors.smSource && node.descriptors.smSource.engine) {
                    info.engineVersion = node.descriptors.smSource.engine.version;
                    if (info.engineVersion !== engineVersion || info.engineName != node.descriptors.smSource.engine.name) {
                        info.newEngineVersion = engineVersion;
                    }
                }
                return callback(null);
            }

            return setDeclaredLocator(function (err) {
                if (err) return callback(err);
                
                return finalize(callback);
            });
        });

    } catch(err) {
        return callback(err);        
    }
    return callback(null);
}

function loadLatest(node, options, callback) {

    if (!node.summary.declaredLocator) return callback(null);

    function setLatest(name, latest) {
        node.latest[name] = latest || false;
    }

    var waitFor = WAITFOR.parallel(function (err) {
        if (err) return callback(err);
        if (node.summary.pm.locator && typeof node.latest[node.summary.pm.locator] === "undefined") {
            return node.getPlugin(node.summary.pm.locator).then(function(plugin) {                
                return plugin.latest(options).then(function(latest) {
                    return setLatest(node.summary.pm.locator, latest);
                });
            }).then(callback, callback);
        }
        return callback();
    });
    Object.keys(node.status).forEach(function(pluginName) {
        waitFor(function(done) {
            return node.getPlugin(pluginName).then(function(plugin) {
                return plugin.latest(options).then(function(latest) {
                    return setLatest(pluginName, latest);
                });
            }).then(done, done);
        });
    });
    waitFor();
}

function finalize(node, options, callback) {
    try {

        var info = node.summary;

//console.log("node", node.name);

        node.catalogs = {};
        [
            ["npm-shrinkwrap", "dependencies", "tree"],
            ["sm-catalog", "packages", "list"],
            ["sm-catalog.locked", "packages", "list"],
        ].forEach(function (catalog) {
            node.catalogs[catalog[0]] = new CATALOG.Catalog(
                (node.descriptors[catalog[0]] && node.descriptors[catalog[0]][catalog[1]]) || {}
            , {
                format: catalog[2],
                parent: (node.parent && node.parent.catalogs[catalog[0]]) || null
            });
        });

        function determineLocked(callback) {
            if (info.level === 0) return callback(null);
            info.locked = node.catalogs["sm-catalog.locked"].isDeclared(node.name) ||
                          false;
            if (info.locked) {
                var locator = UTIL.copy(info.locked);
                locator.pm = info.declaredLocator.pm;
                locator.name = info.declaredLocator.descriptor.name;
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
            if (info.sticky) {
                var locator = UTIL.copy(info.sticky);
                locator.pm = info.declaredLocator.pm;
                locator.name = info.declaredLocator.descriptor.name;
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
                if (
                    info.level > 0 &&
                    locator &&
                    locator.isResolved() &&
                    !(info.actualLocator && locator.equals(info.actualLocator)) &&
                    !(info.newStickyLocator && locator.equals(info.newStickyLocator)) &&
                    !(info.newLockedLocator && locator.equals(info.newLockedLocator))
                ) {
                    info.newInLocator = locator;
                }
                return info.declaredLocator.getLatest(node, options, function(err, locator) {
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
                                if (older) {
                                    info.newInLocator = locator;
                                }
                                return callback(null);
                            });
                        } else {
                            if (info.actualLocator && locator.rev) {
                                // TODO: Check if `locator.rev` is older than (i.e. already present locally) `info.actualLocator.rev` 
                                //       and don't set `info.newOutLocator` if so.
                                //       Use `node.getPlugin(info.vcs.type)....` and add new function to plugin.
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
    try {

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
            } else {
                if (info.locked) {
                    hints.actions.install = ["code", info.newLockedLocator];
                } else
                if (info.sticky) {
                    hints.actions.install = ["code", info.newStickyLocator];
                } else {
                    hints.actions.install = ["code", info.newInLocator || info.newOutLocator || info.declaredLocator];
                }
                hints.display.missing = ["red", "bold", "MISSING", "\0red(To fix \0bold(MISSING\0) run: \0bold(sm install\0)\0)", hints.actions.install[1]];
            }
        } else {            
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
throw new Error("TODO: New engine version");
//                line.push("\0red((" + info.engineName + ": " + info.engineVersion + " <p- " + info.newEngineVersion + ")\0)");
//                statusHints["-engine-must-"] = true;
            }

            if (this.level > 0 && !info.declared) {
// TODO: Populate `info.dynamic` from `.sourcemint/source.json` ~ dynamic if installed via `SM.install()`.
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
                    hints.display.dirty = ["red", "bold", "dirty", "\0red(To fix \0bold(dirty\0) run: \0bold(sm fix\0)\0)"];
                } else
                if (info.vcs.behind) {
                    hints.actions.updateOptional = ["code", "origin"];
                    hints.display.behind = ["magenta", "bold", "behind", "\0magenta(To fix \0bold(behind\0) run: \0bold(sm update\0)\0)"];
                } else
                if (info.vcs.ahead) {
                    hints.actions.save = ["code", "origin"];
                    hints.display.ahead = ["magenta", "bold", "ahead", "\0magenta(To fix \0bold(ahead\0) run: \0bold(sm save\0)\0)"];
                } else
                if (!info.vcs.version) {
                    if (info.pm) {
                        hints.actions.publish = ["code", "origin"];
                        hints.display.publish = ["magenta", "normal", "-(*)>", "\0magenta(To fix -(*)> run: \0bold(sm bump -p\0)\0)"];
                    }
                }
            }
        }
        node.hints = hints;
    } catch(err) {
        return callback(err);        
    }
    return callback(null);
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

        line.push("\0" + ((hints.display.missing)?"red":"yellow") + "(" + ((node.level <= 1)?("\0bold(" + info.name + "\0)"):info.name));
        line.push(((node.descriptors.locator && node.descriptors.locator.viaAttribute && /^dev/.test(node.descriptors.locator.viaAttribute))?"\0cyan(D\0)":"@"));
        var segment = "";

        if (hints.display.missing) {
            segment = renderHint(hints.display.missing) + " \0" + hints.display.missing[0] + "(" + hints.display.missing[4].toString("minimal") + "\0)";
        } else {
            if (info.actualLocator) {
                segment = info.actualLocator.toString("minimal");
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

        if (info.dynamic) {
            line.push("\0magenta(DYNAMIC\0)");
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
            if (info.vcs.version) {
                line.push("(" + info.vcs.version + ")");
            }
            line.push("\0)" + ((vcsStatusHint)?renderHint(vcsStatusHint):""));
        }

        if (hints.display.publish) {
            if (info.npm) {
                line.push("\0" + hints.display.publish[0] + "(-(" + info.vcs.rev + ")> \0bold(npm\0)\0)");
            }
        }



        if (node.level === 0 && options.mode === "tree") {
            line.push(" (" + node.path + ")");
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
            if (info.repositoryUri || info.homepageUri) {
                line.push(" \0yellow(" + (info.repositoryUri || info.homepageUri) + "\0) ");
            }
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
        var found = false;
        for (var name in node.summary) {
            if (node.summary[name] === locator) {
                found = true;
                break;
            }
        }
        if (!found) return Q.reject(new Error("`locator` must be one of the locators from `node.summary`"));

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
                    return node.getPlugin(latest.type).then(function(plugin) {
                        var uri = locator.getLocation("pointer");
                        var installCachePath = node.getCachePath("install", uri);
                        options.logger.info("Extracting `" + latest.cachePath + "` to `" + installCachePath + "`");
                        return plugin.extract(latest.cachePath, installCachePath, locator, options).then(function() {
                            return {
                                status: 200,
                                pointer: uri,
                                cachePath: installCachePath
                            };
                        }).fail(function(err) {
                            if (PATH.existsSync(installCachePath)) {
                                FS_RECURSIVE.rmSyncRecursive(installCachePath);
                            }
                            throw err;
                        });
                    });
                };
            }
            if (latest) {
                latest = makeExtractor(latest);
            } else
            if (force) {

callback(new Error("TODO: Force download VCS in cache."));

                return callback(null, latest);
            }
            return callback(null, latest);
        }

        var deferred = Q.defer();
        isVcsCacheAvailable(options.vcsOnly, function(err, extractor) {
            if (extractor) {
                return extractor(options).then(deferred.resolve, deferred.reject);
            } else {

                // Try and mirror the package/resource starting with the *best* uri.
                var cacheInfo = {
                    status: false
                };
                var waitFor = WAITFOR.serial(function(err) {
                    if (err) return deferred.reject(err);
                    if (cacheInfo.status === false) {
                        return deferred.reject(new Error("Unable to derive download URL for locator `" + locator + "`"));
                    }
                    return deferred.resolve(cacheInfo);
                });
                [
                    "tar",
                    "zip"
                    // TODO: Add more archive types.
                ].forEach(function(type) {
                    waitFor(function(done) {
                        if (cacheInfo.status !== false) return done();
                        var uri = locator.getLocation(type);
                        if (!uri) {
                            options.logger.debug("Skip download of `" + locator + "` via plugin `" + type + "` as uri could not be resolved.");
                            return done();
                        }
                        var installCachePath = node.getCachePath("install", uri);
                        if (PATH.existsSync(installCachePath)) {
                            // Assume install cache exists and was properly installed previously.
                            options.logger.debug("Skip downloading `" + uri + "` via `" + type + "` plugin (found in cache)");
                            cacheInfo = {
                                status: 304,
                                pointer: uri,
                                cachePath: installCachePath
                            };
                            return done();
                        }
                        return node.getPlugin(type).then(function(plugin) {

                            options.logger.info("Downloading `" + uri + "` via `" + type + "` plugin");

                            return plugin.download(uri, options).then(function(response) {
                                ASSERT(typeof response.status === "number", "`response.status` must be an integer");

                                // TODO: Handle `response.status === 404` properly.

                                ASSERT(typeof response.cachePath !== "undefined", "`response.cachePath` must be set");

                                options.logger.info("Extracting `" + response.cachePath + "` to `" + installCachePath + "`");

                                return plugin.extract(response.cachePath, installCachePath, locator, options).then(function() {
                                    cacheInfo = {
                                        status: 200,
                                        pointer: uri,
                                        cachePath: installCachePath
                                    };
                                    return done();
                                });
                            });
                        }).fail(function(err) {
                            if (PATH.existsSync(installCachePath)) {
                                FS_RECURSIVE.rmSyncRecursive(installCachePath);
                            }
                            return done(err);
                        });
                    });
                });
                waitFor();
            }
        });
        return deferred.promise;
    }

    node.install = function(options) {

        var instructions = node.hints.actions.install || node.hints.actions.installOptional;

        if (!instructions) {
            return Q.reject(new Error("Nothing to install!"));
        }

        try {
            if (instructions[0] === "code") {

                options.logger.info("Installing `" + node.path + "` from `" + instructions[1] + "` via package manager `" + node.summary.pm.install + "`");

                return node.downloadAndExtract(instructions[1], options).then(function(response) {

                    return node.getPlugin(node.summary.pm.install).then(function(plugin) {

                        function copyVcsOnly() {
                            if (PATH.existsSync(PATH.join(node.path, ".git"))) {
                                return Q.reject(new Error("`.git` dir already found at: " + PATH.join(node.path, ".git")));
                            }
                            // TODO: Let VCS plugin copy VCS dir.
                            return FS_RECURSIVE.osCopyDirRecursive(
                                PATH.join(response.cachePath, ".git"),
                                PATH.join(node.path, ".git")
                            );
                        }

                        // If we got a new cache dir and only need VCS we just copy and don't install.
                        // When done we need to delete cache dir again (as we did not install it).
                        if (response.status === 200 && options.vcsOnly) {
                            return copyVcsOnly().then(function() {
                                if (PATH.existsSync(response.cachePath)) {
                                    FS_RECURSIVE.rmSyncRecursive(response.cachePath);
                                }
                            });
                        }

                        var done = Q.ref();
                        // If cache is new we need to install it.
                        if (response.status === 200) {
                            done = Q.when(done, function() {
                                options.logger.debug("Asking package manager `" + node.summary.pm.install + "` to install package.");
                                return plugin.install(response.cachePath, options);
                            });
                        }

                        return Q.when(done, function() {
                            // Copy from cache to final destination.
                            if (options.vcsOnly) {
                                return copyVcsOnly();
                            } else {
                                if (PATH.existsSync(node.path)) {
                                    var backupPath = node.path + "~backup-" + Date.now();
                                    if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Backing up '" + node.path + "' to '" + backupPath + "'." + "\0)");
                                    FS.renameSync(node.path, backupPath);
                                }
                                if (!PATH.existsSync(PATH.dirname(node.path))) {
                                    FS_RECURSIVE.mkdirSyncRecursive(PATH.dirname(node.path));
                                }
                                return FS_RECURSIVE.osCopyDirRecursive(response.cachePath, node.path).then(function() {
                                    if (node.level === 0 && options.keepTopVcs) return;
                                    // Sanitize.
                                    // TODO: Also remove `.svn` and other VCS dirs.
                                    if (PATH.existsSync(PATH.join(node.path, ".git"))) {
                                        FS_RECURSIVE.rmdirSyncRecursive(PATH.join(node.path, ".git"));
                                    }
                                });
                            }
                        });

                    }).then(function() {
                        var deferred = Q.defer();
                        function writeFile() {
                            FS.writeFile(PATH.join(node.path, ".sourcemint", "source.json"), JSON.stringify({
                                time: options.time,
                                dynamic: options.dynamic || false,
                                locator: {
                                    pointer: response.pointer
                                },
                                engine: {
                                    name: node.summary.engineName,
                                    version: node.summary.newEngineVersion || node.summary.engineVersion
                                }
                            }), function(err) {
                                if (err) return deferred.reject(err);
                                deferred.resolve();
                            });
                        }
                        PATH.exists(PATH.join(node.path, ".sourcemint"), function(exists) {
                            if (!exists) {
                                FS.mkdir(PATH.join(node.path, ".sourcemint"), function(err) {
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

                    }).fail(function(err) {
                        if (PATH.existsSync(response.cachePath)) {
                            FS_RECURSIVE.rmSyncRecursive(response.cachePath);
                        }
                        throw err;
                    });
                });

            } else {
                return Q.reject(new Error("NYI: " + JSON.serialize(instructions)));
            }
        } catch(err) {
            return Q.reject(err);
        }
    }
}
