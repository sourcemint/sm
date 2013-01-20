Versioning
==========

Versioning of packages is compatible with [semver](http://semver.org/).

Notes
-----

  * If package version follows format `1.2.3`, `3` will be bumped on `sm bump [--patch]`.
  * If package version follows format `1.2.3-pre-4` (pre-release tag), `4` will be bumped on `sm bump [--patch]`.
  * If package version has pre-release tag the tag will be used to tag the release on registries where possible.
