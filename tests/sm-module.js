
const PATH = require("path");
const RUN = require("./_run");
const EXPECT = require("chai").expect;
const Q = require("sourcemint-util-js/lib/q");
const SM = require("../lib/sm");


describe("sm-module", function() {

    it('should have `:for()`', function() {
		EXPECT(SM).to.respondTo("for");
    });

    describe(":for()", function() {

	    it('should return object', function() {
	    	var api = SM.for(__dirname, RUN.getBaseOptions());
			EXPECT(api).to.be.an("object");
			EXPECT(api).to.respondTo("require");
	    });

	    describe(":resolve()", function() {

			this.timeout(10 * 1000);

	        it('should fire callback', function(done) {
				SM.for(__dirname, RUN.getBaseOptions()).resolve("package1/module1", function(err, path) {
					if (err) return done(err);
					EXPECT(path).to.be.a("string");
					EXPECT(path).to.be.equal(PATH.join(__dirname, "node_modules/package1/lib/module1.js"));
					return done();
				}).fail(done);
	        });

	        it('should return promise', function(done) {
				SM.for(__dirname, RUN.getBaseOptions()).resolve("package1/module1").then(function(path) {
					EXPECT(path).to.be.a("string");
					EXPECT(path).to.be.equal(PATH.join(__dirname, "node_modules/package1/lib/module1.js"));
					return done();
				}).fail(done);
	        });
	    });

	    describe(":require()", function() {

			this.timeout(10 * 1000);

	        it('should fire callback', function(done) {
				SM.for(__dirname, RUN.getBaseOptions()).require("package1/module1", function(err, api) {
					if (err) return done(err);
					EXPECT(api).to.be.a("object");
					EXPECT(api.id).to.be.a("string");
					EXPECT(api.id).to.be.equal("pkg1-module1");
					return done();
				}).fail(done);
	        });

	        it('should return promise', function(done) {
				SM.for(__dirname, RUN.getBaseOptions()).require("package1/module1").then(function(api) {
					EXPECT(api).to.be.a("object");
					EXPECT(api.id).to.be.a("string");
					EXPECT(api.id).to.be.equal("pkg1-module1");
					return done();
				}).fail(done);
	        });

	        it('should return `err` for undeclared package', function(done) {
				SM.for(__dirname, RUN.getBaseOptions()).require("undeclared/module1", function(err, api) {
					EXPECT(err.message).to.match(/Package not found and not declared!/);
					EXPECT(err.stack).to.be.a("string");
					EXPECT(api).to.eql(undefined);
					return done();
				}).fail(done);
	        });
	    });
    });
});
