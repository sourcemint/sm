
const EXPECT = require("chai").expect;
const Q = require("sourcemint-util-js/lib/q");
const SM = require("../lib/sm");


describe("sm-module", function() {

    it('should have `:for()`', function() {
		EXPECT(SM).to.respondTo("for");
    });

    describe(":for()", function() {

	    it('should return object', function() {
	    	var api = SM.for(__dirname);
			EXPECT(api).to.be.an("object");
			EXPECT(api).to.respondTo("require");
	    });

	    describe(":require()", function() {

	        it('should fire callback', function(done) {
				SM.for(__dirname).require("package1/lib/module1", function(err, api) {
					if (err) return done(err);
					EXPECT(api).to.be.a("object");
					EXPECT(api.id).to.be.a("string");
					EXPECT(api.id).to.be.equal("module1");
					return done();
				}).fail(done);
	        });

	        it('should return promise', function(done) {
				SM.for(__dirname).require("package1/lib/module1").then(function(api) {
					EXPECT(api).to.be.a("object");
					EXPECT(api.id).to.be.a("string");
					EXPECT(api.id).to.be.equal("module1");
					return done();
				}).fail(done);
	        });
	    });
    });
});
