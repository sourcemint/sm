Seed
====

The meta data and core controlling code that shapes and networks *1+ Systems*.


Toolchain Seed
--------------

A `sm` install, typically located at `~/.sm`, is the *toolchain seed* from which all *systems* and other *seeds* are spawned.

The *toolchain seed* is the starting point for all aspects of a toolchain.

The [Package Descriptor](./PackageDescriptor.md) at `~/.sm/package.json` may declare the following scripts:

  * `start-toolchain` - Called when `sm switch`ing into the toolchain and intended to start a toolchain server.
