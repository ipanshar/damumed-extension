// Background service worker для DamuMed JVM Extension

console.log('[DamuMed JVM] Background script загружен');

// Обработка сообщений от content script и popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[DamuMed JVM] Получено сообщение:', message);
  
  switch (message.type) {
    case 'ASSIGNMENTS_UPDATED':
      // Обновляем badge с количеством назначений
      chrome.action.setBadgeText({ 
        text: message.count > 0 ? String(message.count) : '' 
      });
      chrome.action.setBadgeBackgroundColor({ color: '#48bb78' });
      break;
      
    case 'GET_DATA':
      // Возвращаем сохраненные данные
      chrome.storage.local.get(['patientData', 'assignmentsData'], (result) => {
        sendResponse(result);
      });
      return true; // Асинхронный ответ
      
    case 'CLEAR_DATA':
      // Очищаем данные
      chrome.storage.local.clear(() => {
        chrome.action.setBadgeText({ text: '' });
        sendResponse({ success: true });
      });
      return true;
  }
});

// Обработка установки расширения
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[DamuMed JVM] Расширение установлено');
  } else if (details.reason === 'update') {
    console.log('[DamuMed JVM] Расширение обновлено');
  }
});

// Обработка активации вкладки
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId).then((tab) => {
    if (tab && tab.url && tab.url.includes('dmed.kz')) {
      // Загружаем количество назначений
      chrome.storage.local.get(['assignmentsData'], (result) => {
        const count = result.assignmentsData?.length || 0;
        chrome.action.setBadgeText({ 
          text: count > 0 ? String(count) : '' 
        });
      });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }).catch(() => {
    // Игнорируем ошибки доступа к вкладке
  });
});

// Обработка обновления вкладки
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('/Inspection/Inspection')) {
    console.log('[DamuMed JVM] Открыта страница осмотра');
  }
});
