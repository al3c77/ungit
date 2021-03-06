const browserify = require('browserify');
const childProcess = require('child_process');
const cliColor = require('ansi-color');
const electronPackager = require('electron-packager');
const path = require('path');
const pkgVersions = require('pkg-versions');
const semver = require('semver');
const fs = require('fs');

module.exports = (grunt) => {
  const packageJson = grunt.file.readJSON('package.json');
  const lessFiles = {
    'public/css/styles.css': ['public/less/styles.less'],
  };
  fs.readdirSync('./components')
    .map((component) => `components/${component}/${component}`)
    .forEach((str) => (lessFiles[`${str}.css`] = `${str}.less`));

  grunt.initConfig({
    pkg: packageJson,
    less: {
      production: { files: lessFiles },
    },
    watch: {
      scripts: {
        files: ['public/source/**/*.js', 'source/**/*.js', 'components/**/*.js'],
        tasks: ['browserify-common', 'browserify-components'],
        options: {
          spawn: false,
        },
      },
      less: {
        files: ['public/less/*.less', 'public/styles/*.less', 'components/**/*.less'],
        tasks: ['less:production'],
        options: {
          spawn: false,
        },
      },
    },
    release: {
      options: {
        commitMessage: 'Release <%= version %>',
      },
    },
    // Run mocha tests
    mochaTest: {
      unit: {
        options: {
          reporter: 'spec',
          require: './source/utils/winston.js',
          timeout: 5000,
        },
        src: 'test/*.js',
      },
      click: {
        options: {
          reporter: 'spec',
          require: './source/utils/winston.js',
          timeout: 35000,
          bail: true,
        },
        src: 'clicktests/spec.*.js',
      },
    },

    jshint: {
      options: {
        undef: true, // check for usage of undefined constiables
        indent: 2,
        esversion: 6,
        laxbreak: true,
        '-W033': true, // ignore Missing semicolon
        '-W041': true, // ignore Use '===' to compare with '0'
        '-W065': true, // ignore Missing radix parameter
        '-W069': true, // ignore ['HEAD'] is better written in dot notation
      },
      web: {
        options: {
          node: true,
          browser: true,
          globals: {
            ungit: true,
            io: true,
            Raven: true,
            $: true,
            jQuery: true,
            nprogress: true,
          },
        },
        files: [
          {
            src: ['public/source/**/*.js', 'components/**/*.js'],
            // Filter out the "compiled" components files; see the browserify task for components
            filter: (src) => src.indexOf('bundle.js') == -1,
          },
        ],
      },
      node: {
        options: {
          node: true,
        },
        src: ['source/**/*.js'],
      },
      bin: {
        options: {
          node: true,
        },
        src: ['Gruntfile.js', 'bin/*'],
      },
      mocha: {
        options: {
          esversion: 8,
          node: true,
          globals: {
            it: true,
            describe: true,
            before: true,
            after: true,
            window: true,
            document: true,
            navigator: true,
            ungit: true,
          },
        },
        src: ['test/**/*.js', 'clicktests/**/*.js'],
      },
    },
    copy: {
      main: {
        files: [
          // includes files within path
          {
            expand: true,
            flatten: true,
            src: ['node_modules/raven-js/dist/raven.min.js'],
            dest: 'public/js/',
          },
          {
            expand: true,
            flatten: true,
            src: ['node_modules/raven-js/dist/raven.min.js.map'],
            dest: 'public/js/',
          },
        ],
      },
    },
    clean: {
      electron: ['./build'],
      coverage: ['./coverage'],
      'coverage-unit': ['./coverage/coverage-unit'],
    },
    electron: {
      package: {
        options: {
          dir: '.',
          out: './build',
          icon: './public/images/icon',
          all: true,
          asar: true,
        },
      },
    },
    zip_directories: {
      electron: {
        files: [
          {
            filter: 'isDirectory',
            expand: true,
            cwd: './build',
            dest: './dist',
            src: '*',
          },
        ],
      },
    },
    mocha_istanbul: {
      unit: {
        src: './test',
        options: {
          coverageFolder: './coverage/coverage-unit',
          mask: 'spec.*.js',
        },
      },
    },
  });

  grunt.registerTask(
    'checkPrettier',
    'Verify that all files are correctly formatted.',
    function () {
      const done = this.async();
      childProcess.exec('npx prettier -l . bin/*', (err, stdout, stderr) => {
        const files = stdout.trim();
        if (files) {
          return done(
            new Error(
              `Files with incorrect formatting (run "npm run format" and consider a Prettier plugin for your editor):\n${files}\n`
            )
          );
        }
        if (err) {
          console.error(stderr);
          return done(err);
        }
        done();
      });
    }
  );

  grunt.registerTask('browserify-common', '', function () {
    const done = this.async();
    const b = browserify('./public/source/main.js', {
      noParse: ['dnd-page-scroll', 'jquery', 'knockout'],
      debug: true,
    });
    b.require('./public/source/components.js', { expose: 'ungit-components' });
    b.require('./public/source/main.js', { expose: 'ungit-main' });
    b.require('./public/source/navigation.js', { expose: 'ungit-navigation' });
    b.require('./public/source/program-events.js', { expose: 'ungit-program-events' });
    b.require('./public/source/storage.js', { expose: 'ungit-storage' });
    b.require('./source/address-parser.js', { expose: 'ungit-address-parser' });
    b.require('bluebird', { expose: 'bluebird' });
    b.require('blueimp-md5', { expose: 'blueimp-md5' });
    b.require('diff2html', { expose: 'diff2html' });
    b.require('jquery', { expose: 'jquery' });
    b.require('knockout', { expose: 'knockout' });
    b.require('lodash', { expose: 'lodash' });
    b.require('./node_modules/snapsvg/src/mina.js', { expose: 'mina' });
    b.require('moment', { expose: 'moment' });
    b.require('@primer/octicons', { expose: 'octicons' });
    b.require('signals', { expose: 'signals' });
    const outFile = fs.createWriteStream('./public/js/ungit.js');
    outFile.on('close', () => done());
    b.bundle().pipe(outFile);
  });

  grunt.registerTask('browserify-components', '', function () {
    Promise.all(
      fs.readdirSync('components').map((component) => {
        return new Promise((resolve, reject) => {
          const src = `./components/${component}/${component}.js`;
          if (!fs.existsSync(src)) {
            grunt.log.warn(
              `${src} does not exist. If this component is obsolete, please remove that directory or perform a clean build.`
            );
            resolve();
            return;
          }
          const b = browserify(src, {
            bundleExternal: false,
            debug: true,
          });
          const outFile = fs.createWriteStream(`./components/${component}/${component}.bundle.js`);
          outFile.on('close', () => resolve());
          b.bundle().pipe(outFile);
        });
      })
    ).then(this.async());
  });

  const bumpDependency = (packageJson, packageName) => {
    const dependencyType = packageJson['dependencies'][packageName]
      ? 'dependencies'
      : 'devDependencies';
    let currentVersion = packageJson[dependencyType][packageName];
    if (currentVersion[0] == '~' || currentVersion[0] == '^')
      currentVersion = currentVersion.slice(1);
    return pkgVersions(packageName).then((versionSet) => {
      const versions = Array.from(versionSet);
      const latestVersion = semver.maxSatisfying(versions, '*');
      if (semver.gt(latestVersion, currentVersion)) {
        packageJson[dependencyType][packageName] = '~' + latestVersion;
      }
    });
  };

  grunt.registerTask(
    'travisnpmpublish',
    'Automatically publish to NPM via travis and create git tag.',
    function () {
      const done = this.async();
      if (
        process.env.TRAVIS_BRANCH != 'master' ||
        (process.env.TRAVIS_PULL_REQUEST && process.env.TRAVIS_PULL_REQUEST != 'false')
      ) {
        grunt.log.writeln('Skipping travis npm publish');
        return done();
      }
      childProcess.exec('git rev-parse --short HEAD', (err, stdout, stderr) => {
        const hash = stdout.trim();
        const packageJson = JSON.parse(fs.readFileSync('package.json'));
        const version = packageJson.version;
        packageJson.version += `+${hash}`;
        fs.writeFileSync('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
        fs.writeFileSync('.npmrc', '//registry.npmjs.org/:_authToken=' + process.env.NPM_TOKEN);
        childProcess.exec('npm publish', (err) => {
          if (err) done(err);
          else
            childProcess.exec(
              `git tag v${version} && git push -q https://${process.env.GITHUB_TOKEN}@github.com/FredrikNoren/ungit.git v${version}`,
              (err) => {
                done(err);
              }
            );
        });
      });
    }
  );

  grunt.registerTask('electronpublish', ['zip_directories:electron']);

  /**
   * Run clicktest in parallel at test suite level.
   * This test does intermittently fails depends on the maxConcurrency level set
   * above and the capacity of the computer as sometimes lack of resource allocation
   * triggers timeouts.
   * Use at own discretion.
   */
  grunt.registerTask('clickParallel', 'Parallelized click tests.', function () {
    const done = this.async();

    fs.promises
      .readdir('./clicktests')
      .then((files) => files.filter((file) => file.startsWith('spec.')))
      .then((tests) => {
        const genericIndx = tests.indexOf('spec.generic.js');
        if (genericIndx > -1) {
          tests.splice(0, 0, tests.splice(genericIndx, 1)[0]);
        }
        return tests;
      })
      .then((tests) => {
        grunt.log.writeln('Running click tests in parallel... (this will take a while...)');
        return Promise.all(
          tests.map((file) => {
            let output = '';
            const outStream = (data) => (output += data);

            grunt.log.writeln(cliColor.set(`Clicktest started! \t${file}`, 'blue'));
            return new Promise((resolve, reject) => {
              const child = childProcess.execFile(
                './node_modules/mocha/bin/mocha',
                [path.join(__dirname, 'clicktests', file), '--timeout=35000', '-b'],
                { maxBuffer: 10 * 1024 * 1024 }
              );
              child.stdout.on('data', outStream);
              child.stderr.on('data', outStream);
              child.on('exit', (code) => {
                if (code == 0) resolve(file);
                else reject();
              });
            })
              .then(() => {
                grunt.log.writeln(cliColor.set(`'Clicktest success! \t${file}`, 'green'));
                return { name: file, output: output, isSuccess: true };
              })
              .catch(() => {
                grunt.log.writeln(cliColor.set(`'Clicktest fail! \t'${file}`, 'red'));
                return { name: file, output: output, isSuccess: false };
              });
          })
        );
      })
      .then((results) => {
        let isSuccess = true;
        results.forEach((result) => {
          if (!result.isSuccess) {
            grunt.log.writeln(`---- start of ${result.name} log ----`);
            grunt.log.writeln(result.output);
            grunt.log.writeln(`----- end of ${result.name} log -----`);
            isSuccess = false;
          }
        });
        done(isSuccess);
      });
  });

  grunt.registerTask(
    'bumpdependencies',
    'Bump dependencies to their latest versions.',
    function () {
      const done = this.async();
      grunt.log.writeln('Bumping dependencies...');
      const tempPackageJson = JSON.parse(JSON.stringify(packageJson));
      const keys = Object.keys(tempPackageJson.dependencies).concat(
        Object.keys(tempPackageJson.devDependencies)
      );

      const bumps = keys.map((dep) => {
        return bumpDependency(tempPackageJson, dep);
      });

      Promise.all(bumps)
        .then(() =>
          fs.promises.writeFile('package.json', `${JSON.stringify(tempPackageJson, null, 2)}\n`)
        )
        .then(() =>
          grunt.log.writeln('Dependencies bumped, run npm install to install latest versions.')
        )
        .then(() => {
          done();
        })
        .catch(done);
    }
  );

  grunt.registerMultiTask('electron', 'Package Electron apps', function () {
    const done = this.async();
    electronPackager(this.options()).then(() => {
      done();
    }, done);
  });

  grunt.event.on('coverage', (lcovFileContents) => {
    // Check below on the section "The coverage event"
    console.log(lcovFileContents);
    console.log('\n\n=== html report: ./coverage/coverage-unit/lcove-report/index.html ===\n\n');
  });

  grunt.loadNpmTasks('grunt-contrib-less');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-release');
  grunt.loadNpmTasks('grunt-mocha-test');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-mocha-istanbul');
  grunt.loadNpmTasks('grunt-zip-directories');

  // Default task, builds everything needed
  grunt.registerTask('default', [
    'checkPrettier',
    'less:production',
    'jshint',
    'browserify-common',
    'browserify-components',
    'copy:main',
  ]);

  // Run tests without compile (use watcher or manually build)
  grunt.registerTask('unittest', ['mochaTest:unit']);
  grunt.registerTask('clicktest', ['mochaTest:click']);
  grunt.registerTask('test', ['unittest', 'clicktest']);

  // Builds, and then creates a release (bump patch version, create a commit & tag, publish to npm)
  grunt.registerTask('publish', ['default', 'test', 'release:patch']);

  // Same as publish but for minor version
  grunt.registerTask('publishminor', ['default', 'test', 'release:minor']);

  // Create electron package
  grunt.registerTask('package', ['default', 'clean:electron', 'electron']);

  // run unit test coverage, assumes project is compiled
  grunt.registerTask('coverage-unit', ['clean:coverage-unit', 'mocha_istanbul:unit']);
};
