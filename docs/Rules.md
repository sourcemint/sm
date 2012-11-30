Rules
=====

*How package management should be done.*


Rules for packages
------------------

  * Every package must have a `package.json` file which is termed the *package descriptor*.
  * The *package descriptor* acts as the authoritive source for package meta data.
  * The *package descriptor* is tagged along with the source code for every release.
  * Dependencies may be declared in the *package descriptor* by mapping a *dependency alias* to a *locator*.
  * The *locator* must resolve to a *unique resource identifier* used to download the *dependency*.
  * Dependencies must be referenced in source code by prefixing `<DependencyAlias>/` to ids.
  * Nothing inside the package may relate to the outside without being *aliased* in the *package descriptor*.
  * If applicable a package must compile itself from source to dynamic library via a post-install script.
  * Every package must have its own namespace in every respect.
  * Packages must be versioned according to [semver](http://semver.org/).

See [Package Descriptor](./PackageDescriptor.md) and [Package Environment](./PackageEnvironment.md) for how this is implemented in `sm`.
