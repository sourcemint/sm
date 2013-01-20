Terminology
===========

The Sourcemint terminology is inspired by and compatible with [CommonJS](http://commonjs.org) and intended to be distinct from, yet inclusive of existing communities.

Context abstractions:

  * **System** - Embodies the idea and orchestrates *1+ Projects* into a *System* to realize the idea.
  * **Project** - 1+ *Packages* working in harmony form a *Project* which is itself a *Package*.
  * **Service** - A service that can be consumed and controlled via an API.
  * **Ticket** - A desired change to a *Package*.
  * **Seed** - The meta data and core controlling code that shapes and networks *1+ System*.
  * **Profile** - Holds the credentials used by a *System*.
  * **Development** - The project development environment.
  * **Release** - The project release environment.
  * **Community** - A group of people working on and using a shared *System*.

Implementation abstractions:

  * **Program** - The *Seed* meta data that declares the *Dependency* tree (`program.json`) and runtime configuration (`program.rt.json`) for a *System*.
  * **Package** - 1+ code files working in harmony form a *Package* with a `package.json` file which may declare *Dependencies* on other *Packages*.
  * **Dependency** - A *Package* used by a more abstract *Package*.
  * **Patch** - An actualized change to a *Package*.
  * **Engine** - The runtime that will execute the code for a *Package* and determines the `<engine*>` defaults.
  * **Platform** - The ecosystem that will 'host' the *Package* and determines the `<platform*>` defaults.

Workflow abstractions:

  * **Try** - Quickly install and switch to the package to try it out.
  * **Switch** - Switch to and activate the workspace for a package.
  * **Init** - Initialize a package by pulling code from a URI.
  * **Status** - Display package status.
  * **Install** - Install package and dependencies.
  * **Run** - Run the project.
  * **Update** - Pull offline all remote changes.
  * **Edit** - 
  * **Test** - Run package tests.
  * **Save** - Commit all changes and freeze dependency tree by writing `sm-catalog.json`.
  * **Bump** - Increment package version.
  * **Publish** - Push online all local changes.
  * **Export** - Copy all source code and resolve external links to create standalone package.
  * **Build** - 
  * **Deploy** - 
  * **Report** - Display detailed report for program (package and dependencies).
