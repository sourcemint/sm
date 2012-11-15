
const PATH = require("path");
const FS = require("graceful-fs");
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const WAITFOR = require("sourcemint-util-js/lib/wait-for");

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
	    var deferred = Q.defer();
    	var waitFor = WAITFOR.parallel(function(err) {
    		if (err) return deferred.reject(err);
    		return deferred.resolve(fsTree);
    	});
    	fsTree.traverse(function(node) {
            addFunctions(node, options);
    		waitFor(function(done) {    			
    		    return loadStatus(node, options, function(err) {
                    if (err) return done(err);
                    return summarize(node, options, function(err) {
                        if (err) return done(err);
                        return generateHints(node, options, done);
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
							return done();
						});
					}).fail(done);
				});
			}
		});
		waitFor();
	}

	loadOutstanding(callback);
}

function summarize(node, options, callback) {
    try {
        var inParent = (!node.exists && node.parent && node.parent.findNameInTransitiveParents(node)) || false;
        if (node.circular || inParent) {
            var parentNode = node.circular || inParent;            
            var locator = node.descriptors.locator;
            node.descriptors = UTIL.copy(parentNode.descriptors);
            node.descriptors.locator = locator;
            node.exists = parentNode.exists;
        }

        var info = {
            name: node.name,
            relpath: node.relpath,
            level: node.level,
            path: node.path,
            dir: node.dir,
            symlinked: node.symlinked,
            inParent: (inParent)?(node.level - inParent.level):false,
            version: (node.descriptors.package && node.descriptors.package.version) || false,
            declared: false,
            bundled: false,
            pm: false,
            locator: false,
            installed: node.exists,
            locked: false,
            sticky: false,
            newLocator: false,
            newLockedLocator: false,
            newStickyLocator: false,
            newInLocator: false,
            newOutLocator: false,
            platformName: false,
            platformVersion: false,
            newPlatformVersion: false,
            vcs: false,
            git: false,
            // TODO: Deep copy object?
            scripts: (node.descriptors.package && node.descriptors.package.scripts) || false,
            // TODO: Deep copy object?
            directories: (node.descriptors.package && node.descriptors.package.directories) || {}
        };
        if (typeof info.directories.lib === "undefined") {
            info.directories.lib = "lib";
        }

        if (node.status.git) {
            info.vcs = {};
            if (node.status.git.writable) {
                info.vcs.mode = "write";
            } else {
                info.vcs.mode = "read";
            }
        } else {
            // TODO: Check for other VCSs.
        }


        node.summary = info;
    } catch(err) {
        return callback(err);        
    }
    return callback(null);
}


// This logic determines the status that is displayed to the user and what actions will happen when
// when `sm install|update [...]` is called. No part of the system should offer the user to do something
// that is not established/authorized here!
function generateHints(node, options, callback) {
    try {

        var info = node.summary;

        var hints = {
            display: {
                missing: false
            },
            actions: {
                install: false,
                // NOTE: Update actions always update top sticky if present.
                update: false,
                updateOptional: false
            }
        };
    /*
            info.newLocator = info.newLockedLocator || 
                              (!info.locked && info.newStickyLocator) || 
                              (!info.locked && !info.sticky && info.newInLocator) || 
                              ((!info.installed || info.newPlatformVersion) && info.locator);
    */
        if (!info.installed) {
            if (info.locked) {
                hints.actions.install = ["code", info.newLockedLocator];
            } else
            if (info.sticky) {
                hints.actions.install = ["code", info.newStickyLocator];
            } else {
                hints.actions.install = ["code", info.newInLocator];
            }
            hints.display.missing = ["red", "bold", "MISSING", "\0red(To fix \0bold(MISSING\0) run: \0bold(sm install\0)\0)", hints.actions.install[1]];
        } else {            
            if (info.locked && info.newLockedLocator) {
                hints.actions.install = info.newLockedLocator;
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

            if (!hints.actions.install && info.newPlatformVersion) {
    throw new Error("TODO: New platform version");
    //                line.push("\0red((" + info.platformName + ": " + info.platformVersion + " <p- " + info.newPlatformVersion + ")\0)");
    //                statusHints["-platform-must-"] = true;
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

            if (info.git) {
                if (info.git.dirty) {
                    hints.actions.fix = ["code"];
                    hints.display.dirty = ["red", "bold", "dirty", "\0red(To fix \0bold(dirty\0) run: \0bold(sm fix\0)\0)"];
                } else
                if (info.git.behind) {
                    hints.actions.updateOptional = ["code", "origin"];
                    hints.display.behind = ["magenta", "bold", "behind", "\0magenta(To fix \0bold(behind\0) run: \0bold(sm update\0)\0)"];
                } else
                if (info.git.ahead) {
                    hints.actions.save = ["code", "origin"];
                    hints.display.ahead = ["magenta", "bold", "ahead", "\0magenta(To fix \0bold(ahead\0) run: \0bold(sm save\0)\0)"];
                } else
                if (!info.git.tagged) {
                    if (info.npm) {
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
            if (info.locator) {
                segment = info.locator.toString("minimal");
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

        if (info.npm) {
            segment = " \0" + ((hints.actions.install)?"red":"green") + "(npm";
            if (info.locator && info.locator.selector && info.locator.selector !== info.locator.toString("minimal")) {
                segment += " " + info.locator.selector;
            }
            line.push(segment + "\0)");
        }

        if (hints.display.out) {
            line.push("\0magenta(" + renderHint(hints.display.out) + " " + hints.display.out[4].toString("minimal") + "\0)");
        }

/*
        if (info.newPlatformVersion) {
            ok = false;
            line.push("\0red((" + info.platformName + ": " + info.platformVersion + " <p- " + info.newPlatformVersion + ")\0)");
            statusHints["-platform-must-"] = true;
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
        if (info.git) {
            line.push(" \0" + ((vcsStatusHint)?vcsStatusHint[0]:"green") + "(git");
            if (info.git.branch !== "master" && (!info.locator || info.git.rev !== info.locator.version)) {
                if (info.git.branch != info.git.rev) {
                    line.push("\0orange(" + info.git.branch + " - " + info.git.rev + "\0)");
                } else {
                    line.push("\0orange(" + info.git.branch + "\0)");
                }
            } else
            if (!info.locator || info.git.branch !== info.locator.toString("minimal")) {
                line.push(info.git.branch);
            }
            if (info.git.tagged) {
                line.push("(" + info.git.tagged + ")");
            }
            line.push("\0)" + ((vcsStatusHint)?renderHint(vcsStatusHint):""));
        }

        if (hints.display.publish) {
            if (info.npm) {
                line.push("\0" + hints.display.publish[0] + "(-(" + info.git.rev + ")> \0bold(npm\0)\0)");
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
}

