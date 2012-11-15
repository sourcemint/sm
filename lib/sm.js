
const SM_CORE = require("./sm-core");


var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new SM(packageRootPath);
	}
	return instances[packageRootPath];
}


var SM = function(packageRootPath) {
	var self = this;

	var core = SM_CORE.for(packageRootPath);

	self.require = function(id) {
		var args = arguments;
		if (args.length === 1) {
			return core.require.call(core.require, args[0]);
		} else
		if (args.length === 2) {
			return core.require.call(core.require, args[0]).then(function() {
				return args[1](null, arguments[0]);
			}, args[1]);
		}
		throw new Error("Too many arguments!");
	}

	return self;
}
