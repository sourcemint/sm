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

Workflow abstractions:

  * **Switch** - (`sm switch -r` switches to `sm switch -p remote`)
  * **Clone** - 
  * **Status** - 
  * **Install** - 
  * **Update** - 
  * **Edit** - 
  * **Save** - Commit changes and freeze dependency tree by writing `sm-catalog.json`.
  * **Bump** - 
  * **Publish** - 
  * **Deploy** - 
  * **Report** - 
