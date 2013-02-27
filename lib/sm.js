
const SM_CORE = require("./sm-core");
const UTIL = require("sm-util/lib/util");
const LOGGER = require("./logger");


exports.for = function(packageRootPath, options) {
	return new SM(packageRootPath, options);
}


var SM = function(packageRootPath, options) {
	var self = this;

	options = options || {};

	var core = SM_CORE.for(packageRootPath);

	function makeOptions(extra) {
	    var opts = {
	    	verbose: false,
	    	debug: false,
	    	time: Math.floor(Date.now()/1000),
	    	now: false,
			getConfig: core.getConfig,
			setConfig: core.setConfig
	    };
	    if (extra) {
	    	UTIL.update(opts, extra);
	    }
	    if (!opts.logger) {
	    	opts.logger = LOGGER.forOptions(opts);
	    }
	    return opts;
	}

	var ready = core.__init(makeOptions(options));

	self.resolve = function(id) {
		var args = arguments;
		return ready.then(function() {
			if (args.length === 1) {
				return core.resolve.call(core, id, makeOptions(options));
			} else
			if (args.length === 2) {
				var callback = args[1];
				return core.resolve.call(core, id, makeOptions(options)).then(function(inst) {
					return callback(null, inst);
				}, callback);
			}
			throw new Error("Too many arguments!");
		});
	}

	self.require = function(id) {
		var args = arguments;
		return ready.then(function() {
			if (args.length === 1) {
				return core.require.call(core, id, makeOptions(options));
			} else
			if (args.length === 2) {
				var callback = args[1];
				return core.require.call(core, id, makeOptions(options)).then(function(inst) {
					return callback(null, inst);
				}, callback);
			}
			throw new Error("Too many arguments!");
		});
	}

	self.status = function(id) {
		var args = arguments;
		return ready.then(function() {
			var opts = UTIL.copy(options);
			opts.format = "JSON";
			if (args.length === 1) {
				return core.status.call(core, id, makeOptions(opts));
			} else
			if (args.length === 2) {
				var callback = args[1];
				return core.status.call(core, id, makeOptions(opts)).then(function(inst) {
					return callback(null, inst);
				}, callback);
			}
			throw new Error("Too many arguments!");
		});
	}

	self.export = function(path, localOptions) {
		var args = arguments;
		return ready.then(function() {
			var opts = UTIL.copy(options);
			opts = UTIL.deepMerge(opts, localOptions || {});
			if (args.length === 1 || (args.length === 2 && typeof args[1] !== "function")) {
				return core.export.call(core, path, makeOptions(opts));
			} else
			if (args.length === 3 || (args.length === 2 && typeof args[1] === "function")) {
				var callback = args[args.length-1];
				return core.export.call(core, path, makeOptions(opts)).then(function(inst) {
					return callback(null, inst);
				}, callback);
			}
			throw new Error("Too many arguments!");
		});
	}

	self.run = function() {
		var args = arguments;
		return ready.then(function() {
			var opts = UTIL.copy(options);
			if (args.length === 0) {
				return core.run.call(core, makeOptions(opts));
			} else
			if (args.length === 1) {
				var callback = args[0];
				return core.run.call(core, makeOptions(opts)).then(function(inst) {
					return callback(null, inst);
				}, callback);
			}
			throw new Error("Too many arguments!");
		});
	}

	self.getCredentials = function() {
		var args = arguments;
		return ready.then(function() {
			return core.getCredentials.apply(core, args);
		});
	}

	return self;
}
