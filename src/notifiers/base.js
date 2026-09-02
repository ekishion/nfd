// ==============================================================================
// src/notifiers/base.js - Notification Message & Payload Builder
// ==============================================================================

export function formatTime() {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
  return utc8.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Build unified notification data object
 * @param {'guest_message' | 'security_alert'} event
 * @param {object} payload
 */
export function buildNotificationContent(event, payload = {}) {
  const time = formatTime();

  if (event === 'security_alert') {
    const title = `[NFD 拦截报警] ${payload.reason || '安全事件'}`;
    const lines = [
      `🚨 **安全拦截报警**`,
      `- **触发类型**: ${payload.reason || '未知'}`,
      `- **客人标识**: ${payload.senderName || '未知'} (UID: ${payload.senderId || '未知'})`,
      `- **触发详情**: ${payload.detail || '-'}`,
      `- **拦截时间**: ${time}`,
    ];
    if (payload.snippet) {
      lines.push(`- **内容摘要**: ${payload.snippet}`);
    }
    return {
      title,
      summary: `${payload.reason || '安全拦截'}: ${payload.senderName || payload.senderId || '未知'}`,
      content: lines.join('\n'),
      markdown: lines.join('\n'),
      event,
      payload,
    };
  }

  const guest = payload.senderName || `客人 ${payload.senderId || ''}`.trim();
  const count = payload.messageCount || 1;
  const title = `[NFD 客人新留言] 来自 ${guest}`;
  const lines = [
    `📨 **收到新留言** (${count} 条)`,
    `- **发送者**: ${guest} (UID: ${payload.senderId || '未知'})`,
    `- **接收时间**: ${time}`,
    `- **消息内容**:`,
    payload.text || '(多媒体/文件附件)',
  ];

  return {
    title,
    summary: `新留言 (${count}条): ${payload.text ? payload.text.substring(0, 50) : '附件消息'}`,
    content: lines.join('\n'),
    markdown: lines.join('\n'),
    event,
    payload,
  };
}
