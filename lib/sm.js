
const SM_CORE = require("./sm-core");
const UTIL = require("sourcemint-util-js/lib/util");
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
	    	now: false
	    };
	    if (extra) {
	    	UTIL.update(opts, extra);
	    }
	    if (!opts.logger) {
	    	opts.logger = LOGGER.forOptions(opts);
	    }
	    return opts;
	}

	self.require = function(id) {
		if (arguments.length === 1) {
			return core.require.call(core.require, id, makeOptions(options));
		} else
		if (arguments.length === 2) {
			var callback = arguments[1];
			return core.require.call(core.require, id, makeOptions(options)).then(function(inst) {
				return callback(null, inst);
			}, callback);
		}
		throw new Error("Too many arguments!");
	}

	return self;
}
