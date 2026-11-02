// Service worker: opens the side panel and handles the right-click menu.
import { extractArticleInPage } from './lib/extract.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'bogard-send-page',
      title: '보가드 SEO 비서로 이 기사 보내기',
      contexts: ['page', 'link'],
    });
    chrome.contextMenus.create({
      id: 'bogard-send-selection',
      title: '보가드 SEO 비서로 선택한 내용 보내기',
      contexts: ['selection'],
    });
  });
});

chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  // Must be called synchronously inside the user gesture.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});

  (async () => {
    let payload;
    if (info.menuItemId === 'bogard-send-selection' && info.selectionText) {
      payload = { text: info.selectionText, pageUrl: info.pageUrl || tab.url || '', pageTitle: tab.title || '' };
    } else if (info.linkUrl) {
      payload = { text: info.linkUrl, pageUrl: '', pageTitle: '' };
    } else {
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractArticleInPage });
        const r = res?.result || {};
        payload = { text: r.selection || r.text || '', pageUrl: r.pageUrl || tab.url || '', pageTitle: r.pageTitle || tab.title || '', publishedAt: r.publishedAt || '' };
      } catch {
        payload = { text: tab.url || '', pageUrl: tab.url || '', pageTitle: tab.title || '' };
      }
    }
    await chrome.storage.local.set({ pendingInput: { ...payload, at: Date.now() } });
  })();
});
