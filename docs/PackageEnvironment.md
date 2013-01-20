Package Environment
===================

A package environment is created by the presence of a `package.json` file.

Each package has a *workspace* which is used to make changes to the package.

To run a package see [System](./System.md).


Workspace
---------

To enter a workspace:

	sm switch <uri>

This will provide a console environment with the following features:

  * Colored and named workspace prompt to identify workspace and indicate status (*NYI*).
  * `./bin` on `PATH`.
  * `sm *` shortcuts by promoting `sm` commands to `PATH`. i.e. `status` will call `sm status`. (*NYI*)
  * `SM_WORKSPACE_HOME` environment variable pointing to root of workspace.

It will also provide a UI environment if the [Package Descriptor](./PackageDescriptor.md) declares the following scripts:

  * `start-workspace` - Called on `sm switch` and intended to start a workspace server.
  * `stop-workspace` - Called on `exit` after `sm switch` and intended to stop the workspace server.


Package
-------

Defaults:

  * `require("<depAlias>/<moduleId>")` will resolve to `./lib/<moduleId>.<engineExtension>` if `<moduleId>` does not end in `.<engineExtension>`.
  * `require("<depAlias>/<moduleId>.<ext>")` will resolve to `./<moduleId>.<ext>`.
  * `package.json ~ scripts.install = "<command>"` is called after all dependencies are resolved and is intended to compile the package.
  * `.distignore` holds the git like ignore rules to describe the minimal complete featureset of the package needed during runtime.

See [Platforms](./Platforms.md) and [Engines](./Engines.md) for `<platform*>` and `<engine*>` defaults and specific details.

For more information about `package.json` see [Package Descriptor](./PackageDescriptor.md).
