/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import {
  GcpTraceExporter,
  GcpMetricExporter,
  GcpLogExporter,
} from './gcp-exporters.js';

const mockLogEntry = { test: 'entry' };
const mockLogWrite = vi.fn().mockResolvedValue(undefined);
const mockLog = {
  entry: vi.fn().mockReturnValue(mockLogEntry),
  write: mockLogWrite,
};
const mockLogging = {
  projectId: 'test-project',
  log: vi.fn().mockReturnValue(mockLog),
};

vi.mock('@google-cloud/opentelemetry-cloud-trace-exporter', () => ({
  TraceExporter: vi.fn().mockImplementation(() => ({
    export: vi.fn(),
    shutdown: vi.fn(),
    forceFlush: vi.fn(),
  })),
}));

vi.mock('@google-cloud/opentelemetry-cloud-monitoring-exporter', () => ({
  MetricExporter: vi.fn().mockImplementation(() => ({
    export: vi.fn(),
    shutdown: vi.fn(),
    forceFlush: vi.fn(),
  })),
}));

vi.mock('@google-cloud/logging', () => ({
  Logging: vi.fn().mockImplementation(() => mockLogging),
}));

describe('GCP Exporters', () => {
  describe('GcpTraceExporter', () => {
    it('should create a trace exporter with correct configuration', () => {
      const exporter = new GcpTraceExporter('test-project');
      expect(exporter).toBeDefined();
    });

    it('should create a trace exporter without project ID', () => {
      const exporter = new GcpTraceExporter();
      expect(exporter).toBeDefined();
    });
  });

  describe('GcpMetricExporter', () => {
    it('should create a metric exporter with correct configuration', () => {
      const exporter = new GcpMetricExporter('test-project');
      expect(exporter).toBeDefined();
    });

    it('should create a metric exporter without project ID', () => {
      const exporter = new GcpMetricExporter();
      expect(exporter).toBeDefined();
    });
  });

  describe('GcpLogExporter', () => {
    let exporter: GcpLogExporter;

    beforeEach(() => {
      vi.clearAllMocks();
      exporter = new GcpLogExporter('test-project');
    });

    describe('constructor', () => {
      it('should create a log exporter with project ID', () => {
        expect(exporter).toBeDefined();
        expect(mockLogging.log).toHaveBeenCalledWith('gemini_cli');
      });

      it('should create a log exporter without project ID', () => {
        const exporterNoProject = new GcpLogExporter();
        expect(exporterNoProject).toBeDefined();
      });
    });

    describe('export', () => {
      it('should export logs successfully', async () => {
        const mockLogRecords: ReadableLogRecord[] = [
          {
            hrTime: [1234567890, 123456789],
            hrTimeObserved: [1234567890, 123456789],
            severityNumber: 9,
            severityText: 'INFO',
            body: 'Test log message',
            attributes: {
              'session.id': 'test-session',
              'custom.attribute': 'value',
            },
            resource: {
              attributes: {
                'service.name': 'test-service',
              },
            },
          } as any,
        ];

        const callback = vi.fn();

        exporter.export(mockLogRecords, callback);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(mockLog.entry).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'INFO',
            timestamp: expect.any(Date),
            resource: {
              type: 'global',
              labels: {
                project_id: 'test-project',
              },
            },
          }),
          expect.objectContaining({
            message: 'Test log message',
            session_id: 'test-session',
            'custom.attribute': 'value',
            'service.name': 'test-service',
          }),
        );

        expect(mockLog.write).toHaveBeenCalledWith([mockLogEntry]);
        expect(callback).toHaveBeenCalledWith({
          code: ExportResultCode.SUCCESS,
        });
      });

      it('should handle export failures', async () => {
        const mockLogRecords: ReadableLogRecord[] = [
          {
            hrTime: [1234567890, 123456789],
            hrTimeObserved: [1234567890, 123456789],
            body: 'Test log message',
          } as any,
        ];

        const error = new Error('Write failed');
        mockLogWrite.mockRejectedValueOnce(error);

        const callback = vi.fn();

        exporter.export(mockLogRecords, callback);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(callback).toHaveBeenCalledWith({
          code: ExportResultCode.FAILED,
          error,
        });
      });

      it('should handle synchronous errors', () => {
        const mockLogRecords: ReadableLogRecord[] = [
          {
            hrTime: [1234567890, 123456789],
            hrTimeObserved: [1234567890, 123456789],
            body: 'Test log message',
          } as any,
        ];

        mockLog.entry.mockImplementation(() => {
          throw new Error('Entry creation failed');
        });

        const callback = vi.fn();

        exporter.export(mockLogRecords, callback);

        expect(callback).toHaveBeenCalledWith({
          code: ExportResultCode.FAILED,
          error: expect.any(Error),
        });
      });
    });

    describe('severity mapping', () => {
      it('should map OpenTelemetry severity numbers to Cloud Logging levels', () => {
        const testCases = [
          { severityNumber: undefined, expected: 'DEFAULT' },
          { severityNumber: 1, expected: 'DEFAULT' },
          { severityNumber: 5, expected: 'DEBUG' },
          { severityNumber: 9, expected: 'INFO' },
          { severityNumber: 13, expected: 'WARNING' },
          { severityNumber: 17, expected: 'ERROR' },
          { severityNumber: 21, expected: 'CRITICAL' },
          { severityNumber: 25, expected: 'CRITICAL' },
        ];

        testCases.forEach(({ severityNumber, expected }) => {
          const mockLogRecords: ReadableLogRecord[] = [
            {
              hrTime: [1234567890, 123456789],
              hrTimeObserved: [1234567890, 123456789],
              severityNumber,
              body: 'Test message',
            } as any,
          ];

          const callback = vi.fn();
          exporter.export(mockLogRecords, callback);

          expect(mockLog.entry).toHaveBeenCalledWith(
            expect.objectContaining({
              severity: expected,
            }),
            expect.any(Object),
          );

          mockLog.entry.mockClear();
        });
      });
    });

    describe('forceFlush', () => {
      it('should resolve immediately', async () => {
        await expect(exporter.forceFlush()).resolves.toBeUndefined();
      });
    });

    describe('shutdown', () => {
      it('should resolve immediately', async () => {
        await expect(exporter.shutdown()).resolves.toBeUndefined();
      });
    });
  });
});
