
const PATH = require("path");


exports.uriToPath = function(uri) {
	return uri.replace(/[:@#]/g, "/").replace(/[\?&=]/g, "+").replace(/\/+/g, "/");
}

exports.ttlForOptions = function(options, ttl) {
	if (options.now) return options.time * -1;
	if (typeof ttl !== "undefined") {
		if (ttl === "today") {
			var timeNow = new Date();
			return new Date(timeNow.getFullYear(), timeNow.getMonth(), timeNow.getDate()).getTime() * -1;
		}
		return ttl;
	}
	return (7 * 24 * 60 * 60 * 1000);	// 7 Days
}

exports.isMtimeExpired = function(mtime, options) {
	var ttl = exports.ttlForOptions(options);
    if (ttl >= -1) {
        // If `ttl === -1` then force cache refresh.
        // If `ttl === 0` then cache indefinite.
        // If `ttl >= 1` then cache for ttl (milliseconds).
        if (mtime && ttl != -1 && (ttl === 0 || ((mtime + ttl) > Math.floor(Date.now()/1000)))) {
            return false;
        }
    } else
    if (ttl < -1) {
        if (mtime >= ttl*-1) {
            return false;
        }
    }
	return true;
}

exports.getInternalConfigPath = function() {
    return PATH.join(__dirname, "../config");
}
