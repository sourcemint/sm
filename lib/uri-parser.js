

var URL = require("url");


var vendors = {};

exports.parse = function(uri) {

    // TODO: Add cache.

    var parsedUri = {};

    if (/^\//.test(uri)) {
        parsedUri.protocol = "file:";
        parsedUri.slashes = true;
        parsedUri.pathname = uri;
    } else {
        parsedUri = URL.parse(uri);
    }

    if (!parsedUri.hostname && parsedUri.protocol !== "file:") {
        if (/^git@/.test(parsedUri.path)) {
            parsedUri.hostname = parsedUri.host = parsedUri.path.match(/git@([^:]*):/)[1];
        }
        else if (/^git:\/\//.test(parsedUri.path)) {
            parsedUri.hostname = parsedUri.host = parsedUri.path.match(/git:\/\/([^\/]*)\//)[1];
        }
        else if (/^.*\.[^\.]*\/.*\/[^\/]*$/.test(parsedUri.path) && !/^[^:\/]*:]\//.test(parsedUri.path)) {
            parsedUri = URL.parse("http://" + uri);
        }
    }

    var vendorInfo = false;

    if (parsedUri.hostname && vendors[parsedUri.hostname]) {
        vendorInfo = vendors[parsedUri.hostname](parsedUri);
    } else
    if (parsedUri.protocol === "file:") {
        vendorInfo = vendors["sourcemint-paths"](parsedUri);
    }
    if (!vendorInfo) {
        vendorInfo = vendors["typical-tar-dist"](parsedUri);
    }
    if (vendorInfo) {
        parsedUri.vendor = vendorInfo;
        parsedUri.locators = parsedUri.vendor.locators;
        delete parsedUri.vendor.locators;
    }

    parsedUri.uris = parsedUri.locators || false;
    // TODO: Deprecate `parsedUri.locators`.

    if (!parsedUri.uris) {
        parsedUri.uris = {};
    }
    if (!parsedUri.uris["original"]) {
        parsedUri.uris["original"] = parsedUri.href;
    }

    return parsedUri;
}

vendors["sourcemint-paths"] = function(parsedUri) {
    var m;
    // `.sourcemint/cache/external/https/github.com/.../.../tarball/0b4ed5f08a32c280a76d0b5f52883d8d1fc0de08`
    if((m = parsedUri.pathname.match(/\/\.sourcemint\/cache\/external\/(.*?)\/([^\/]*)$/))) {
        var info = {};

        // Rename to `repository`.
        info["id"] = "sourcemint-cache-external";
        // Rename to `package`.
        info["repository"] = m[1];
        info["rev"] = m[2];
        info["locators"] = {
            path: parsedUri.pathname
        };

        return info;
    } else
    // `.sourcemint/cache/install/node-v0.6.21-pre/git/github.com/.../.../0b4ed5f08a32c280a76d0b5f52883d8d1fc0de08`
    if((m = parsedUri.pathname.match(/\/\.sourcemint\/cache\/install\/[^\/]*\/(.*?)\/([^\/]*)$/))) {
        var info = {};

        // Rename to `repository`.
        info["id"] = "sourcemint-cache-install";
        // Rename to `package`.
        info["repository"] = m[1];
        info["rev"] = m[2];
        info["locators"] = {
            path: parsedUri.pathname
        };

        return info;
    } else {
        return false;
    }
}

vendors["typical-tar-dist"] = function(parsedUri) {
    var m;
    // `/dist/v0.6.20/node-v0.6.20.tar.gz`
    if((m = parsedUri.pathname.match(/\/dist\/([^\/]*)\/(.*)$/))) {
        var info = {};

        // Rename to `repository`.
        info["id"] = parsedUri.hostname;
        info["rev"] = m[1];
        if (m[2].indexOf("-" + m[1] + ".tar.gz") !== -1) {
            info["repository"] = m[2].replace("-" + m[1] + ".tar.gz", "");
        }
        info["locators"] = {
            tar: parsedUri.href
        };

        return info;
    } else {
        return false;
    }
}

