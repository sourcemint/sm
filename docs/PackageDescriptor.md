Package Descriptor
==================

A `sm` compatible package must have a *package descriptor* stored in a `package.json` file at the root of the package.

The following declarations are recognized:

	package.json ~ {
		"name": "<string>",
		"version": "<semver>",
		"pm": "<name>",
		"help": {
            "web": "<uri>",
            "cli": "./<path>"
   		},
   		"dependencies": {},
		"devDependencied": {},
		"mappings": {},
		"devMappings": {},
		"optionalMappings": {}
	}

The above is loosely based on the following specifications:

  * [CommonJS Packages/1.1 (draft)](http://wiki.commonjs.org/wiki/Packages/1.1)
  * [CommonJS Packages/Mappings/C (proposal)](http://wiki.commonjs.org/wiki/Packages/Mappings/C)

Once a package has a *package descriptor* it can be maintained via the `sm` [Command Line Tool]([./CommandLine.md]) or
the `sm` [NodeJS Module](./NodejsModule.md).


Details on properties
=====================

`help`
------

  * `help.cli` is optional.
  * `help.web` is optional.
  * `help: "./<path>"` will be converted to `help: { cli: "./<path>" }`.
  * `help: "<uri>"` will be converted to `help: { web: "<uri>" }`.
  * `help.cli` must point to JS module within package. Module must export `main(API)` where
    `API.TERM.stdout` may be used to write to console.
