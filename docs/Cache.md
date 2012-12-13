Cache
=====

`sm` caches various data to speed up subsequent calls:

  * `~/.sm/cache/external/<pathuri>` - Proxy like cache for external URIs.
  * `~/.sm/cache/install/<pathuri>` - Install cache for engine-agnostic dependencies.
  * `~/.sm/cache/install/<engineName>-<engineVersion>/<pathuri>` - Install cache for engine-specific dependencies.
  * `~/.sm/cache/latest/<pathuri>` - Proxy like cache for latest summary data.
  * `<pkgPath>.sm/.*` - Package specific cache files.

Any of these may be deleted and will be re-generated on next use.
