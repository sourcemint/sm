
const EXPECT = require("chai").expect;
const Q = require("sm-util/lib/q");
const SCANNER = require("../lib/scanner");


describe("scanner", function() {

    it('should have `:for()`', function() {
		EXPECT(SCANNER).to.respondTo("for");
    });

    describe(":for()", function() {

	    it('should return object', function() {
	    	var api = SCANNER.for(__dirname);
			EXPECT(api).to.be.an("object");
			EXPECT(api).to.respondTo("fsTree");
	    });

	    describe(".fsTree()", function() {

	        it("should return promise", function(done) {
	        	var api = SCANNER.for(__dirname).fsTree();
				EXPECT(api).to.satisfy(function(api) { return Q.isPromise(api); });
				Q.when(api, function(tree) {
					EXPECT(tree).to.be.a("object");
					EXPECT(tree.name).to.equal("sm-tests");
					EXPECT(tree.parent).to.be.null;
					EXPECT(tree.dir).to.equal("node_modules");
					EXPECT(tree.level).to.equal(0);
					EXPECT(tree.relpath).to.equal("");
					EXPECT(tree.path).to.equal(__dirname);
					EXPECT(tree.exists).to.be.true;
					EXPECT(tree.symlinked).to.be.false;
					EXPECT(tree.circular).to.be.false;
					return done();
				}).fail(done);
	        });

/*
	        it("should return promise fast on large tree", function(done) {
				this.timeout(10 * 1000);
				// TODO: `sm install` this package and then run test.
				Q.when(SCANNER.for("/pinf/workspaces/github.com/ajaxorg/cloud9").fsTree(), function(tree) {
					console.log(tree.toString());
					return done();
				}).fail(done);
	        });
*/

	        it("with option `select: \".\"` should return array containing the 'sm-tests' package", function(done) {
	        	var api = SCANNER.for(__dirname).fsTree({
	        		select: "."
	        	});
				Q.when(api, function(packages) {					
					EXPECT(packages).to.be.a("array");
					EXPECT(packages).to.have.length(1);
					EXPECT(packages[0].name).to.equal("sm-tests");
					return done();
				}).fail(done);
	        });

	        it("with option `select: \"package1\"` should return array containing the 'package1' package", function(done) {
	        	var api = SCANNER.for(__dirname).fsTree({
	        		select: "package1"
	        	});
				Q.when(api, function(packages) {					
					EXPECT(packages).to.be.a("array");
					EXPECT(packages).to.have.length(1);
					EXPECT(packages[0].name).to.equal("package1");
					return done();
				}).fail(done);
	        });

	        it("with option `select: \"node_modules/package1\"` should return array containing the 'package1' package", function(done) {
	        	var api = SCANNER.for(__dirname).fsTree({
	        		select: "node_modules/package1"
	        	});
				Q.when(api, function(packages) {					
					EXPECT(packages).to.be.a("array");
					EXPECT(packages).to.have.length(1);
					EXPECT(packages[0].name).to.equal("package1");
					return done();
				}).fail(done);
	        });
	    });
	});
});
