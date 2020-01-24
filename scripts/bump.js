#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { bold, underline } = require('chalk');
const { spawnSync } = require('child_process');
const inquirer = require('inquirer');
const semver = require('semver');

const REPO_DIR = path.dirname(__dirname);

const readJson = path => {
  return JSON.parse(fs.readFileSync(path, { encoding: 'utf8' }));
};

const writeJson = (path, obj) => {
  const content = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(path, content, { encoding: 'utf8' });
};

const PACKAGE_ORIG_VERSIONS = [
  'cli',
  'core',
  'schema',
  'legacy-scripting-runner'
].reduce((result, packageName) => {
  const packageJsonPath = path.join(
    REPO_DIR,
    'packages',
    packageName,
    'package.json'
  );
  const packageJson = readJson(packageJsonPath);
  result[packageName] = packageJson.version;
  return result;
}, {});

const ensureMainPackageVersionsAreSame = () => {
  if (
    !(
      PACKAGE_ORIG_VERSIONS.cli === PACKAGE_ORIG_VERSIONS.core &&
      PACKAGE_ORIG_VERSIONS.core === PACKAGE_ORIG_VERSIONS.schema
    )
  ) {
    throw new Error(
      'Packages must have the same version number.\nInstead, we got ' +
        JSON.stringify(PACKAGE_ORIG_VERSIONS)
    );
  }
};

const promptPackagesToBump = async () => {
  const answer = await inquirer.prompt([
    {
      type: 'checkbox',
      message: 'What package(s) you want to bump?',
      name: 'packages',
      choices: [
        {
          name: `cli, core, schema (currently ${PACKAGE_ORIG_VERSIONS.cli})`,
          value: 'cli, core, schema'
        },
        {
          name: `legacy-scripting-runner (currently ${
            PACKAGE_ORIG_VERSIONS['legacy-scripting-runner']
          })`,
          value: 'legacy-scripting-runner'
        }
      ]
    }
  ]);
  return answer.packages;
};

const promptVersionToBump = async packageName => {
  const currentVersion = PACKAGE_ORIG_VERSIONS[packageName];

  const choices = ['patch', 'minor', 'major'].map(bumpType => {
    const version = semver.inc(currentVersion, bumpType);
    return {
      name: `${version} (${bumpType})`,
      value: version
    };
  });

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'versionToBump',
      message: `Version to bump for ${underline(packageName)}?`,
      choices
    }
  ]);
  return answer.versionToBump;
};

const bumpMainPackagesForExampleApps = versionToBump => {
  const examplesDir = path.join(REPO_DIR, 'example-apps');
  fs.readdirSync(examplesDir, { withFileTypes: true }).map(item => {
    if (item.isDirectory()) {
      const packageJsonPath = path.join(examplesDir, item.name, 'package.json');
      const packageJson = readJson(packageJsonPath);

      ['cli', 'core', 'schema'].map(packageName => {
        const packageFullName = `zapier-platform-${packageName}`;
        if (packageJson.dependencies) {
          const depVersion = packageJson.dependencies[packageFullName];
          if (depVersion) {
            console.log(
              `${item.name}'s dependency ${packageName} ${depVersion} -> ${versionToBump}`
            );
            packageJson.dependencies[packageFullName] = versionToBump;
          }
        }
      });

      writeJson(packageJsonPath, packageJson);
    }
  });
};

// Main packages are cli, core, schema
const bumpMainPackages = versionToBump => {
  const PACKAGES = ['cli', 'core', 'schema'];

  PACKAGES.map(packageName => {
    const packageJsonPath = path.join(
      REPO_DIR,
      'packages',
      packageName,
      'package.json'
    );
    const packageJson = readJson(packageJsonPath);

    console.log(
      `${packageName} ${PACKAGE_ORIG_VERSIONS[packageName]} -> ${versionToBump}`
    );
    packageJson.version = versionToBump;

    PACKAGES.map(depName => {
      const depFullName = `zapier-platform-${depName}`;
      const depVersion = packageJson.dependencies[depFullName];
      if (depVersion) {
        console.log(
          `${packageName}'s dependency ${depName} ${depVersion} -> ${versionToBump}`
        );
        packageJson.dependencies[depFullName] = versionToBump;
      }
    });

    writeJson(packageJsonPath, packageJson);
  });
};

// "Extension package", such as legacy-scripting-runner
const bumpExtensionPackage = (packageName, versionToBump) => {
  const packageJsonPath = path.join(
    REPO_DIR,
    'packages',
    packageName,
    'package.json'
  );
  const packageJson = readJson(packageJsonPath);

  console.log(`${packageName} ${packageJson.version} -> ${versionToBump}`);
  packageJson.version = versionToBump;
  writeJson(packageJsonPath, packageJson);
};

const bump = (packageName, versionToBump) => {
  if (packageName === 'cli, core, schema') {
    bumpMainPackages(versionToBump);
    bumpMainPackagesForExampleApps(versionToBump);
  } else {
    bumpExtensionPackage(packageName, versionToBump);
  }
};

const gitAdd = () => {
  const result = spawnSync(
    'git',
    ['add', 'packages/*/package.json', 'example-apps/*/package.json'],
    {
      stdio: [0, 1, 2]
    }
  );

  if (result.status !== 0) {
    throw new Error('git-add failed');
  }
};

const gitCommit = versionsToBump => {
  const messageParts = Object.keys(versionsToBump).map(packageName => {
    const fromVersion = PACKAGE_ORIG_VERSIONS[packageName];
    const toVersion = versionsToBump[packageName];
    return `${packageName} ${fromVersion} -> ${toVersion}`;
  });
  const message = 'Bump ' + messageParts.join(', ');
  const result = spawnSync('git', ['commit', '-m', message], {
    stdio: [0, 1, 2]
  });

  if (result.status !== 0) {
    throw new Error('git-commit failed');
  }
};

const gitTag = versionsToBump => {
  const toVersions = Object.keys(versionsToBump).reduce(
    (result, packageName) => {
      const toVersion = versionsToBump[packageName];
      if (packageName === 'cli, core, schema') {
        result.cli = result.core = result.schema = toVersion;
      } else {
        result[packageName] = toVersion;
      }
      return result;
    },
    {}
  );

  Object.keys(toVersions).map(packageName => {
    const version = toVersions[packageName];
    const tag = `zapier-platform-${packageName}@${version}`;

    const result = spawnSync('git', ['tag', '-a', tag, '-m', tag], {
      stdio: [0, 1, 2]
    });

    if (result.status !== 0) {
      throw new Error('git-tag failed');
    }
  });
};

const main = async () => {
  try {
    ensureMainPackageVersionsAreSame();
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  // Currently we bump cli, core, schema together
  PACKAGE_ORIG_VERSIONS['cli, core, schema'] = PACKAGE_ORIG_VERSIONS.cli;

  const packagesToBump = await promptPackagesToBump();
  if (packagesToBump.length === 0) {
    console.log('No packages selected, nothing to do here');
    return 0;
  }

  const versionsToBump = {};
  for (const packageName of packagesToBump) {
    versionsToBump[packageName] = await promptVersionToBump(packageName);
  }

  Object.keys(versionsToBump).map(packageName => {
    bump(packageName, versionsToBump[packageName]);
  });

  try {
    gitAdd();
    gitCommit(versionsToBump);
    gitTag(versionsToBump);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  console.log(
    `\nDone! Now you can ${bold.underline('git push origin master --tags')}.`
  );

  return 0;
};

main().then(exitCode => {
  if (exitCode) {
    process.exit(exitCode);
  }
});