vendors["registry.npmjs.org"] = function(parsedUri) {
    var info = {};
    var m;
    if((m = parsedUri.pathname.match(/^\/([^\/]*)\/-\/(.*)$/))) {

        // Rename to `repository`.
        info["id"] = parsedUri.hostname;
        // Rename to `package`.
        info["repository"] = m[1];
        // Rename to `uris`.
        info["locators"] = {
            "homepage": "https://npmjs.org/package/" + info["repository"]
        };

        if (m[2].substring(0, m[1].length+1) === (m[1] + "-")) {
            if((m = m[2].substring(m[1].length+1).match(/^(.*)\.tgz$/))) {
                info["rev"] = m[1];
            }
        }

        if (info["rev"]) {
            info["locators"]["tar"] = "http://registry.npmjs.org/" + info["repository"] + "/-/" + info["repository"] + "-" + info["rev"] + ".tgz";
        }
    } else {
        throw new Error("Not a valid registry.npmjs.org URL!");
    }
    return info;      
}

vendors["github.com"] = function(parsedUri) {
    var info = {};
    var m;
    if (parsedUri.protocol === "git:") {
        var m = parsedUri.pathname.match(/^\/([^\/]*)\/([^\/]*?)(.git)?$/);
        if (!m) {
            throw new Error("Not a valid github.com public git URL!");
        }
        parsedUri.pathname = "/" + m[1] + "/" + m[2];
        if (parsedUri.hash) {
            if (/^#\//.test(parsedUri.hash)) {
                throw new Error("Not a valid github.com URL '" + parsedUri.href + "'! Hash/branch '" + parsedUri.hash.substring(1) + "' may not begin with '/'!");
            }
            parsedUri.pathname += "/tree/" + parsedUri.hash.substring(1);
        }
    }
    else if (/^git@/.test(parsedUri.pathname)) {
        var m = parsedUri.pathname.match(/^git@([^:]*):([^\/]*)\/([^\/]*).git$/);
        if (!m) {
            throw new Error("Not a valid github.com private git URL!");
        }
        parsedUri.pathname = "/" + m[2] + "/" + m[3];
        if (parsedUri.hash) {
            parsedUri.pathname += "/tree/" + parsedUri.hash.substring(1);
        }
    }
    else if (/^\/(.*?)\.git$/.test(parsedUri.pathname)) {
        var m = parsedUri.pathname.match(/^\/([^\/]*)\/([^\/]*)\.git$/);
        if (!m) {
            throw new Error("Not a valid github.com public git URL!");
        }
        parsedUri.pathname = "/" + m[1] + "/" + m[2] + "/tree/master";
    }
    if((m = parsedUri.pathname.match(/^\/([^\/]*)\/([^\/]*)\/?(?:(?:tarball|zipball|tree|commit|commits|tags)\/(.*?))?\/?(?:\/([^\/]*))?$/))) {
        // Rename to `repository`.
        info["id"] = parsedUri.hostname;
        info["user"] = m[1];
        // Rename to `package`.
        info["repository"] = m[2];
        // Rename to `uris`.
        info["locators"] = {
            "homepage": "https://github.com/" + info["user"] + "/" + info["repository"]
        };
        if (!m[3] && !m[4]) {
            info["rev"] = "master";
        }
        else if (!m[3] && m[4]) {
            info["rev"] = m[4];
        }
        else if (m[3] && !m[4]) {
            info["rev"] = m[3];
        }
        info["locators"]["git-read"] = "git://github.com/" + info["user"] + "/" + info["repository"] + ".git#" + info["rev"];
        info["locators"]["git-write"] = "git@github.com:" + info["user"] + "/" + info["repository"] + ".git#" + info["rev"];
        info["locators"]["zip"] = "https://github.com/" + info["user"] + "/" + info["repository"] + "/zipball/" + info["rev"];
        info["locators"]["tar"] = "https://github.com/" + info["user"] + "/" + info["repository"] + "/tarball/" + info["rev"];
        info["locators"]["raw"] = "https://github.com/" + info["user"] + "/" + info["repository"] + "/tarball/" + info["rev"];
    } else {
        throw new Error("Not a valid github.com URL!");
    }
    return info;      
}
