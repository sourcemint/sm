
// TODO: Use `lib/walker.js` from `pinf-it-packagewrap`.

const PATH = require("path");
//const EVENTS = require('events');


var API = null;
exports.setAPI = function(api) {
	API = api;
}

exports.Walker = function(rootPath) {
	this.rootPath = rootPath;
    this.ignoreRules = {
        // Rules that match the top of the tree (i.e. prefixed with `/`).
        top: {},
        // Rules that apply to every level.
        every: {},
        // Rules that include specific files and directories.
        include: {},
        filename: null
    };
    this.stats = {
        ignoreRulesCount: 0,
        totalFiles: 0,
        ignoredFiles: 0,
        totalSize: 0
    };
}

//exports.Walker.prototype = new EVENTS.EventEmitter();

exports.Walker.prototype._insertIgnoreRule = function(ignoreRules, rule, subPath, options) {
    if (options.includeDependencies) {
        if (/^\/?node_modules\/?$/.test(rule)) {
        	return;
/*
TODO: Move to subclass.
            // We ignore the catalog so that the dependencies don't get updated on install.
            rule = "sm-catalog.json";
*/    
        }
    }
    var key = rule.split("*")[0];
    var scope = /^!/.test(rule) ? "include" : ( /^\//.test(rule) ? "top" : "every" );
    if (scope === "include") {
        key = key.substring(1);
        rule = rule.substring(1);
    }
    if (subPath && /^\//.test(key)) {
        key = subPath + key;
    }
    if (!ignoreRules[scope][key]) {
        ignoreRules[scope][key] = [];
    }
    var re = new RegExp(API.UTIL.regEscape(rule).replace(/\\\*/g, "[^\\/]*?"));
    ignoreRules[scope][key].push(function applyRule(path) {
        if (path === rule || re.test(path)) return true;
        return false;
    });
    this.stats.ignoreRulesCount += 1;
}

exports.Walker.prototype._loadIgnoreRulesFile = function(ignoreRules, path, subPath, options) {
	var self = this;
    if (!API.FS.existsSync(path)) return false;
    API.FS.readFileSync(path).toString().split("\n").forEach(function(rule) {
        if (!rule) return;
        self._insertIgnoreRule(ignoreRules, rule, subPath, options);
    });
    // TODO: Make this more generic.
    var packagePath = PATH.dirname(path);
    if (subPath) packagePath = PATH.join(packagePath, subPath);
    if (API.FS.existsSync(PATH.join(packagePath, ".git"))) {
        self._insertIgnoreRule(ignoreRules, ".git/", subPath, options);
    }
    if (API.FS.existsSync(PATH.join(packagePath, ".svn"))) {
        self._insertIgnoreRule(ignoreRules, ".svn/", subPath, options);
    }
    self._insertIgnoreRule(ignoreRules, "*~backup-*/", subPath, options);
    self._insertIgnoreRule(ignoreRules, ".sm/", subPath, options);
    return true;
}

exports.Walker.prototype._loadIgnoreRules = function(ignoreRules, subPath, options) {
	var self = this;
	var ignoreFiles = [];
    if (options.respectDistignore) {
    	ignoreFiles.push(".distignore");
    }
    // NOTE: We want to ignore nested ignore files when exporting as we may have generated
    //       files we want as part of export, but ignore otherwise.
    if (subPath === "" || options.respectNestedIgnore !== false) {
	    ignoreFiles.push(".npmignore");
	    ignoreFiles.push(".gitignore");
	}
	var found = false;
    ignoreFiles.forEach(function(basename) {
        if (found) return;
        if (self._loadIgnoreRulesFile(ignoreRules, PATH.join(self.rootPath, subPath, basename), subPath, options)) {
            found = true;
            ignoreRules.filename = basename;
        }
    });
    if (ignoreRules.filename === null) {
    	ignoreRules.filename = "default";
        // Default rules.
        /*
        insert(".git/");
        insert(".gitignore");
        insert(".npmignore");
        insert(".sm/");
        insert(".rt/");
        insert(".DS_Store");
        insert(".program.json");
        insert(".package.json");
        */
        // NOTE: Be careful when modifying. These are used when exporting a package.
        self._insertIgnoreRule(ignoreRules, ".*", subPath, options);
        //self._insertIgnoreRule(ignoreRules, ".*/");	// Should already be matched by `.*`.
        self._insertIgnoreRule(ignoreRules, "*~backup-*", subPath, options);
        self._insertIgnoreRule(ignoreRules, "/dist/", subPath, options);
        self._insertIgnoreRule(ignoreRules, "program.dev.json", subPath, options);
    }
}

exports.Walker.prototype.walk = function(options, callback) {
	var self = this;

	var traversedSymlink = {};

    function walkTree(ignoreRules, subPath, callback) {
        var list = {};
        var c = 0;
    	try {
    	    // Respect nested ignore files.
	        ignoreRules = API.UTIL.deepCopy(ignoreRules);
		    self._loadIgnoreRules(ignoreRules, subPath, options);
		} catch(err) {
			return callback(err);
		}
        API.FS.readdir(PATH.join(self.rootPath, subPath), function(err, files) {
            if (err) return callback(err);
            if (files.length === 0) {
                return callback(null, list, self.stats);
            }
            function error(err) {
                c = -1;
                return callback(err);
            }
            function done() {
                if (c !== 0) return;
                c = -1;
                return callback(null, list, self.stats);
            }
            files.forEach(function(basename) {
                if (c === -1) return;

                function ignore(type) {
                    function select(ruleGroups, path) {
                        var rules = null;
                        if (ruleGroups[path]) {
                            rules = ruleGroups[path];
                        } else {
                            for (var prefix in ruleGroups) {
                                if (path.substring(0, prefix.length) === prefix) {
                                    rules = ruleGroups[prefix];
                                    break;
                                }
                            }
                        }
                        if (!rules && ruleGroups[""]) {
                            rules = ruleGroups[""];
                        }
                        if (rules) {
                            for (var i=0 ; i<rules.length ; i++) {
                                if (rules[i](path)) {
                                    return true;
                                }
                            }
                            return false;
                        }
                    }
                    if (select(ignoreRules.include, subPath + "/" + basename + ((type === "dir") ? "/" : ""))) {
                        return false;
                    }
                    if (select(ignoreRules.top, subPath + "/" + basename + ((type === "dir") ? "/" : ""))) {
                        return true;
                    }
                    // All deeper nodes.
                    return select(ignoreRules.every, basename + ((type === "dir") ? "/" : ""));
                }

                c += 1;
                API.FS.lstat(PATH.join(self.rootPath, subPath, basename), function(err, stat) {
                    if (err) return error(err);
                    c -= 1;
                    if (stat.isSymbolicLink()) {
                        c += 1;
                        API.FS.readlink(PATH.join(self.rootPath, subPath, basename), function(err, val) {
                            if (err) return error(err);
                            c -= 1;

                            // TODO: Detect circular links.

                            var linkDir = null;
                            try {
                                linkDir = API.FS.realpathSync(PATH.resolve(API.FS.realpathSync(PATH.join(self.rootPath, subPath)), val));
                            } catch(err) {
                                if (err.code === "ENOENT") return done();
                                throw err;
                            }

                            c += 1;
                            API.FS.lstat(linkDir, function(err, linkStat) {
                                if (err) return error(err);
                                c -= 1;

                                self.stats.totalFiles += 1;

                                if (!ignore( linkStat.isDirectory() ? "dir" : "file")) {
                                    list[subPath + "/" + basename] = {
                                        mtime: stat.mtime.getTime(),
                                        dir: linkStat.isDirectory() || false,
                                        symlink: val,
                                        symlinkReal: linkDir
                                    };
                                    if (linkStat.isDirectory()) {
                                    	if (traversedSymlink[linkDir]) {
                                    		return done();
                                    	}
                                    	traversedSymlink[linkDir] = true;
                                        c += 1;
                                        return walkTree(ignoreRules, subPath + "/" + basename, function(err, subList) {
                                            if (err) return error(err);
                                            c -= 1;
                                            for (var key in subList) {
                                                list[key] = subList[key];
                                            }
                                            return done();
                                        });
                                    } else {
                                        return done();
                                    }
                                } else {
                                    self.stats.ignoredFiles += 1;
                                    return done();
                                }
                            });

                        });
                    } else
                    if (stat.isDirectory()) {
                        var walk = false;
                        if (!ignore("dir")) {
                            list[subPath + "/" + basename] = {
                                dir: true,
                                mtime: stat.mtime.getTime()
                            };
                            walk = true;
                        } else {
                            for (var path in ignoreRules.include) {
                                if (path.substring(0, (subPath + "/" + basename).length) === (subPath + "/" + basename)) {
                                    walk = true;
                                    break;
                                }
                            }
                        }
                        if (walk) {
                            c += 1;
                            walkTree(ignoreRules, subPath + "/" + basename, function(err, subList) {
                                if (err) return error(err);
                                c -= 1;
                                for (var key in subList) {
                                    list[key] = subList[key];
                                }
                                done();
                            });
                        }
                    } else
                    if (stat.isFile()) {
                        self.stats.totalFiles += 1;
                        if (!ignore("file")) {
                        	var mtime = stat.mtime.getTime();
                        	self.stats.totalSize += mtime;
                            list[subPath + "/" + basename] = {
                                mtime: mtime,
                                size: stat.size
                            };
                        } else {
                            self.stats.ignoredFiles += 1;
                        }
                    }
                    done();
                });
            });
            done();
        });
    }

    try {
	    self._loadIgnoreRules(self.ignoreRules, "", options);
	} catch(err) {
		return callback(err);
	}

    return walkTree(self.ignoreRules, "", callback);
}
