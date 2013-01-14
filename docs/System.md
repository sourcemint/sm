System
======

To run a package, turn it into a system, by adding a `program.json` file next to the `package.json` file.


program.json
------------

  * Holds the configuration information to boot the development environment for the package which is typically the workspace launched on `sm switch`. See [Package Environment](./PackageEnvironment.md).
  * `config["<uid>"]` sets values for the `<uid>` namespace for all packages.
  * `config["<depAlias>"]` sets values for the `<depAlias>` package.
  * `config["<depAlias>"]["<uid|depAlias>"]` sets values for the `<uid|depAlias>` namespace for the `<depAlias>` package.
  * May not affect source changes (by postinstall script or otherwise) to the package tree. i.e. the same source tree must be usable by multiple different `program.json` files. If customized code must be genrated it must be done in memory at runtime or via a namespaced cache that isolates effects of different `program.json` files.
