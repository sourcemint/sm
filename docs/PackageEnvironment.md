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
  * `./bin` and `.sm/bin` on `PATH`.
  * Environment variables:
    * `SM_HOME` path to root directory of toolchain (package with `sm` as dependency typically at `~/.sm`).
    * `SM_WORKSPACE_HOME` path to root of workspace.
    * `PINF_PROGRAM` a local filesystem path to a `program.json` file (how to boot).
    * `PINF_PACKAGE` a local filesystem path to a `package.json` file (what to boot).
    * `PINF_RUNTIME` a local filesystem path to a `program.rt.json` file (the state to boot in).
    * `PINF_MODE` the mode the runtime should run it. Will load `program.$PINF_MODE.json`.

It will also provide a UI environment if the [Package Descriptor](./PackageDescriptor.md) declares the following scripts:

  * `start-workspace` - Called on `sm switch` and intended to start a workspace server & dev UI.
  * `stop-workspace` - Called on `exit` after `sm switch` and intended to stop the workspace server & dev UI.


Package
-------

Defaults:

  * `require("<depAlias>/<moduleId>")` will resolve to `./lib/<moduleId>.<engineExtension>` if `<moduleId>` does not end in `.<engineExtension>`.
  * `require("<depAlias>/<moduleId>.<ext>")` will resolve to `./<moduleId>.<ext>`.
  * `package.json ~ scripts.install = "<command>"` is called after all dependencies are resolved and is intended to compile the package.
  * `.distignore` holds the git like ignore rules to describe the minimal complete featureset of the package needed during runtime.
  * `.rt` holds program state data typically generated after calling `sm run` to run the program.

Recommendations:

  * `.gitignore` should contain:
    * `.sm/`
    * `node_modules/` or `mapped_packages/` depending on platform.

See [Platforms](./Platforms.md) and [Engines](./Engines.md) for `<platform*>` and `<engine*>` defaults and specific details.

For more information about `package.json` see [Package Descriptor](./PackageDescriptor.md).
