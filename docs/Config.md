
<div class="row">

  <p align="center" class="lead">Build Systems by using components from the following supported communities.<br/>Introduction: <a target="_blank" href="">Video</a> &nbsp;&nbsp; Discuss: <a target="_blank" href="https://groups.google.com/group/sourcemint">groups.google.com/group/sourcemint</a></p>

  <div class="span6">

    <h3>Repositories</h3>

    <p>Repositories provide versioned persistence for packages.</p>

    <code>package.json ~ repository: "uri"</code>
    <br/><br/>

    <div class="well well-project">
      <code>sm try sm/<a target="_blank" href="https://github.com/sourcemint/sm-plugin-github">sm-plugin-github</a></code>
      <h1><a target="_blank" href="http://github.com">github</a> repositories</h1>
      <p><code>uri: "https://github.com/user/repository.git"</code></p>
    </div>

    <h3>Platforms</h3>

    <p>Platforms provide boundaries within which a system may be built.</p>

    <code>program.json ~ platform: "uri"</code>
    <br/><br/>

    <div class="well well-project">
      <code>sm try fp/<a target="_blank" href="https://github.com/freedom-platform/dev">dev</a></code>
      <h1><a target="_blank" href="http://freedom-platform.org">Freedom Platform</a> ~ the root Platform for Sourcemint.</h1>
      <p>Goal: Enable development of any type of web application System.</p>
      <p><code>uri: "https://github.com/freedom-platform/dev"</code></p>
    </div>

    <h3>Engines</h3>

    <p>Engines provide the execution environment for a program.</p>

    <code>program.json ~ engine: "alias"</code>
    <br/><br/>

    <div class="well well-project">
      <code>sm try sm/<a target="_blank" href="https://github.com/sourcemint/sm-plugin-node">sm-plugin-node</a></code>
      <h1><a target="_blank" href="http://nodejs.org">nodejs</a> programs</h1>
      <p><code>alias: "node"</code></p>
    </div>

  </div>

  <div class="span6">

    <h3>Resolvers</h3>

    <p>Resolvers map a uri dependency to a package download url.</p>

    <code>package.json ~ mappings["depAlias"] = ["resolver", "uri"]</code>
    <br/><br/>

    <div class="well well-project">
      <code>sm try sm/<a target="_blank" href="https://github.com/sourcemint/sm-plugin-npm">sm-plugin-npm</a></code>
      <h1><a target="_blank" href="http://npmjs.org">npm</a> dependencies</h1>
      <p><code>resolver: "npm", "uri": "name"</code></p>
    </div>

    <h3>Installers</h3>

    <p>Installers do the work of installing dependencies.</p>

    <code>package.json ~ installer: "alias"</code>
    <br/><br/>

    <div class="well well-project">
      <code>sm try sm/<a target="_blank" href="https://github.com/sourcemint/sm-plugin-npm">sm-plugin-npm</a></code>
      <h1><a target="_blank" href="http://npmjs.org">npm</a> packages</h1>
      <p><code>alias: "npm"</code></p>
    </div>

  </div>

</div>
