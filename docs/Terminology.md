Terminology
===========

The Sourcemint terminology is inspired by and compatible with [CommonJS](http://commonjs.org) and intended to be distinct from, yet inclusive of existing communities.

Context abstractions:

  * **System** - 1+ *Projects* working in harmony form a *System* which is itself a *Project*.
  * **Project** - 1+ *Packages* working in harmony form a *Project* which is itself a *Package*.
  * **Ticket** - A desired change to a *Package*.
  * **Seed** - The meta data that shapes and networks a *System*.
  * **Community** - A group of people working on and using a shared *System*.

Implementation abstractions:

  * **Program** - The *Seed* meta data that declares the *Dependency* tree (`program.json`) and runtime configuration (`program.rt.json`) for a *System*.
  * **Package** - 1+ code files working in harmony form a *Package* with a `package.json` file which may declare *Dependencies* on other *Packages*.
  * **Dependency** - A *Package* used by a more abstract *Package*.
  * **Patch** - An actualized change to a *Package*.
  * **Engine** - The runtime that will execute the code for a *Package* and determines the `<engine*>` defaults.
  * **Platform** - The ecosystem that will 'host' the *Package* and determines the `<platform*>` defaults.

Workflow abstractions:

  * **Switch** - Switch to and activate the workspace for a package.
  * **Init** - Initialize a package by pulling code from a URI.
  * **Status** - Display package status.
  * **Install** - Install package and dependencies.
  * **Update** - Pull offline all remote changes.
  * **Edit** - 
  * **Test** - Run package tests.
  * **Save** - Commit all changes and freeze dependency tree by writing `sm-catalog.json`.
  * **Bump** - 
  * **Publish** - Push online all local changes.
  * **Deploy** - 
  * **Report** - Display detailed report for program (package and dependencies).
