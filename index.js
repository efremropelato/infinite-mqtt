#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const progress_logger_js_1 = require("progress-logger-js");
const fs_1 = __importDefault(require("fs"));
const MqttService_1 = require("./MqttService");
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const meow = require("meow");
let progress;
const tasks = new Array();
const appVersion = require("./package.json").version;
const cli = meow(`
Version ${appVersion}
Usage
  $ infinite-mqtt <url> [OPTIONS]

Options
  --topic, -t Topic, default to "test". "{CLIENTID}" placeholder will be replaced with the actual client id.
  --body, -b Payload body to send, it should point to a local file, default to no body
  --username, -u Username, optional
  --password, -w Password, optional
  --jwtSecret, -j Instead of a password you can pass a jwt secret as base 64. In this case a token will be created with the clientId as issuer.
  --clientId, -c Client id, default to a random value
  --unique,  Unique client id, add the task index to the client id.
  --qos, q QoS, options default 1
  --parallelism, -p  Parallel calls, default 1
  --sleep, -s  Sleep ms, default 0

Examples
  $ infinite-mqtt mqtt://broker.mqttdashboard.com:1883 -t davide/test/hello -b ./my-payload.json -s 1000
`, {
    flags: {
        parallelism: {
            type: 'string',
            alias: 'p',
            default: '1'
        },
        sleep: {
            type: 'string',
            alias: 's',
            default: '0'
        },
        topic: {
            type: 'string',
            alias: 't',
            default: 'test'
        },
        clientId: {
            type: 'string',
            alias: 'c',
            default: crypto_1.default.randomBytes(20).toString('hex')
        },
        unique: {
            type: 'boolean',
            default: false
        },
        username: {
            type: 'string',
            alias: 'u',
            default: ''
        },
        password: {
            type: 'string',
            alias: 'w',
            default: ''
        },
        jwtSecret: {
            type: 'string',
            alias: 'j',
            default: ''
        },
        qos: {
            type: 'number',
            alias: 'q',
            default: 1
        },
        body: {
            type: 'string',
            alias: 'b',
            default: undefined
        }
    }
});
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), ms);
    });
}
function createTask(taskId, mqttUrl, options) {
    return __awaiter(this, void 0, void 0, function* () {
        let clientId = options.clientId;
        if (options.unique) {
            clientId += "-" + taskId;
        }
        let mqttPassword = options.password;
        if (options.jwtSecret) {
            mqttPassword = jsonwebtoken_1.default.sign({}, Buffer.from(options.jwtSecret, "base64"), { issuer: clientId, expiresIn: "24h" });
        }
        const mqttService = yield MqttService_1.MqttService.connect({ brokerUrl: mqttUrl }, clientId, options.username, mqttPassword);
        const mqttTopic = options.topic.replace(/\{CLIENTID\}/, clientId);
        return {
            mqttService,
            mqttTopic
        };
    });
}
function runTask(task, options) {
    return __awaiter(this, void 0, void 0, function* () {
        while (true) {
            yield progress.incrementPromise(task.mqttService.publish(task.mqttTopic, options.qos, options.body));
            if (options.sleep > 0) {
                yield sleep(options.sleep);
            }
        }
    });
}
function run(mqttUrl, options) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!mqttUrl) {
            throw new Error("url not provided");
        }
        const pSleep = parseInt(options.sleep, 10);
        if (isNaN(pSleep)) {
            throw new Error("Invalid sleep parameter");
        }
        const pParallelism = parseInt(options.parallelism, 10);
        if (isNaN(pParallelism)) {
            throw new Error("Invalid parallelism parameter");
        }
        const pBody = options.body && fs_1.default.readFileSync(options.body);
        const optionsParser = {
            sleep: pSleep,
            parallelism: pParallelism,
            topic: options.topic,
            clientId: options.clientId,
            password: options.password,
            jwtSecret: options.jwtSecret,
            username: options.username,
            qos: options.qos,
            brokerUrl: mqttUrl,
            body: pBody,
            unique: options.unique
        };
        tasks.length = 0;
        for (let i = 0; i < optionsParser.parallelism; i++) {
            const task = yield createTask(i, mqttUrl, optionsParser);
            tasks.push(task);
        }
        progress = new progress_logger_js_1.ProgressLogger({
            label: "infinite-mqtt",
            logInterval: 1000
        });
        const promises = tasks.map(t => runTask(t, optionsParser));
        return Promise.all(promises);
    });
}
run(cli.input[0], cli.flags)
    .catch((err) => {
    console.error(err);
    process.exit(1);
});
process.on('SIGINT', function () {
    if (progress) {
        progress.end();
        for (const err of progress.stats().errors) {
            console.log(err);
        }
    }
    tasks.map(t => t.mqttService.close());
    process.exit(0);
});
