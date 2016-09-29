import path from 'path';
import {spawn} from 'child_process';
import fs from 'fs-extra';
import Gherkin from 'gherkin';
import Promise from 'bluebird';

const gherkinParser = new Gherkin.Parser();

export default class Worker {
  constructor(options) {
    this.scenario = options.scenario;
    this.scenarioLine = options.scenarioLine;
    this.featureFile = options.featureFile;
    this.isScenarioOutline = options.isScenarioOutline;

    let file = fs.readFileSync(this.featureFile, { encoding: 'utf8' });

    this.featureData = gherkinParser.parse(file).feature;
    this.scenarioData = this.featureData.children.filter((scenario) => {
      if (this.isScenarioOutline) {
        return scenario.type === 'ScenarioOutline' && scenario.examples.some((example) => {
          return example.tableBody.some((row) => {
            return row.location.line === parseInt(this.scenarioLine);
          });
        });
      }
      return (scenario.location.line === parseInt(this.scenarioLine));
    }).pop();

    this.logFileName = path.basename(this.featureFile) + '-line-' + this.scenarioLine + '.json';
    this.logFile = path.join(options.logDir, this.logFileName);
    this.relativeLogFile = path.relative(process.cwd(), this.logFile);

    this.cucumberPath = options.cucumberPath;
    this.args = [this.cucumberPath, this.featureFile + ':' + this.scenarioLine, '-f', 'json:' + this.relativeLogFile];

    options.requires.forEach((arg) => {
      this.args.push('-r');
      this.args.push(arg);
    });

    if (options.inlineStream) {
      this.ioMode = 'inherit';
    } else {
      this.ioMode = ['ignore', 'pipe', 'pipe'];
    }
  }

  formatResults(exitCode, startTime, err) {
    let results = null;
    try {
      results = fs.readJsonSync(this.logFile).pop();
    } catch (e) {
      e.msg = 'Cucumber has failed to produce parseable results.' + e.msg;
      err = err || e;
      exitCode = 1;
    }

    return {
      type: 'result',
      exitCode: exitCode,
      exception: err,
      feature: this.featureData,
      scenario: this.scenarioData,
      results: results,
      duration: new Date() - startTime
    };
  }

  execute() {
    return new Promise((resolve) => {
      let startTime = new Date();
      let cucumberError = '';

      this.child = spawn(
        process.execPath,
        this.args,
        {stdio: this.ioMode}
      );

      this.child.on('exit', (code) => {
        resolve(this.formatResults(code, startTime, cucumberError));
      });

      this.child.on('error', (err) => {
        resolve(this.formatResults(1, startTime, cucumberError + '\n' + err));
      });

      this.child.stderr.on('data', (data) => {
        cucumberError = cucumberError + '\n' + data;
      });
    });
  }

  kill() {
    if (this.child) {
      this.child.kill();
    }
  }
}
