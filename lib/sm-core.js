
const Q = require("sourcemint-util-js/lib/q");
const PLUGIN = require("sm-plugin");
const SCANNER = require("./scanner");
const STATUS = require("./status");


var instances = {};

exports.for = function(packageRootPath) {
	if (!instances[packageRootPath]) {
		instances[packageRootPath] = new SMCore(packageRootPath);
	}
	return instances[packageRootPath];
}


var SMCore = function(packageRootPath) {
	var self = this;

	var scanner = SCANNER.for(packageRootPath);
	// TODO: Do this via an event so we can have multiple listeners.
	scanner.onNewNode = function(node) {
		node.getPlugin = function(pluginName) {
			return self.getPlugin(node, pluginName);
		}
	}
	var status = STATUS.for(packageRootPath);

	self.getPlugin = PLUGIN.for;

	self.require = function(uri) {

//console.log("REQUIRE", uri);

		return Q.resolve({
			id: "module1"
		});

		return Q.ref();
	}

	self.status = function(options) {
		return scanner.fsTree(options).then(function(tree) {
			if (options.loadStatus === false) {
				return tree;
			}
			return status.embellishFsTree(tree, options).then(function() {
				return tree;
			});
		});
	}

	return self;
}
