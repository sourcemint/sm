
const PATH = require("path");
const MD5 = require("sm-util/lib/md5").md5;


exports.uriToPath = function(uri) {
	var uri = uri.replace(/[:@#]/g, "/").replace(/[\?&=]/g, "+").replace(/\/+/g, "/").replace(/\/$/, "+");
    uri = uri.split("/").map(function(segment) {
        if (segment.length > 256) {
            // TODO: Use a faster hashing algorythm?
            segment = MD5(segment);
        }
        return segment;
    }).join("/");
    return uri;
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

// `node test` -> `node test`
// `node test.js` -> `node test.js`
// `test.js` -> `node test.js`
// `test` -> `test`
// `sm run --module dev/workspace.js -- --start` -> `sm run --module dev/workspace.js -- --start`
// TODO: Support `./workspace.js --start` -> `node ./workspace.js --start`
exports.makeNodeCommanFromString = function(command) {
    if (/^node\s|\.js$/.test(command)) return command;
    if (/\.js$/.test(command)) command = "node " + command;
    return command;
}
