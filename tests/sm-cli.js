
const PATH = require("path");
const RUN = require("./_run");
const EXPECT = require("chai").expect;
const Q = require("sm-util/lib/q");
const OS = require("sm-util/lib/os");
const SM_CLI = require("../lib/sm-cli")


describe("sm-cli", function() {

    it('should have `:for()`', function() {
		EXPECT(SM_CLI).to.respondTo("for");
    });

    describe(":for()", function() {

	    it('should return object', function() {
	    	var api = SM_CLI.for(__dirname);
			EXPECT(api).to.be.an("object");
			EXPECT(api).to.respondTo("respond");
	    });

		describe(":respond()", function() {

			this.timeout(30 * 1000);

			function callCli(args, projectRootPath) {
				var options = RUN.getBaseOptions();
				if (options.debug) args.push("--debug");
				if (options.verbose) args.push("--verbose");
				return SM_CLI.for(projectRootPath || __dirname).respond(["", ""].concat(args));
			}

	        it("should return promise for command-line api call result if passed `process.args` like array", function(done) {
	        	var result = callCli([
					"--format", "JSON",
	        		"status"
				]);
				EXPECT(result).to.satisfy(function(result) { return Q.isPromise(result); });
				return result.then(function() {
					return done();
				}, done);
	        });

			describe("with args:", function() {

		        it("`--format JSON status` should return status tree", function(done) {
		        	return callCli([
						"--format", "JSON",
		        		"status"
					]).then(function(result) {
						EXPECT(result).to.be.a("object");
						EXPECT(result.name).to.equal("sm-tests");
						EXPECT(result.status).to.be.a("object");
						return done();
					}).fail(done);
		        });
/*
		        it("`status --format JSON` should return fast on large tree", function(done) {
					this.timeout(10 * 1000);
		        	return callCli([
		        		"status",
						"--format", "JSON"
					// TODO: `sm install` this package and then run test.
					], "/pinf/workspaces/github.com/ajaxorg/cloud9").then(function(result) {
						// console.log(result.toString());
						return done();
					}).fail(done);
		        });
*/

		        it("`--format JSON status --dir ./tests` should return status tree for `tests` dir", function(done) {
		        	return callCli([
						"--format", "JSON",
		        		"status",
		        		"--dir", __dirname
					], PATH.join(__dirname, "..")).then(function(result) {
						EXPECT(result).to.be.a("object");
						EXPECT(result.name).to.equal("sm-tests");
						EXPECT(result.status).to.be.a("object");
						return done();
					}).fail(done);
		        });

		        it("`--format JSON info chai` should return info for package", function(done) {
		        	return callCli([
						"--format", "JSON",
		        		"info",
		        		"chai"
					]).then(function(result) {
						EXPECT(result).to.be.a("array");
						EXPECT(result).to.have.length(1);
						EXPECT(result[0].name).to.equal("chai");
						return done();
					}).fail(done);
		        });

		        it("`init --delete https://github.com/sourcemint/test-package2` should download package in read mode and install dependencies", function(done) {
		        	return callCli([
						"init",
						"--cache",
						"--dir", PATH.join(__dirname, "tmp/sm-cli-clone-1"),
						"--delete",
						"https://github.com/sourcemint/test-package2"
					]).then(function(result) {
						EXPECT(PATH.existsSync(PATH.join(__dirname, "tmp/sm-cli-clone-1/.git"))).to.equal(false);
						require(PATH.join(__dirname, "tmp/sm-cli-clone-1/test.js")).main(function(err) {
							EXPECT(err).to.equal(null);
							return done();
						});
					}).fail(done);
		        });

		        it("`init --dev --delete https://github.com/sourcemint/test-package2` should download package in write mode and install dependencies", function(done) {
		        	return callCli([
						"init",
						"--dev",
						"--cache",
						"--dir", PATH.join(__dirname, "tmp/sm-cli-clone-2"),
						"--delete",
						"https://github.com/sourcemint/test-package2"
					]).then(function(result) {
						EXPECT(PATH.existsSync(PATH.join(__dirname, "tmp/sm-cli-clone-2/.git"))).to.equal(true);
						require(PATH.join(__dirname, "tmp/sm-cli-clone-1/test.js")).main(function(err) {
							EXPECT(err).to.equal(null);
							return done();
						});
					}).fail(done);
		        });

		        it("`switch --[start|stop]-workspace` should start|stop workspace", function(done) {
		        	return callCli([
						"init",
						"--cache",
						"--dir", PATH.join(__dirname, "tmp/sm-cli-clone-3"),
						"--delete",
						"https://github.com/sourcemint/test-package2"
					]).then(function(result) {
						return OS.exec("sm switch --start-workspace --dir " + PATH.join(__dirname, "tmp/sm-cli-clone-3")).then(function(stdout) {
							EXPECT(stdout).to.equal("start workspace\n");
								return OS.exec("sm switch --stop-workspace --dir " + PATH.join(__dirname, "tmp/sm-cli-clone-3")).then(function(stdout) {
								EXPECT(stdout).to.equal("stop workspace\n");
								return done();
							});
						});
					}).fail(done);
		        });

		        it("`run` should call 'run' script", function(done) {
		        	return callCli([
						"run",
						"--dir", PATH.join(__dirname, "tmp/sm-cli-clone-3")
					]).then(function(result) {
						EXPECT(result).to.be.a("object");
						EXPECT(result.stdout).to.be.a("string");
						EXPECT(result.stdout).to.equal(".\n");
						EXPECT(result.stderr).to.be.a("string");
						EXPECT(result.stderr).to.equal("");
						return done();
					}).fail(done);
		        });
		    });
	    });
	});    
});
