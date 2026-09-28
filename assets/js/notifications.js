(function () {
  let activeConfirm = null;
  let toastSequence = 0;

  function ensureStyles() {
    if (document.getElementById('app-feedback-styles')) return;
    const style = document.createElement('style');
    style.id = 'app-feedback-styles';
    style.textContent = `
      .app-toast-stack{position:fixed;top:max(14px,env(safe-area-inset-top));right:14px;z-index:12000;display:grid;gap:9px;width:min(390px,calc(100vw - 28px));pointer-events:none}
      .app-toast{display:flex;align-items:flex-start;gap:10px;padding:13px 14px;background:#fff;border:1px solid #e2e8f0;border-left:4px solid #25845a;border-radius:8px;box-shadow:0 8px 24px rgba(20,35,30,.18);color:#17241e;font:600 14px/1.45 system-ui,sans-serif;pointer-events:auto;animation:appToastIn .18s ease-out}
      .app-toast.error{border-left-color:#c62828}.app-toast.info{border-left-color:#236f9d}
      .app-toast-icon{flex:0 0 auto}.app-toast-message{flex:1;overflow-wrap:anywhere}.app-toast-close{border:0;background:transparent;color:#64748b;font:inherit;font-size:20px;line-height:1;cursor:pointer;padding:0 2px}
      .app-toast-leave{animation:appToastOut .2s ease-in forwards}
      .app-confirm-backdrop{position:fixed;inset:0;z-index:12100;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(13,25,21,.5);backdrop-filter:blur(2px)}
      .app-confirm-panel{width:min(420px,100%);max-height:calc(100dvh - 36px);overflow:auto;background:#fff;border-radius:12px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:system-ui,sans-serif;color:#17241e}
      .app-confirm-title{margin:0 0 8px;font-size:18px;line-height:1.3}.app-confirm-message{margin:0;color:#52615a;font-size:14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
      .app-confirm-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.app-confirm-button{min-height:42px;padding:9px 15px;border:1px solid #ccd5d0;border-radius:8px;background:#fff;color:#26362f;font:700 14px system-ui,sans-serif;cursor:pointer}.app-confirm-button.primary{border-color:#217a55;background:#217a55;color:#fff}.app-confirm-button.danger{border-color:#b42318;background:#b42318;color:#fff}
      @keyframes appToastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}@keyframes appToastOut{to{opacity:0;transform:translateX(10px)}}
      @media(prefers-reduced-motion:reduce){.app-toast,.app-toast-leave{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function showAppToast(message, type = 'success') {
    ensureStyles();
    let stack = document.querySelector('.app-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'app-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      stack.setAttribute('aria-relevant', 'additions');
      document.body.appendChild(stack);
    }
    const icons = { success: '\u2713', error: '\u26a0', info: '\u2139' };
    const toast = document.createElement('div');
    toast.className = 'app-toast ' + (['success', 'error', 'info'].includes(type) ? type : 'success');
    const icon = document.createElement('span');
    icon.className = 'app-toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = icons[type] || icons.success;
    const text = document.createElement('span');
    text.className = 'app-toast-message';
    text.textContent = String(message ?? '');
    const close = document.createElement('button');
    close.className = 'app-toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '\u00d7';
    close.addEventListener('click', () => toast.remove());
    toast.append(icon, text, close);
    stack.appendChild(toast);
    const id = ++toastSequence;
    window.setTimeout(() => {
      if (!toast.isConnected) return;
      toast.classList.add('app-toast-leave');
      window.setTimeout(() => {
        toast.remove();
        if (id === toastSequence && stack.isConnected && !stack.children.length) stack.remove();
      }, 220);
    }, 4000);
  }

  function showAppConfirm(message, options = {}) {
    ensureStyles();
    if (activeConfirm) activeConfirm(false);
    return new Promise(resolve => {
      const finish = answer => {
        if (!backdrop.isConnected) return;
        document.removeEventListener('keydown', onKeydown);
        backdrop.remove();
        activeConfirm = null;
        resolve(answer);
      };
      const backdrop = document.createElement('div');
      backdrop.className = 'app-confirm-backdrop';
      backdrop.setAttribute('role', 'presentation');
      const dialog = document.createElement('section');
      dialog.className = 'app-confirm-panel';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'appConfirmTitle');
      dialog.setAttribute('aria-describedby', 'appConfirmMessage');
      const title = document.createElement('h2');
      title.className = 'app-confirm-title';
      title.id = 'appConfirmTitle';
      title.textContent = options.title || 'Please confirm';
      const body = document.createElement('p');
      body.className = 'app-confirm-message';
      body.id = 'appConfirmMessage';
      body.textContent = String(message ?? '');
      const actions = document.createElement('div');
      actions.className = 'app-confirm-actions';
      const cancel = document.createElement('button');
      cancel.className = 'app-confirm-button';
      cancel.type = 'button';
      cancel.textContent = options.cancelText || 'Cancel';
      cancel.addEventListener('click', () => finish(false));
      const confirm = document.createElement('button');
      confirm.className = 'app-confirm-button ' + (options.danger ? 'danger' : 'primary');
      confirm.type = 'button';
      confirm.textContent = options.confirmText || 'Continue';
      confirm.addEventListener('click', () => finish(true));
      actions.append(cancel, confirm);
      dialog.append(title, body, actions);
      backdrop.appendChild(dialog);
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop) finish(false);
      });
      const onKeydown = event => {
        if (event.key === 'Escape') finish(false);
        if (event.key === 'Tab') {
          event.preventDefault();
          (document.activeElement === cancel ? confirm : cancel).focus();
        }
      };
      activeConfirm = finish;
      document.addEventListener('keydown', onKeydown);
      document.body.appendChild(backdrop);
      cancel.focus();
    });
  }

  window.showAppToast = showAppToast;
  window.showAppConfirm = showAppConfirm;
})();
