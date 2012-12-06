
const RUN = require("./_run");
const EXPECT = require("chai").expect;
const Q = require("sourcemint-util-js/lib/q");
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

			this.timeout(10 * 1000);

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
		    });
	    });
	});    
});
