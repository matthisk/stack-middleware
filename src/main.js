'use strict';

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const parseSourceMap = require('./sourcemap').parseSourceMap;

const pathToTemplate = path.join(__dirname, './templates/index.html');
const template = fs.readFileSync(pathToTemplate).toString();
const renderTemplate = Handlebars.compile(template, {});

const util = require('./util');

const readFile = util.promisify(fs.readFile);
const exists = util.promisify(fs.exists);

function loadPrism() {
  const p = Promise.all([
    readFile(path.join(__dirname, '../lib/prism.js')),
    readFile(path.join(__dirname, '../lib/prism.css'))
  ]);

  return p.then(args => {
    const prismSRC = args[0];
    const prismStyles = args[1];
    return {
      prismSRC,
      prismStyles
    };
  });
}

// const result = {
//   line: number,
//   column: number,
//   at: string,
//   path: string,
//   code: string,
// }

function trimResult(input) {
  const result = {};

  const start = Math.max(input.line - 10, 0);
  const end = input.line + 10;

  result.trimmed = {};
  result.trimmed.start = start + 1;
  result.trimmed.line = Math.min(input.line, 10);

  result.start = start + 1;
  result.line = input.line;
  result.column = input.column;
  result.code = input.code.split('\n').slice(start, end).join('\n');
  result.path = input.path;
  result.at = input.at;

  return result;
}

function parseStack(error) {
  const stack = error.stack.split('\n').slice(1);
  const regex = /at ([\w.]+) \(([^:]+):(\d+):(\d+)\)/;

  const results = Promise.all(
    stack.map(line => {
      const match = line.match(regex);

      if (!match) return undefined;

      const lineNumber = parseInt(match[3], 10);
      const column = parseInt(match[4], 10);

      const result = {
        column,
        at: match[1],
        path: match[2],
        line: lineNumber,
        code: ''
      };

      return exists(result.path)
        .then(e => {
          if (e) {
            return readFile(result.path).then(file => {
              result.code = file.toString();
              return result;
            });
          }
          return result;
        })
        .then(r => parseSourceMap(r))
        .then(r => trimResult(r));
    })
  );

  return results.then(r => r.filter(i => i));
}

function getEnvironment() {
  return util.toKeyValueList(process.env);
}

function getGlobals() {
  return Object.keys(global)
    .map(key => ({
      key,
      value: `${global[key]}`
    }))
    .sort((a, b) => a.key.toLowerCase() > b.key.toLowerCase());
}

function getHeaders(request) {
  return util.toKeyValueList(request.headers);
}

function getRequest(request) {
  return util.toKeyValueList({
    path: request.path,
    method: request.method,
    host: request.host,
    locale: request.locale
  });
}

function getProcess() {
  return [
    { key: 'platform', value: process.platform },
    { key: 'arch', value: process.arch },
    { key: 'node_version', value: process.version },
    { key: 'cwd', value: process.cwd() },
    { key: 'execPath', value: process.execPath },
    { key: 'pid', value: process.pid },
    { key: 'mainModule', value: process.mainModule.filename },
    {
      key: 'memoryUsage',
      value: util.humanize(process.memoryUsage().heapTotal)
    }
  ];
}

module.exports = function main(opts, error, req) {
  return Promise.all([loadPrism(), parseStack(error)]).then(args => {
    const codemirror = args[0];
    const stack = args[1];
    // 3: Create config for Handlebars
    let config = {
      exception: error,
      headers: getHeaders(req),
      request: getRequest(req),
      stack,
      environment: getEnvironment(),
      globals: getGlobals(),
      process: getProcess()
    };

    config = Object.assign({}, config, codemirror);

    return renderTemplate(config);
  });
};
