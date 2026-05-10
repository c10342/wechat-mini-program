import {
  pageStack,
  worker,
  ANIM_DURATION,
} from '../state.js';
import {
  getBounds,
  setViewBounds,
  showPage,
  hidePage,
  destroyPage,
  updateNavBar,
} from '../pages/index.js';

const ipcRenderer = window.containerBridge;

export function animateSlideIn(newPage, oldPage, pageConfig) {
  const screenWidth = window.innerWidth;

  setViewBounds(newPage, getBounds(screenWidth));
  showPage(newPage);
  if (oldPage) {
    showPage(oldPage);
  }

  let startTime = null;
  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / ANIM_DURATION, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const offset = screenWidth * (1 - eased);
    setViewBounds(newPage, getBounds(offset));
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      setViewBounds(newPage, getBounds(0));
      updateNavBar(pageConfig);
    }
  }
  requestAnimationFrame(step);
}

export function animateSlideOut(topPage, bottomPage, callback) {
  const screenWidth = window.innerWidth;
  showPage(topPage);
  if (bottomPage) {
    showPage(bottomPage);
  }

  let startTime = null;
  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / ANIM_DURATION, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const offset = screenWidth * eased;
    setViewBounds(topPage, getBounds(offset));
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      hidePage(topPage);
      destroyPage(topPage);
      if (bottomPage) {
        setViewBounds(bottomPage, getBounds(0));
      }
      if (callback) callback();
    }
  }
  requestAnimationFrame(step);
}

export function handleNavigateBack(delta) {
  if (pageStack.length <= 1) return;
  delta = delta || 1;

  const topPage = pageStack.pop();
  const bottomPage = pageStack[pageStack.length - 1];

  worker().postMessage({ type: 'notifyPageHide', data: { path: topPage } });

  animateSlideOut(topPage, bottomPage, () => {
    if (bottomPage) {
      const configPath = bottomPage + '/index.json';
      ipcRenderer.invoke('read-file', configPath).then((result) => {
        let pc = {};
        if (result.success) {
          try {
            pc = JSON.parse(result.content);
          } catch (e) {}
        }
        updateNavBar(pc);
      });

      worker().postMessage({
        type: 'notifyPageShow',
        data: { path: bottomPage },
      });
    }
  });
}
