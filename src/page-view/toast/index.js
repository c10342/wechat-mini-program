export function showToast(title, duration) {
  const existing = document.getElementById('mp-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'mp-toast';
  toast.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:rgba(0,0,0,0.7);color:#fff;padding:12px 24px;border-radius:8px;' +
    'font-size:14px;z-index:9999;text-align:center;max-width:70%;';
  toast.textContent = title || '';
  document.body.appendChild(toast);

  setTimeout(() => { toast.remove(); }, duration || 1500);
}
