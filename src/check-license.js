/*
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/

var nlf = require('nlf'),
    treeify = require('treeify'),
    optimist = require('optimist'),
    fs = require('fs'),
    path = require('path'),
    Q = require('q'),
    flagutil = require('./flagutil');

var jsonObject = {},
    validLicenses = [],
    licensesFile = path.join('cordova-coho', 'src', 'validLicenses.json'),
    reposWithDependencies = [],
    flagged = [];

module.exports = function*(argv) {
    var opt = flagutil.registerRepoFlag(optimist)
    opt = flagutil.registerHelpFlag(opt);
    var argv = opt
        .usage('Go through each specified repo and check the licenses of node modules that are 3rd-party dependencies.\n\n' +
               'Usage: $0 check-license --repo=name [--repo=othername]')
        .argv;

    if (argv.h) {
        optimist.showHelp();
        process.exit(1);
    }
    var repos = flagutil.computeReposFromFlag(argv.r);
    checkLicense(repos);
};

function getRepoLicense(repoName){
   return Q.nfapply(nlf.find, [{
               directory : path.join(process.cwd(), repoName)
           }
       ]).then(function (p) {
       return p;
   });
}
function checkLicense(repos) {

    //get the license info for each repo's dependencies and subdependencies
    var results = [];
    var previous = Q.resolve();
    repos.forEach(function(repo) {
            previous = previous.then(function() {
                if (fs.existsSync(repo.repoName) && (fs.existsSync(path.join(repo.repoName, 'package.json')) || (fs.existsSync(path.join(repo.repoName, repo.repoName, 'package.json'))))) {
                    reposWithDependencies.push(repo.repoName);
                    if (repo.repoName == 'cordova-lib')
                        return getRepoLicense(path.join(repo.repoName, repo.repoName)); //go into inner cordova-lib to get packages
                    return getRepoLicense(repo.repoName);
                }
                else
                    Q.resolve('Repo directory does not exist: ' + repos.repoName + '. First run coho repo-clone.'); //don't end execution if repo doesn't have dependencies or doesn't exist

        }).then(function (data) {
            results.push(data); //push the result of this repo to the results array for later processing
        });
    });

    //process the results after the licenses for all repos have been retrieved
    previous.then(function(result) {
        processResults(results, repos);
    }, function(err) {
        console.log(err);
    });
}

//process the results of each repo
function processResults(results, repos) {
    //get valid licenses file to flag packages
    validLicenses = fs.readFileSync(licensesFile, 'utf8');
    if (!validLicenses)
    {
        console.log('No valid licenses file. Please make sure it exists.');
        return;
    }
    validLicenses = (JSON.parse(validLicenses)).validLicenses;

    //go through each repo, get its dependencies and add to json object
    for (var i = 0; i < results.length; ++i) {
        if (reposWithDependencies.indexOf(repos[i].repoName) > -1)
        {
            var repoJsonObj = {};
            repoJsonObj.dependencies = getDependencies(results[i]);
            jsonObject[repos[i].repoName] = repoJsonObj;
        }
    }

    //output results (license info for all packages + list of flagged packages)
    console.log('Below is the license info for all the packages');
    console.log(treeify.asTree(jsonObject, true));
    console.log('\n***********************************************************************************************************************');
    console.log('***********************************************************************************************************************');
    console.log('***********************************************************************************************************************\n');
    console.log(flagged.length + ' packages were flagged. Please verify manually that the licenses are valid. See those packages below.');
    for (var j = 0; j < flagged.length; ++j)
    {
        console.log(treeify.asTree(flagged[j], true));
    }
    console.log(flagged.length + ' packages were flagged. Please verify manually that the licenses are valid. See those packages above.');
}

//get dependencies for a repo
function getDependencies(packages) {
    var dependencies = [];
    for (var j = 0; j < packages.length; ++j)
    {
        //pull out only relevant info and add to dependencies array
        var obj = {};
        obj.name = packages[j].name;
        obj.id = packages[j].id;
        obj.directory = [packages[j].directory];
        obj.licenses = packages[j].licenseSources.package.sources;
        dependencies.push(obj);

        //flag any packages whose licenses may not be compatible
        if (!hasValidLicense(obj))
        {
            var duplicate = false;
            //avoid duplicating already flagged packages
            for (var z = 0; z < flagged.length; ++z)
            {
                if (flagged[z].id == obj.id)
                {
                    duplicate = true;
                    break;
                }
            }

            if (duplicate)
                flagged[z].directory = flagged[z].directory.concat(obj.directory); //if it is already flagged then just add the directory to the directories array

            else
                flagged.push(JSON.parse(JSON.stringify(obj)));
        }
    }

    return dependencies;
}

//check if package has valid licenses
function hasValidLicense(package) {
    var isValid = false;

    if (package.licenses.length == 0)
            return isValid;

    else
    {
        //go through each license of the package
        for (var x = 0; x < package.licenses.length; ++x)
        {
            isValid = false;

            //go through valid licenses and try to match with package license
            for (var y = 0; y < validLicenses.length; ++y)
            {
                var pattern = new RegExp(validLicenses[y], "gi"); //construct regular expression from valid license
                if ((package.licenses[x].license).match(pattern)) //match it against the package license
                    isValid = true;
            }

            //shortcut - if one license isn't valid then go ahead and flag it
            if (isValid == false)
                break;
        }
    }

    return isValid;
}
