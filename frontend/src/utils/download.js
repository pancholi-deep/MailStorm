// Keep blob URLs alive for the same duration as the original server/local downloads.
export function downloadBlob(blob, filename, { append = false, revokeAfter = 1000 } = {}) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  if (append) document.body.appendChild(anchor);
  anchor.click();
  if (append) document.body.removeChild(anchor);
  if (revokeAfter) setTimeout(() => URL.revokeObjectURL(url), revokeAfter);
  else URL.revokeObjectURL(url);
}

export function downloadLocalLogs(logs) {
  if (!logs.length) return;
  downloadBlob(new Blob([logs.join('\n')], { type: 'text/plain' }), 'email_logs.txt', {
    append: true,
    revokeAfter: 0,
  });
}
