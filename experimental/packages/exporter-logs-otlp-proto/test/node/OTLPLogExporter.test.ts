/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { diag } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import * as assert from 'assert';
import * as http from 'http';
import * as sinon from 'sinon';
import { Stream, PassThrough } from 'stream';
import * as zlib from 'zlib';
import { OTLPLogExporter } from '../../src';
import {
  ensureExportLogsServiceRequestIsSet,
  ensureExportedLogRecordIsCorrect,
  mockedReadableLogRecord,
  MockedResponse,
} from '../logHelper';
import {
  CompressionAlgorithm,
  OTLPExporterNodeConfigBase,
  OTLPExporterError,
} from '@opentelemetry/otlp-exporter-base';
import { IExportLogsServiceRequest } from '@opentelemetry/otlp-transformer';
import { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { VERSION } from '../../src/version';
import { Root } from 'protobufjs';
import * as path from 'path';

let fakeRequest: PassThrough;

const dir = path.resolve(__dirname, '../../../otlp-transformer/protos');
const root = new Root();
root.resolvePath = function (origin, target) {
  return `${dir}/${target}`;
};
const proto = root.loadSync([
  'opentelemetry/proto/common/v1/common.proto',
  'opentelemetry/proto/resource/v1/resource.proto',
  'opentelemetry/proto/logs/v1/logs.proto',
  'opentelemetry/proto/collector/logs/v1/logs_service.proto',
]);
const exportRequestServiceProto = proto?.lookupType('ExportLogsServiceRequest');

describe('OTLPLogExporter - node with proto over http', () => {
  let collectorExporter: OTLPLogExporter;
  let collectorExporterConfig: OTLPExporterNodeConfigBase;
  let logs: ReadableLogRecord[];

  afterEach(() => {
    fakeRequest = new Stream.PassThrough();
    Object.defineProperty(fakeRequest, 'setTimeout', {
      value: function (_timeout: number) {},
    });
    sinon.restore();
  });

  describe('when configuring via environment', () => {
    const envSource = process.env;
    it('should use url defined in env that ends with root path and append version and signal path', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar/';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_ENDPOINT}v1/logs`
      );
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
    });
    it('should use url defined in env without checking if path is already present', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar/v1/logs';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`
      );
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
    });
    it('should use url defined in env and append version and signal', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`
      );
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
    });
    it('should override global exporter url with signal url defined in env', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar/';
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://foo.logs/';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
      );
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = '';
    });
    it('should override url defined in env with url defined in constructor', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar/';
      const constructorDefinedEndpoint = 'http://constructor/v1/logs';
      const collectorExporter = new OTLPLogExporter({
        url: constructorDefinedEndpoint,
      });
      assert.strictEqual(collectorExporter.url, constructorDefinedEndpoint);
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
    });
    it('should add root path when signal url defined in env contains no path and no root path', () => {
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://foo.bar';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT}/`
      );
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = '';
    });
    it('should not add root path when signal url defined in env contains root path but no path', () => {
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://foo.bar/';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT}`
      );
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = '';
    });
    it('should not add root path when signal url defined in env contains path', () => {
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://foo.bar/v1/logs';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT}`
      );
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = '';
    });
    it('should not add root path when signal url defined in env contains path and ends in /', () => {
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://foo.bar/v1/logs/';
      const collectorExporter = new OTLPLogExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT}`
      );
      envSource.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = '';
    });
    it('should include user-agent header by default', () => {
      const exporter = new OTLPLogExporter();
      assert.strictEqual(
        exporter['_transport']['_transport']['_parameters']['headers'][
          'User-Agent'
        ],
        `OTel-OTLP-Exporter-JavaScript/${VERSION}`
      );
    });
    it('should use headers defined via env', () => {
      envSource.OTEL_EXPORTER_OTLP_LOGS_HEADERS = 'foo=bar';
      const exporter = new OTLPLogExporter();
      assert.strictEqual(
        exporter['_transport']['_transport']['_parameters']['headers']['foo'],
        'bar'
      );
      envSource.OTEL_EXPORTER_OTLP_HEADERS = '';
    });
    it('should override global headers config with signal headers defined via env', () => {
      envSource.OTEL_EXPORTER_OTLP_HEADERS = 'foo=bar,bar=foo';
      envSource.OTEL_EXPORTER_OTLP_LOGS_HEADERS = 'foo=boo';
      const exporter = new OTLPLogExporter();
      assert.strictEqual(
        exporter['_transport']['_transport']['_parameters']['headers']['foo'],
        'boo'
      );
      assert.strictEqual(
        exporter['_transport']['_transport']['_parameters']['headers']['bar'],
        'foo'
      );
      envSource.OTEL_EXPORTER_OTLP_LOGS_HEADERS = '';
      envSource.OTEL_EXPORTER_OTLP_HEADERS = '';
    });
    it('should override headers defined via env with headers defined in constructor', () => {
      envSource.OTEL_EXPORTER_OTLP_HEADERS = 'foo=bar,bar=foo';
      const exporter = new OTLPLogExporter({
        headers: {
          foo: 'constructor',
        },
      });
      assert.strictEqual(
        exporter['_transport']['_transport']['_parameters']['headers']['foo'],
        'constructor'
      );
      assert.strictEqual(
        exporter['_transport']['_transport']['_parameters']['headers']['bar'],
        'foo'
      );
      envSource.OTEL_EXPORTER_OTLP_HEADERS = '';
    });
  });

  describe('export', () => {
    beforeEach(() => {
      collectorExporterConfig = {
        headers: {
          foo: 'bar',
        },
        hostname: 'foo',
        url: 'http://foo.bar.com',
        keepAlive: true,
        httpAgentOptions: { keepAliveMsecs: 2000 },
      };
      collectorExporter = new OTLPLogExporter(collectorExporterConfig);
      logs = [];
      logs.push(Object.assign({}, mockedReadableLogRecord));
    });
    afterEach(() => {
      sinon.restore();
    });

    it('should open the connection', done => {
      sinon.stub(http, 'request').callsFake((options: any, cb: any) => {
        assert.strictEqual(options.hostname, 'foo.bar.com');
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.path, '/');

        queueMicrotask(() => {
          const mockRes = new MockedResponse(200);
          cb(mockRes);
          mockRes.send(Buffer.from('success'));
          done();
        });
        return fakeRequest as any;
      });
      collectorExporter.export(logs, () => {});
    });

    it('should set custom headers', done => {
      sinon.stub(http, 'request').callsFake((options: any, cb: any) => {
        assert.strictEqual(options.headers['foo'], 'bar');

        queueMicrotask(() => {
          const mockRes = new MockedResponse(200);
          cb(mockRes);
          mockRes.send(Buffer.from('success'));
          done();
        });
        return fakeRequest as any;
      });
      collectorExporter.export(logs, () => {});
    });

    it('should have keep alive and keepAliveMsecs option set', done => {
      sinon.stub(http, 'request').callsFake((options: any, cb: any) => {
        assert.strictEqual(options.agent.keepAlive, true);
        assert.strictEqual(options.agent.options.keepAliveMsecs, 2000);

        queueMicrotask(() => {
          const mockRes = new MockedResponse(200);
          cb(mockRes);
          mockRes.send(Buffer.from('success'));
          done();
        });
        return fakeRequest as any;
      });
      collectorExporter.export(logs, () => {});
    });

    it('should successfully send the logs', done => {
      const fakeRequest = new Stream.PassThrough();
      Object.defineProperty(fakeRequest, 'setTimeout', {
        value: function (_timeout: number) {},
      });
      sinon.stub(http, 'request').returns(fakeRequest as any);

      let buff = Buffer.from('');
      fakeRequest.on('end', () => {
        const data = exportRequestServiceProto.decode(buff);
        const json = data?.toJSON() as IExportLogsServiceRequest;
        const log1 = json.resourceLogs?.[0].scopeLogs?.[0].logRecords?.[0];
        assert.ok(typeof log1 !== 'undefined', "log doesn't exist");
        ensureExportedLogRecordIsCorrect(log1);

        ensureExportLogsServiceRequestIsSet(json);

        done();
      });

      fakeRequest.on('data', chunk => {
        buff = Buffer.concat([buff, chunk]);
      });

      const clock = sinon.useFakeTimers();
      collectorExporter.export(logs, () => {});
      clock.tick(200);
      clock.restore();
    });

    it('should log the successful message', done => {
      // Need to stub/spy on the underlying logger as the "diag" instance is global
      const spyLoggerError = sinon.stub(diag, 'error');

      sinon.stub(http, 'request').callsFake((options: any, cb: any) => {
        queueMicrotask(() => {
          const mockRes = new MockedResponse(200);
          cb(mockRes);
          mockRes.send(Buffer.from('success'));
        });
        return fakeRequest as any;
      });

      collectorExporter.export(logs, result => {
        assert.strictEqual(result.code, ExportResultCode.SUCCESS);
        assert.strictEqual(spyLoggerError.args.length, 0);
        done();
      });
    });

    it('should log the error message', done => {
      sinon.stub(http, 'request').callsFake((options: any, cb: any) => {
        queueMicrotask(() => {
          const mockRes = new MockedResponse(400);
          cb(mockRes);
          mockRes.send(Buffer.from('failure'));
        });

        return fakeRequest as any;
      });

      collectorExporter.export(logs, result => {
        assert.strictEqual(result.code, ExportResultCode.FAILED);
        // @ts-expect-error verify error code
        assert.strictEqual(result.error.code, 400);
        done();
      });
    });
  });
  describe('export - with compression', () => {
    beforeEach(() => {
      collectorExporterConfig = {
        headers: {
          foo: 'bar',
        },
        hostname: 'foo',
        url: 'http://foo.bar.com',
        keepAlive: true,
        compression: CompressionAlgorithm.GZIP,
        httpAgentOptions: { keepAliveMsecs: 2000 },
      };
      collectorExporter = new OTLPLogExporter(collectorExporterConfig);
      logs = [];
      logs.push(Object.assign({}, mockedReadableLogRecord));
    });
    afterEach(() => {
      sinon.restore();
    });

    it('should successfully send the logs', done => {
      const fakeRequest = new Stream.PassThrough();
      Object.defineProperty(fakeRequest, 'setTimeout', {
        value: function (_timeout: number) {},
      });
      sinon.stub(http, 'request').returns(fakeRequest as any);
      const spySetHeader = sinon.spy();
      (fakeRequest as any).setHeader = spySetHeader;

      let buff = Buffer.from('');
      fakeRequest.on('end', () => {
        const unzippedBuff = zlib.gunzipSync(buff);
        const data = exportRequestServiceProto.decode(unzippedBuff);
        const json = data?.toJSON() as IExportLogsServiceRequest;
        const log1 = json.resourceLogs?.[0].scopeLogs?.[0].logRecords?.[0];
        assert.ok(typeof log1 !== 'undefined', "log doesn't exist");
        ensureExportedLogRecordIsCorrect(log1);

        ensureExportLogsServiceRequestIsSet(json);
        assert.ok(spySetHeader.calledWith('Content-Encoding', 'gzip'));

        done();
      });

      fakeRequest.on('data', chunk => {
        buff = Buffer.concat([buff, chunk]);
      });

      const clock = sinon.useFakeTimers();
      collectorExporter.export(logs, () => {});
      clock.tick(200);
      clock.restore();
    });
  });
});

describe('export - real http request destroyed before response received', () => {
  let collectorExporter: OTLPLogExporter;
  let collectorExporterConfig: OTLPExporterNodeConfigBase;
  let logs: ReadableLogRecord[];
  const server = http.createServer((_, res) => {
    setTimeout(() => {
      res.statusCode = 200;
      res.end();
    }, 1000);
  });
  before(done => {
    server.listen(8082, done);
  });
  after(done => {
    server.close(done);
  });
  it('should log the timeout request error message when timeout is 1', done => {
    collectorExporterConfig = {
      url: 'http://localhost:8082',
      timeoutMillis: 1,
    };
    collectorExporter = new OTLPLogExporter(collectorExporterConfig);
    logs = [];
    logs.push(Object.assign({}, mockedReadableLogRecord));

    collectorExporter.export(logs, result => {
      try {
        assert.strictEqual(result.code, ExportResultCode.FAILED);
        const error = result.error as OTLPExporterError;
        assert.ok(error !== undefined);
        assert.strictEqual(error.message, 'Request Timeout');
        done();
      } catch (e) {
        done(e);
      }
    });
  });
  it('should log the timeout request error message when timeout is 100', done => {
    collectorExporterConfig = {
      url: 'http://localhost:8082',
      timeoutMillis: 100,
    };
    collectorExporter = new OTLPLogExporter(collectorExporterConfig);
    logs = [];
    logs.push(Object.assign({}, mockedReadableLogRecord));

    collectorExporter.export(logs, result => {
      assert.strictEqual(result.code, ExportResultCode.FAILED);
      const error = result.error as OTLPExporterError;
      assert.ok(error !== undefined);
      assert.strictEqual(error.message, 'Request Timeout');
      done();
    });
  });
});

describe('export - real http request destroyed after response received', () => {
  let collectorExporter: OTLPLogExporter;
  let collectorExporterConfig: OTLPExporterNodeConfigBase;
  let logs: ReadableLogRecord[];

  const server = http.createServer((_, res) => {
    res.write('writing something');
  });
  before(done => {
    server.listen(8082, done);
  });
  after(done => {
    server.close(done);
  });
  it('should log the timeout request error message', done => {
    collectorExporterConfig = {
      url: 'http://localhost:8082',
      timeoutMillis: 300,
    };
    collectorExporter = new OTLPLogExporter(collectorExporterConfig);
    logs = [];
    logs.push(Object.assign({}, mockedReadableLogRecord));

    collectorExporter.export(logs, result => {
      assert.strictEqual(result.code, ExportResultCode.FAILED);
      const error = result.error as OTLPExporterError;
      assert.ok(error !== undefined);
      assert.strictEqual(error.message, 'Request Timeout');
      done();
    });
  });
});
