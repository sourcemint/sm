Platforms
=========

The base that will 'host' the *Package*.

The following `<platformName>`s are supported.


`node`
------

  * Homepage: [nodejs.org](http://nodejs.org)
  * `<platformEngine> = "node"`
  * `<platformRegistry> = "registry.npmjs.org"`
  * `<platformDepFolder> = "node_modules"`  
  * Commands from `./node_modules/.bin/<binAlias>` are linked to `./.sm/bin/<depAlias>-<binAlias>` unless `<depAlias> === <binAlias>` in which case they are linked to `./.sm/bin/<depAlias>`.
