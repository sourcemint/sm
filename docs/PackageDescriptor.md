Package Descriptor
==================

A `sm` compatible package must have a *package descriptor* stored in a `package.json` file at the root of the package.

The following declarations are recognized:

	package.json ~ {
    "uid": "<string>",
		"name": "<string>",
		"version": "<semver>",
		"pm": "<name>",
		"help": {
      "web": "<uri>",
      "cli": "./<path>"
   	},
   	"dependencies": {
      "<depName>": "<pointer>"
    },
		"devDependencied": {},
		"mappings": {},
		"devMappings": {},
		"optionalMappings": {},
    "bin": {
      "<binAlias>": "<path>"
    },
    "scripts": {
      "start-workspace": "<command>",
      "stop-workspace": "<command>",
      "install": "<command>"
    }
	}

The above is loosely based on the following specifications:

  * [CommonJS Packages/1.1 (draft)](http://wiki.commonjs.org/wiki/Packages/1.1)
  * [CommonJS Packages/Mappings/C (proposal)](http://wiki.commonjs.org/wiki/Packages/Mappings/C)

Once a package has a *package descriptor* it may be used via the `sm` [Command Line Tool](./CommandLine.md) or
the `sm` [NodeJS Module](./NodejsModule.md).

See [Package Environment](./PackageEnvironment.md) for what can be achieved with the *package descriptor*.

See [Platforms](./Platforms.md) and [Engines](./Engines.md) for `<platform*>` and `<engine*>` defaults.


Details on properties
=====================

`uid`
-----

  * A url that points to the repository uri for the package excluding any branch, version or revision identification.

`dependencies`
--------------

  * Where `<depName> === <pkgAlias>` and is the name of a package from the `<platformRegistry>` and `<pointer>` a [npm version range](https://npmjs.org/doc/json.html#dependencies).
  * Where packages are installed at `./<platformDepFolder>/<depName>`.
  * Where `<pointer>` is one of [npm version range](https://npmjs.org/doc/json.html#dependencies).

`mappings`
----------

  * Use the official stable (or most stable) distribution channel.
  * Where `<pointer>` is one of:
    * `[<pm>, <uri>, <extra>]` where `<pm>` determines valid values for `<uri>` and `<extra>` may override package descriptor.
    * `<uri>`

`bin`
-----

  * Where `<path>` is linked to `./.sm/bin/<depAlias>-<binAlias>`

`scripts`
---------

  * Where `<command>` may be formatted according to `SM.for("github.com/sourcemint/sm/").require("helpers").makeNodeCommanFromString("<command>")`.
  * For `*-workspace` scripts see [Package Environment](./PackageEnvironment.md).
  * Where `install` is called after all dependencies are resolved and is intended to compile the package.

`help`
------

Used to display help information for a package when user calls `sm help`.

  * `help.cli` is optional.
  * `help.web` is optional.
  * `help: "./<path>"` will be converted to `help: { cli: "./<path>" }`.
  * `help: "<uri>"` will be converted to `help: { web: "<uri>" }`.
  * `help.cli` must point to JS module within package. Module must export `main(API)` where
    `API.TERM.stdout` may be used to write to console.


Notes
=====

  * `$__DIRNAME` is replaced with the absolute realpath to the directory representing the root of the package.

  