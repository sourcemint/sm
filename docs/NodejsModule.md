NodeJS Module
=============

The [NodeJS](http://nodejs.org/) `sm` module is installed via [npm](http://npmjs.org):

	npm install -g sm


It can be used to
=================

Resolve dependencies dynamically
--------------------------------

	require("sm").for("<packageRoot>").require("<alias>/<moduleId>").then(function(api) {
		// Use `api`.
	}, function(err) {
		// Error while making dependency available.
	});

This will resolve, dowload and install the *dependency* referenced via `<alias>/<moduleId>` as long as:

  * The [Package Descriptor](./PackageDescriptor.md) at `<packageRoot>/package.json` allows for this dynamic install
    by declaring the `<alias>` in `optionalMappings`.
