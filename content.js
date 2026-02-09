// Content script для перехвата запросов и извлечения данных
(function() {
  'use strict';
  
  // Получаем recordID из URL
  var urlParams = new URLSearchParams(window.location.search);
  var recordID = urlParams.get('recordID') || 'unknown';
  
  console.log('[DamuMed JVM] Content script загружен на:', window.location.href);
  console.log('[DamuMed JVM] RecordID:', recordID);
  
  // ==================== ИНЖЕКТИРУЕМ СКРИПТ В СТРАНИЦУ ====================
  // Передаём recordID через data-атрибут (не блокируется CSP)
  var script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.dataset.recordId = recordID; // Передаём через data-атрибут
  script.onload = function() {
    console.log('[DamuMed JVM] inject.js загружен');
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  
  console.log('[DamuMed JVM] Скрипт инжектируется в страницу');
  
  // ==================== СЛУШАЕМ СОБЫТИЯ ОТ ИНЖЕКТИРОВАННОГО СКРИПТА ====================
  window.addEventListener('damumed-assignments', function(e) {
    console.log('[DamuMed JVM] Получено событие с назначениями для recordID:', recordID);
    try {
      var response = JSON.parse(e.detail);
      handleAssignmentsResponse(response, recordID);
    } catch(err) {
      console.error('[DamuMed JVM] Ошибка парсинга события:', err);
    }
  });
  
  // Хранилище
  window.__damumedAssignments = [];
  window.__damumedPatient = null;
  
  // ==================== ОБРАБОТКА НАЗНАЧЕНИЙ ====================
  function handleAssignmentsResponse(response, currentRecordID) {
    console.log('[DamuMed JVM] Обработка ответа для recordID:', currentRecordID);
    console.log('[DamuMed JVM] Всего записей в ответе:', response && response.Data ? response.Data.length : 0);
    
    if (response && response.Data && response.Data.length > 0) {
      // Фильтруем только лекарственные средства (MedAssignmentTypeID === 1)
      var drugAssignments = [];
      for (var i = 0; i < response.Data.length; i++) {
        if (response.Data[i].MedAssignmentTypeID === 1) {
          drugAssignments.push(response.Data[i]);
        }
      }
      
      console.log('[DamuMed JVM] Лекарственных назначений в этом ответе:', drugAssignments.length);
      
      // Накапливаем данные - добавляем новые, обновляем существующие
      var existingGuids = {};
      for (var j = 0; j < window.__damumedAssignments.length; j++) {
        var guid = window.__damumedAssignments[j].Guid;
        if (guid) existingGuids[guid] = j;
      }
      
      var addedCount = 0;
      var updatedCount = 0;
      
      for (var k = 0; k < drugAssignments.length; k++) {
        var assignment = drugAssignments[k];
        var guid = assignment.Guid;
        
        if (guid && existingGuids.hasOwnProperty(guid)) {
          // Обновляем существующую запись
          window.__damumedAssignments[existingGuids[guid]] = assignment;
          updatedCount++;
        } else {
          // Добавляем новую
          window.__damumedAssignments.push(assignment);
          addedCount++;
        }
      }
      
      console.log('[DamuMed JVM] Добавлено:', addedCount, 'Обновлено:', updatedCount);
      console.log('[DamuMed JVM] Всего накоплено назначений:', window.__damumedAssignments.length);
      
      // Сохраняем в chrome.storage с ключом по recordID
      var storageKey = 'patient_' + currentRecordID;
      var dataToSave = {};
      dataToSave[storageKey] = {
        assignmentsData: window.__damumedAssignments,
        lastUpdate: new Date().toISOString()
      };
      
      chrome.storage.local.set(dataToSave, function() {
        console.log('[DamuMed JVM] Данные сохранены для', storageKey, 'всего:', window.__damumedAssignments.length);
      });
      
      // Извлекаем отделение и обновляем данные пациента
      if (drugAssignments.length > 0) {
        var recs = drugAssignments[0].MedAssignmentRecs;
        if (recs && recs[0] && recs[0].ExecuteMedicalPost) {
          var dept = recs[0].ExecuteMedicalPost.Name;
          var patientKey = 'patientData_' + currentRecordID;
          chrome.storage.local.get([patientKey], function(result) {
            if (result[patientKey]) {
              result[patientKey].department = dept;
              var updateData = {};
              updateData[patientKey] = result[patientKey];
              chrome.storage.local.set(updateData);
            }
          });
        }
      }
      
      // Уведомляем background
      chrome.runtime.sendMessage({
        type: 'ASSIGNMENTS_UPDATED',
        count: window.__damumedAssignments.length
      }).catch(function() {});
    } else {
      console.log('[DamuMed JVM] Ответ пустой или нет Data');
    }
  }
  
  // ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ПАЦИЕНТА ====================
  function extractPatientData() {
    try {
      var panel = document.querySelector('.panel.panel-default .panel-body');
      if (!panel) return null;
      
      var heading = panel.querySelector('.media-heading');
      if (!heading) return null;
      
      var headingText = heading.textContent.trim();
      // Формат: "540920402630 - ЗЛОБИНА ТАТЬЯНА НИКОЛАЕВНА, 20.09.1954"
      var match = headingText.match(/(\d{12})\s*-\s*([^,]+),\s*(\d{2}\.\d{2}\.\d{4})/);
      
      if (!match) return null;
      
      var patient = {
        iin: match[1],
        fullName: match[2].trim(),
        birthDate: match[3],
        bloodGroup: '',
        roomNumber: '',
        department: '',
        admissionDate: '',
        dischargeDate: '',
        organization: 'НИИ кардиологии'
      };
      
      // Извлечение дополнительных данных
      var mediaBody = panel.querySelector('.media-body');
      if (mediaBody) {
        var html = mediaBody.innerHTML;
        
        var bloodMatch = html.match(/Группа крови:\s*<\/span><span>([^<]+)/);
        if (bloodMatch) patient.bloodGroup = bloodMatch[1].trim();
        
        var roomMatch = html.match(/№<\/span><span>(\d+)/);
        if (roomMatch) patient.roomNumber = roomMatch[1].trim();
        
        var admMatch = html.match(/Дата госпитализации:\s*<\/span><span>([^<]+)/);
        if (admMatch) patient.admissionDate = admMatch[1].trim();
        
        var disMatch = html.match(/Дата выписки:\s*<\/span><span>([^<]+)/);
        if (disMatch) patient.dischargeDate = disMatch[1].trim();
      }
      
      return patient;
    } catch (e) {
      console.error('[DamuMed JVM] Ошибка извлечения данных пациента:', e);
      return null;
    }
  }
  
  // ==================== ИНИЦИАЛИЗАЦИЯ ====================
  function tryExtractPatient() {
    var patient = extractPatientData();
    if (patient) {
      window.__damumedPatient = patient;
      // Сохраняем с ключом по recordID
      var patientKey = 'patientData_' + recordID;
      var saveData = {};
      saveData[patientKey] = patient;
      chrome.storage.local.set(saveData);
      console.log('[DamuMed JVM] Данные пациента сохранены для recordID:', recordID, '-', patient.fullName);
      return true;
    }
    return false;
  }
  
  function init() {
    console.log('[DamuMed JVM] Инициализация, readyState:', document.readyState);
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }
  
  function onReady() {
    console.log('[DamuMed JVM] DOM готов');
    
    // Пробуем извлечь данные пациента с задержкой
    setTimeout(function() {
      if (!tryExtractPatient()) {
        // Если не получилось, пробуем ещё раз
        setTimeout(tryExtractPatient, 2000);
      }
    }, 1000);
  }
  
  // Запуск
  init();
  
})();
