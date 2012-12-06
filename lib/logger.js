
const WINSTON = require("winston");


exports.forOptions = function(options) {

	var config = {};
	if (options.debug) {
		config.level = "silly";
	} else
	if (options.verbose) {
		config.level = "info";
	} else {
		config.silent = true;
	}

	var logger = new WINSTON.Logger({
		console: {
	        colorize: "true"
	    },
	    transports: [
	        new WINSTON.transports.Console(config)
	    ]
	});

	return logger;
}
