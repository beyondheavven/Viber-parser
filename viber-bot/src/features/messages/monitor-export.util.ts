import type { MonitoredMessageDto } from './dto/monitored-message.dto.js';

export type MonitorExportFormat = 'json' | 'jsonl' | 'csv';

export interface MonitorExportResult {
  filename: string;
  mime: string;
  body: string;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_HEADERS = [
  'id',
  'date',
  'conversationId',
  'conversationName',
  'senderName',
  'senderMemberId',
  'body',
  'attachedPhone',
  'phoneSource',
  'hasPhoneInText',
  'hasMedia',
  'mediaUris',
  'outgoing',
] as const;

export function formatMonitoredExport(
  messages: readonly MonitoredMessageDto[],
  format: MonitorExportFormat,
  exportedAt = new Date(),
): MonitorExportResult {
  const stamp = exportedAt.toISOString().replace(/[:.]/g, '-');
  if (format === 'csv') {
    const rows = messages.map((message) =>
      [
        message.id,
        message.date,
        message.conversationId,
        message.conversationName ?? '',
        message.senderName ?? '',
        message.senderMemberId ?? '',
        message.body ?? '',
        message.attachedPhone ?? '',
        message.phoneSource,
        message.hasPhoneInText ? 'true' : 'false',
        message.hasMedia === true ? 'true' : 'false',
        (message.mediaUris ?? []).join(' | '),
        message.outgoing ? 'true' : 'false',
      ]
        .map(escapeCsvCell)
        .join(','),
    );
    return {
      filename: `monitored-messages-${stamp}.csv`,
      mime: 'text/csv; charset=utf-8',
      body: `\uFEFF${[CSV_HEADERS.join(','), ...rows].join('\r\n')}`,
    };
  }

  if (format === 'jsonl') {
    return {
      filename: `monitored-messages-${stamp}.jsonl`,
      mime: 'application/x-ndjson; charset=utf-8',
      body: messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length > 0 ? '\n' : ''),
    };
  }

  return {
    filename: `monitored-messages-${stamp}.json`,
    mime: 'application/json; charset=utf-8',
    body: `${JSON.stringify({ exportedAt: exportedAt.toISOString(), count: messages.length, messages }, null, 2)}\n`,
  };
}
