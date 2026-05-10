let compEventBound = false;

export function sendEvent(eventName, eventPayload) {
  window.pageBridge.sendEvent(eventName, eventPayload);
}

export function ensureCompEventListener() {
  if (compEventBound) return;
  compEventBound = true;
  const pageRoot = document.getElementById('page-root');
  if (pageRoot) {
    pageRoot.addEventListener('comp-event', (e) => {
      const detail = e.detail;
      sendEvent(detail.eventName, {
        type: detail.type || 'tap',
        target: {
          dataset: {
            compName: detail.compName,
          },
        },
      });
    });
  }
}

export function bindPageEvents(container) {
  container.querySelectorAll('[bindtap]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      const eventName = el.getAttribute('bindtap');
      sendEvent(eventName, {
        type: 'tap',
        target: { dataset: Object.assign({}, el.dataset) },
      });
    });
  });

  container.querySelectorAll('[catchtap]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const eventName = el.getAttribute('catchtap');
      sendEvent(eventName, {
        type: 'tap',
        target: { dataset: Object.assign({}, el.dataset) },
      });
    });
  });

  container.querySelectorAll('[bindinput]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const eventName = el.getAttribute('bindinput');
      sendEvent(eventName, {
        type: 'input',
        value: e.target.value,
        target: { dataset: Object.assign({}, el.dataset) },
      });
    });
  });
}
