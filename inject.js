// Скрипт для инъекции в страницу (main world)
(function() {
  'use strict';
  
  console.log('[DamuMed JVM] Инжектированный скрипт запущен');
  
  window.__damumedAssignments = [];
  window.__damumedRequestCount = 0;
  
  // Перехват XMLHttpRequest
  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url) {
    // Преобразуем URL в строку (может быть объектом URL)
    this._url = url ? url.toString() : '';
    this._method = method;
    return originalXHROpen.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    var xhr = this;
    
    // Безопасное получение URL как строки
    var urlStr = '';
    try {
      if (xhr._url) {
        urlStr = typeof xhr._url === 'string' ? xhr._url : String(xhr._url);
      }
    } catch (e) {
      urlStr = '';
    }
    
    if (urlStr.indexOf('getMedicalAssignments') !== -1) {
      window.__damumedRequestCount++;
      console.log('[DamuMed JVM] ====== XHR запрос #' + window.__damumedRequestCount + ' ======');
      console.log('[DamuMed JVM] URL:', urlStr);
      
      xhr.addEventListener('load', function() {
        console.log('[DamuMed JVM] XHR ответ, статус:', xhr.status);
        try {
          if (xhr.status === 200 && xhr.responseText) {
            var data = JSON.parse(xhr.responseText);
            console.log('[DamuMed JVM] Получено записей:', data && data.Data ? data.Data.length : 0);
            
            // Отправляем данные в content script через событие
            window.dispatchEvent(new CustomEvent('damumed-assignments', {
              detail: JSON.stringify(data)
            }));
          }
        } catch (e) {
          console.error('[DamuMed JVM] Ошибка парсинга:', e);
        }
      });
    }
    
    return originalXHRSend.apply(this, arguments);
  };
  
  // Перехват fetch
  var originalFetch = window.fetch;
  window.fetch = function(resource, options) {
    var url = typeof resource === 'string' ? resource : resource.url;
    var isAssignmentsRequest = url && url.indexOf('getMedicalAssignments') !== -1;
    
    if (isAssignmentsRequest) {
      console.log('[DamuMed JVM] ====== FETCH запрос ======');
      console.log('[DamuMed JVM] URL:', url);
    }
    
    return originalFetch.apply(this, arguments).then(function(response) {
      if (isAssignmentsRequest) {
        response.clone().json().then(function(data) {
          console.log('[DamuMed JVM] FETCH получено записей:', data && data.Data ? data.Data.length : 0);
          window.dispatchEvent(new CustomEvent('damumed-assignments', {
            detail: JSON.stringify(data)
          }));
        }).catch(function(e) {
          console.error('[DamuMed JVM] Ошибка fetch:', e);
        });
      }
      return response;
    });
  };
  
  console.log('[DamuMed JVM] Перехватчики XHR и Fetch установлены');
})();
