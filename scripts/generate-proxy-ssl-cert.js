
const PATH = require("path");
const SPAWN = require("child_process").spawn;
const TERM = require("sm-util/lib/term");
const ERROR = require("sm-util/lib/error");


exports.main = function(callback) {

	var privateKeyPath = PATH.join(__dirname, "../config/proxy-ssl-private-key");
	var csrPath = PATH.join(__dirname, "../config/proxy-ssl.csr");
	var certificatePath = PATH.join(__dirname, "../config/proxy-ssl.crt");

	function ensurePrivateKey(callback) {
		if (PATH.existsSync(privateKeyPath)) return callback(null);
		call("/usr/bin/ssh-keygen", [
			"-t", "rsa",
			"-f", privateKeyPath
		], {}, callback);
	}

	function ensureCsr(callback) {
		if (PATH.existsSync(csrPath)) return callback(null);
		call("/usr/bin/openssl", [
			"req",
			"-new",
			"-key", privateKeyPath,
			"-out", csrPath
		], {}, callback);
		// TODO: Auto-fill info.
	}

	function ensureCertificate(callback) {
		if (PATH.existsSync(certificatePath)) return callback(null);
		call("/usr/bin/openssl", [
			"x509",
			"-req",
			"-days", "" + 365*10,	// 10 years.
			"-in", csrPath,
			"-signkey", privateKeyPath,
			"-out", certificatePath
		], {}, callback);
	}

	return ensurePrivateKey(function(err) {
		if (err) return callback(err);

		return ensureCsr(function(err) {
			if (err) return callback(err);

			return ensureCertificate(function(err) {
				if (err) return callback(err);

				return callback(null);
			});
		});
	});
}


// TODO: Relocate to `sm-util/lib/os`.
function call(command, args, options, callback) {
	options.cwd = options.cwd || __dirname;
	options.stdio = "inherit";    // NodeJS 0.8+	
    var proc = SPAWN(command, args, options);
    proc.on("error", function(err) {
    	return callback(err);
    });
    proc.on("exit", function(code) {
    	return callback(null);
    });
    // NodeJS 0.6
    if (/^v0\.6\./.test(process.version)) {
        TERM.stdout.writenl("\0orange([sm] NOTE: For best results use NodeJS 0.8!\0)");
        proc.stdout.on("data", function(data) {
            process.stdout.write(data);
        });
        proc.stderr.on("data", function(data) {
            process.stderr.write(data);
        });
        process.stdin.resume();
        process.stdin.on("data", function (chunk) {
            // TODO: For some reason this input gets printed to process.stdout after hitting return.
            proc.stdin.write(chunk);
        });
    }
}


if (require.main === module) {
	exports.main(function(err) {
		if (err) return ERROR.exitProcessWithError(err);
		process.exit(1);
	});
}
