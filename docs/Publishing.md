Publishing
==========

Notes
-----

  * On `sm publish`:
    * If in edit mode, changes to the VCS will be pushed.
    * `publish` script will be called if specified.
    * The pm of the package will be asked to publish, if no `publish` script is specified
      and `package.json ~ publish: true` is set.
