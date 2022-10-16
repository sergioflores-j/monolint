import fs from 'fs';

import fg from 'fast-glob';

import { RuleResult } from './types/RuleResult';
import { Module } from './types/Module';
import { Config } from './types/Config';
import { mergeConfigs } from './utils';
import { DefaultConfig } from './defaultConfig';
// when these rules are imported, they are registered in registry
import r1 from './rules/serverless-same-name';
import r2 from './rules/packagejson-same-name';
import { register, allRules, enabledRules } from './registry';

const lint = (baseDir:string):RuleResult[] => {

  const baseConfig = loadBaseConfig(baseDir);
  console.debug(`Base config=${JSON.stringify(baseConfig)}`);

  register(r1);
  register(r2);

  const results:RuleResult[] = [];

  // check generic rules
  console.debug('Checking base rules (outside modules)');
  const erules = enabledRules(baseConfig);
  for (let i = 0; i < erules.length; i += 1) {
    const rule = erules[i];
    console.debug(`> Rule '${rule.name}'`);
    const ruleResults = rule.check(baseDir, baseConfig);
    if (ruleResults === null) {
      console.debug('  - skipped');
      continue;
    }
    for (let j = 0; j < ruleResults.length; j += 1) {
      const ruleResult = ruleResults[j];
      ruleResult.rule = rule.name;
      results.push(ruleResult);
      console.debug(`   - resource=${ruleResult.resource} valid=${ruleResult.valid}`);
    }
  }


  // check modules
  const modules = discoverModules(baseDir, baseConfig);
  console.debug(`Modules found: ${JSON.stringify(modules.map((mm) => mm.name))}`);

  // gather all modules for which a certain rule is enabled
  console.debug('Checking rules against modules');
  for (let i = 0; i < allRules.length; i += 1) {
    const rule = allRules[i];
    const ruleModules:Module[] = modules.filter((module) => {
      return module.enabledRules.includes(rule);
    });

    console.debug(`> Checking rule '${rule.name}'`);
    const ruleResults = rule.checkModules(ruleModules, baseDir);
    if (ruleResults === null) {
      console.debug('   - skipped');
      continue;
    }
    for (let kk = 0; kk < ruleResults.length; kk += 1) {
      const ruleResult = ruleResults[kk];
      ruleResult.rule = rule.name;
      results.push(ruleResult);
      console.debug(`   - resource=${ruleResult.resource} valid=${ruleResult.valid}`);
    }
  }

  return results;
};

const discoverModules = (baseDir:string, baseConfig:Config):Module[] => {
  const patterns:string[] = [];
  baseConfig['module-markers'].forEach((elem) => {
    patterns.push(`${baseDir}/**/${elem}`);
  });

  const entries = fg.sync(
    patterns, { dot: true },
  );

  const paths:string[] = [];
  const modules:Module[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const elem = entries[i];

    const baseModulePath = elem.substring(0, elem.lastIndexOf("/"));
    const moduleName = baseModulePath.substring(baseModulePath.lastIndexOf("/") + 1, elem.lastIndexOf("/"));

    // check if this module was already added before
    if (paths.includes(baseModulePath)) {
      continue;
    }
    paths.push(baseModulePath);

    // // iterate over module path hierarchy
    const modulePaths = baseModulePath.split('/');
    let path = '';

    let skipModule = false;
    let moduleConfig = baseConfig;

    // iterate over path parts of the module for creating a merged config
    // and checking if there is any .monolinterignore file
    for (let j = 0; j < modulePaths.length; j += 1) {
      const pathPart = modulePaths[j];

      if (path.length === 0) {
        path = `${pathPart}`;
      } else {
        path = `${path}/${pathPart}`;
      }

      // only evaluate files starting from baseDir path
      if (path.length < baseDir.length) {
        continue;
      }

      // calculate merged config by looking at the module path hierarchy
      const configFile = `${path}/.monolinter.json`;
      if (fs.existsSync(configFile)) {
        const cf = fs.readFileSync(configFile);
        try {
          const loadedConfig = JSON.parse(cf.toString());
          moduleConfig = mergeConfigs(moduleConfig, loadedConfig);
        } catch (err) {
          throw new Error(`Error loading config ${configFile}. err=${err}`);
        }
      }

      // if .monolinterignore file in any place in path hierarchy, skip this module
      if (fs.existsSync(`${path}/.monolinterignore`)) {
        skipModule = true;
        break;
      }
    }

    if (skipModule) {
      continue;
    }

    const erules = enabledRules(moduleConfig);

    modules.push({
      path: baseModulePath,
      name: moduleName,
      config: moduleConfig,
      enabledRules: erules,
    });
  }
  return modules;
};

const loadBaseConfig = (baseDir:string):Config => {
  const cfile = `${baseDir}/.monolinter.json`;

  let baseConfig = <Config>DefaultConfig;

  if (fs.existsSync(cfile)) {
    const cf = fs.readFileSync(cfile);
    const loadedConfig = JSON.parse(cf.toString());
    baseConfig = mergeConfigs(baseConfig, loadedConfig);

  } else {
    console.info(`File ".monolinter.json" not found in dir "${baseDir}". Using default configurations`);
  }

  return baseConfig;
};


export { lint, discoverModules, loadBaseConfig };
