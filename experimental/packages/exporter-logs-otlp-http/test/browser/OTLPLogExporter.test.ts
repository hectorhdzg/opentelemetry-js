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
import * as assert from 'assert';
import * as sinon from 'sinon';

import { OTLPLogExporter } from '../../src/platform/browser';
import { OTLPExporterConfigBase } from '@opentelemetry/otlp-exporter-base';
import { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { mockedReadableLogRecord } from '../logHelper';
import { ExportResultCode } from '@opentelemetry/core';

describe('OTLPLogExporter', () => {
  let collectorExporter: OTLPLogExporter;
  let collectorExporterConfig: OTLPExporterConfigBase;

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      const exporter = new OTLPLogExporter();
      assert.ok(exporter instanceof OTLPLogExporter);
    });
  });

  describe('export - common', () => {
    let spySend: any;
    beforeEach(() => {
      spySend = sinon.stub(OTLPLogExporter.prototype, 'send');
      collectorExporter = new OTLPLogExporter(collectorExporterConfig);
    });

    it('should export spans as otlpTypes.Spans', done => {
      const logs: ReadableLogRecord[] = [];
      logs.push(Object.assign({}, mockedReadableLogRecord));

      collectorExporter.export(logs, () => {});
      setTimeout(() => {
        const log = spySend.args[0][0][0] as ReadableLogRecord;
        assert.deepStrictEqual(logs[0], log);
        done();
      });
      assert.strictEqual(spySend.callCount, 1);
    });

    describe('when exporter is shutdown', () => {
      it(
        'should not export anything but return callback with code' +
          ' "FailedNotRetryable"',
        async () => {
          const spans: ReadableLogRecord[] = [];
          spans.push(Object.assign({}, mockedReadableLogRecord));
          await collectorExporter.shutdown();
          spySend.resetHistory();

          const callbackSpy = sinon.spy();
          collectorExporter.export(spans, callbackSpy);
          const returnCode = callbackSpy.args[0][0];

          assert.strictEqual(
            returnCode.code,
            ExportResultCode.FAILED,
            'return value is wrong'
          );
          assert.strictEqual(spySend.callCount, 0, 'should not call send');
        }
      );
    });
    describe('when an error occurs', () => {
      it('should return failed export result', done => {
        const spans: ReadableLogRecord[] = [];
        spans.push(Object.assign({}, mockedReadableLogRecord));
        spySend.throws({
          code: 100,
          details: 'Test error',
          metadata: {},
          message: 'Non-retryable',
          stack: 'Stack',
        });
        const callbackSpy = sinon.spy();
        collectorExporter.export(spans, callbackSpy);
        setTimeout(() => {
          const returnCode = callbackSpy.args[0][0];
          assert.strictEqual(
            returnCode.code,
            ExportResultCode.FAILED,
            'return value is wrong'
          );
          assert.strictEqual(
            returnCode.error.message,
            'Non-retryable',
            'return error message is wrong'
          );
          assert.strictEqual(spySend.callCount, 1, 'should call send');
          done();
        });
      });
    });
  });
});
