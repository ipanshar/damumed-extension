// Состояние приложения
let patientData = null;
let assignmentsData = [];
let selectedAssignments = [];

// DOM элементы
const elements = {
  status: document.getElementById('status'),
  iin: document.getElementById('iin'),
  fullName: document.getElementById('fullName'),
  birthDate: document.getElementById('birthDate'),
  bloodGroup: document.getElementById('bloodGroup'),
  roomNumber: document.getElementById('roomNumber'),
  department: document.getElementById('department'),
  admissionDate: document.getElementById('admissionDate'),
  dischargeDate: document.getElementById('dischargeDate'),
  organization: document.getElementById('organization'),
  assignmentsCount: document.getElementById('assignmentsCount'),
  assignmentsList: document.getElementById('assignmentsList'),
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  onlyPending: document.getElementById('onlyPending'),
  loadDataBtn: document.getElementById('loadDataBtn'),
  exportOcsBtn: document.getElementById('exportOcsBtn'),
  copyBtn: document.getElementById('copyBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  deselectAllBtn: document.getElementById('deselectAllBtn'),
  previewSection: document.getElementById('previewSection'),
  ocsPreview: document.getElementById('ocsPreview'),
  fetchApiBtn: document.getElementById('fetchApiBtn'),
  patientRegId: document.getElementById('patientRegId'),
  apiStatus: document.getElementById('apiStatus')
};

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  // Загрузка сохраненных данных
  loadStoredData();
  
  // Обработчики событий
  elements.loadDataBtn.addEventListener('click', loadDataFromPage);
  elements.exportOcsBtn.addEventListener('click', exportToOcs);
  elements.copyBtn.addEventListener('click', copyToClipboard);
  elements.refreshBtn.addEventListener('click', loadDataFromPage);
  elements.onlyPending.addEventListener('change', renderAssignments);
  elements.dateFrom.addEventListener('change', renderAssignments);
  elements.dateTo.addEventListener('change', renderAssignments);
  elements.selectAllBtn.addEventListener('click', selectAll);
  elements.deselectAllBtn.addEventListener('click', deselectAll);
  elements.fetchApiBtn.addEventListener('click', fetchFromApi);
});

// Показать статус
function showStatus(message, type = 'info') {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`;
  
  if (type === 'success') {
    setTimeout(() => {
      elements.status.style.display = 'none';
    }, 3000);
  }
}

// Получение recordID из URL текущей вкладки
async function getCurrentRecordID() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      return url.searchParams.get('recordID') || 'unknown';
    }
  } catch (e) {
    console.error('Ошибка получения recordID:', e);
  }
  return 'unknown';
}

// Загрузка сохраненных данных из storage
async function loadStoredData() {
  try {
    const recordID = await getCurrentRecordID();
    const storageKey = `patient_${recordID}`;
    
    console.log('[DamuMed JVM Popup] Загрузка данных для recordID:', recordID);
    
    const data = await chrome.storage.local.get([storageKey, `patientData_${recordID}`]);
    
    // Загружаем данные пациента
    if (data[`patientData_${recordID}`]) {
      patientData = data[`patientData_${recordID}`];
      fillPatientForm(patientData);
    }
    
    // Загружаем назначения
    if (data[storageKey] && data[storageKey].assignmentsData && data[storageKey].assignmentsData.length > 0) {
      assignmentsData = data[storageKey].assignmentsData;
      autoDetectDateRange();
      autoFillPatientRegId(); // Автозаполнение ID госпитализации
      renderAssignments();
      enableExportButtons();
      showStatus(`Данные загружены для пациента (ID: ${recordID})`, 'info');
    } else {
      showStatus(`Нет данных для пациента (ID: ${recordID}). Нажмите "Обновить"`, 'info');
    }
  } catch (error) {
    console.error('Ошибка загрузки данных:', error);
  }
}

// Автозаполнение PatientAdmissionRegisterID из перехваченных данных
function autoFillPatientRegId() {
  if (!assignmentsData || assignmentsData.length === 0) return;
  
  // Берём ID из первого назначения
  const firstAssignment = assignmentsData[0];
  if (firstAssignment && firstAssignment.PatientAdmissionRegisterID) {
    elements.patientRegId.value = firstAssignment.PatientAdmissionRegisterID;
    console.log('[DamuMed JVM] Автозаполнен PatientAdmissionRegisterID:', firstAssignment.PatientAdmissionRegisterID);
  }
}

// Автоопределение периода дат из данных
function autoDetectDateRange() {
  if (!assignmentsData || assignmentsData.length === 0) return;
  
  let minDate = null;
  let maxDate = null;
  
  assignmentsData.forEach(assignment => {
    if (assignment.MedAssignmentTypeID !== 1) return;
    
    const recs = assignment.MedAssignmentRecs || [];
    recs.forEach(rec => {
      if (rec.AppointDateTime) {
        const date = rec.AppointDateTime.split('T')[0];
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    });
    
    // Также проверяем BeginAssignmentDate и EndAssignmentDate
    if (assignment.BeginAssignmentDate) {
      const date = assignment.BeginAssignmentDate.split('T')[0];
      if (!minDate || date < minDate) minDate = date;
    }
    if (assignment.EndAssignmentDate) {
      const date = assignment.EndAssignmentDate.split('T')[0];
      if (!maxDate || date > maxDate) maxDate = date;
    }
  });
  
  if (minDate) elements.dateFrom.value = minDate;
  if (maxDate) elements.dateTo.value = maxDate;
  
  console.log('[DamuMed JVM] Автоопределен период:', minDate, '-', maxDate);
}

// Загрузка данных со страницы
async function loadDataFromPage() {
  showStatus('Загрузка данных...', 'info');
  elements.loadDataBtn.disabled = true;
  
  try {
    // Получаем текущую вкладку
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('dmed.kz')) {
      showStatus('Откройте страницу DamuMed для загрузки данных', 'error');
      elements.loadDataBtn.disabled = false;
      return;
    }
    
    // Получаем recordID из URL
    const recordID = await getCurrentRecordID();
    const storageKey = `patient_${recordID}`;
    const patientDataKey = `patientData_${recordID}`;
    
    console.log('[DamuMed JVM Popup] Загрузка данных для recordID:', recordID);
    
    // Выполняем скрипт на странице
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageData
    });
    
    if (results && results[0] && results[0].result) {
      const data = results[0].result;
      
      if (data.patient) {
        patientData = data.patient;
        fillPatientForm(patientData);
        // Сохраняем с ключом по recordID
        const patientSaveData = {};
        patientSaveData[patientDataKey] = patientData;
        await chrome.storage.local.set(patientSaveData);
      }
      
      if (data.assignments && data.assignments.length > 0) {
        assignmentsData = data.assignments;
        // Сохраняем с ключом по recordID
        const assignmentsSaveData = {};
        assignmentsSaveData[storageKey] = {
          assignmentsData: assignmentsData,
          lastUpdate: new Date().toISOString()
        };
        await chrome.storage.local.set(assignmentsSaveData);
        autoDetectDateRange();
        renderAssignments();
        enableExportButtons();
        showStatus(`Загружено ${assignmentsData.length} назначений (ID: ${recordID})`, 'success');
      } else {
        showStatus('Назначения не найдены. Откройте страницу пациента.', 'error');
      }
    } else {
      showStatus('Не удалось получить данные со страницы', 'error');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    showStatus(`Ошибка: ${error.message}`, 'error');
  }
  
  elements.loadDataBtn.disabled = false;
}

// Функция извлечения данных со страницы (выполняется в контексте страницы)
function extractPageData() {
  const result = {
    patient: null,
    assignments: []
  };
  
  // Извлечение данных пациента
  try {
    const panel = document.querySelector('.panel.panel-default .panel-body');
    if (panel) {
      const heading = panel.querySelector('.media-heading');
      if (heading) {
        const headingText = heading.textContent.trim();
        // Формат: "540920402630 - ЗЛОБИНА ТАТЬЯНА НИКОЛАЕВНА, 20.09.1954"
        const match = headingText.match(/(\d{12})\s*-\s*([^,]+),\s*(\d{2}\.\d{2}\.\d{4})/);
        if (match) {
          result.patient = {
            iin: match[1],
            fullName: match[2].trim(),
            birthDate: match[3]
          };
        }
      }
      
      // Извлечение дополнительных данных
      const spans = panel.querySelectorAll('.media-body span');
      let currentLabel = '';
      
      spans.forEach(span => {
        const text = span.textContent.trim();
        const prevSibling = span.previousElementSibling;
        
        if (prevSibling && prevSibling.classList.contains('text-muted')) {
          currentLabel = prevSibling.textContent.trim();
        }
        
        if (result.patient) {
          if (currentLabel.includes('Группа крови')) {
            result.patient.bloodGroup = text;
          } else if (currentLabel === '№') {
            result.patient.roomNumber = text.trim();
          } else if (currentLabel.includes('Дата госпитализации')) {
            result.patient.admissionDate = text;
          } else if (currentLabel.includes('Дата выписки')) {
            result.patient.dischargeDate = text;
          }
        }
      });
      
      // Отделение из ExecuteMedicalPost или из заголовка
      if (result.patient) {
        result.patient.department = '';
        result.patient.organization = 'НИИ кардиологии';
      }
    }
  } catch (e) {
    console.error('Ошибка парсинга пациента:', e);
  }
  
  // Попытка получить сохраненные назначения из window
  if (window.__damumedAssignments) {
    result.assignments = window.__damumedAssignments;
  }
  
  return result;
}

// Заполнение формы данными пациента
function fillPatientForm(patient) {
  if (!patient) return;
  
  elements.iin.value = patient.iin || '';
  elements.fullName.value = patient.fullName || '';
  elements.birthDate.value = patient.birthDate || '';
  elements.bloodGroup.value = patient.bloodGroup || '';
  elements.roomNumber.value = patient.roomNumber || '';
  elements.department.value = patient.department || '';
  elements.admissionDate.value = patient.admissionDate || '';
  elements.dischargeDate.value = patient.dischargeDate || '';
  elements.organization.value = patient.organization || 'НИИ кардиологии';
}

// Отрисовка списка назначений
function renderAssignments() {
  const onlyPending = elements.onlyPending.checked;
  const dateFrom = elements.dateFrom.value;
  const dateTo = elements.dateTo.value;
  
  // Фильтрация только MedAssignmentTypeID === 1 (Лекарственные средства)
  let filtered = assignmentsData.filter(a => a.MedAssignmentTypeID === 1);
  
  if (filtered.length === 0) {
    elements.assignmentsList.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <div>Нет назначений для отображения</div>
      </div>
    `;
    elements.assignmentsCount.textContent = 'Назначений: 0';
    return;
  }
  
  // Сбор всех записей назначений
  let allRecs = [];
  
  filtered.forEach(assignment => {
    const drugName = assignment.MedAssignmentName || 
                     (assignment.MedAssignmentDrugs && assignment.MedAssignmentDrugs[0] 
                       ? assignment.MedAssignmentDrugs[0].DrugAssignment?.Name : 'Неизвестно');
    
    const recs = assignment.MedAssignmentRecs || [];
    
    recs.forEach(rec => {
      // Фильтр по периоду дат
      const appointDate = rec.AppointDateTime ? rec.AppointDateTime.split('T')[0] : '';
      if (dateFrom && appointDate < dateFrom) return;
      if (dateTo && appointDate > dateTo) return;
      
      // Фильтр по статусу
      const isCompleted = rec.MedAssignmentStatusID === 3;
      if (onlyPending && isCompleted) return;
      
      // Извлекаем DrugID из MedAssignmentExecutionDrugs
      let drugId = '';
      let drugFullName = drugName;
      let dosage = '';
      let manufacturer = '';
      
      if (rec.MedAssignmentExecutionDrugs && rec.MedAssignmentExecutionDrugs.length > 0) {
        const execDrug = rec.MedAssignmentExecutionDrugs[0];
        drugId = execDrug.DrugID || '';
        if (execDrug.Drug) {
          drugFullName = execDrug.Drug.FullNameRU || execDrug.Drug.FullName || execDrug.Drug.NameRU || drugName;
          dosage = execDrug.Drug.Dosage || '';
          manufacturer = execDrug.Drug.Manufacturer || '';
        }
      }
      
      allRecs.push({
        assignmentId: assignment.Guid || assignment.ID,
        recId: rec.ID,
        drugId: drugId,
        drugName: drugName,
        drugFullName: drugFullName,
        dosage: dosage,
        manufacturer: manufacturer,
        appointDateTime: rec.AppointDateTime,
        appointDateStr: rec.AppointDateTimeStr,
        status: rec.MedAssignmentStatusID,
        statusName: rec.MedAssignmentStatus?.Name || (isCompleted ? 'Выполнено' : 'Назначено'),
        department: rec.ExecuteMedicalPost?.Name || patientData?.department || '',
        beginDate: assignment.BeginAssignmentDateStr,
        endDate: assignment.EndAssignmentDateStr,
        beginTime: assignment.BeginAssignmentTimeStr
      });
    });
  });
  
  // Сортировка по времени
  allRecs.sort((a, b) => {
    const timeA = a.appointDateTime || '';
    const timeB = b.appointDateTime || '';
    return timeA.localeCompare(timeB);
  });
  
  elements.assignmentsCount.textContent = `Назначений: ${allRecs.length}`;
  
  if (allRecs.length === 0) {
    elements.assignmentsList.innerHTML = `
      <div class="empty-state">
        <div class="icon">✅</div>
        <div>Все назначения выполнены</div>
      </div>
    `;
    return;
  }
  
  // Отрисовка элементов
  elements.assignmentsList.innerHTML = allRecs.map((rec, index) => {
    const time = rec.appointDateTime ? 
      new Date(rec.appointDateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 
      rec.beginTime || '--:--';
    const date = rec.appointDateTime ? 
      new Date(rec.appointDateTime).toLocaleDateString('ru-RU') : 
      rec.beginDate || '';
    const isCompleted = rec.status === 3;
    
    return `
      <div class="assignment-item">
        <input type="checkbox" 
               data-index="${index}" 
               ${!isCompleted ? 'checked' : ''}>
        <span class="drug-name" title="${rec.drugName}">${truncate(rec.drugName, 30)}</span>
        <span class="drug-time">${time}</span>
        <span class="drug-date">${date}</span>
        <span class="drug-status ${isCompleted ? 'completed' : 'pending'}">${rec.statusName}</span>
      </div>
    `;
  }).join('');
  
  // Добавляем обработчики событий для чекбоксов
  document.querySelectorAll('.assignment-item input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      updateSelectedAssignments();
    });
  });
  
  // Сохранение для экспорта
  selectedAssignments = allRecs.filter((_, i) => {
    const checkbox = document.querySelector(`input[data-index="${i}"]`);
    return checkbox ? checkbox.checked : !allRecs[i].status === 3;
  });
  
  // Обновляем выбранные
  updateSelectedAssignments();
}

// Обрезка текста
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// Выделить все
function selectAll() {
  const checkboxes = document.querySelectorAll('.assignment-item input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = true);
  updateSelectedAssignments();
}

// Отменить все
function deselectAll() {
  const checkboxes = document.querySelectorAll('.assignment-item input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);
  updateSelectedAssignments();
}

// Обновление выбранных назначений
function updateSelectedAssignments() {
  const checkboxes = document.querySelectorAll('.assignment-item input[type="checkbox"]');
  const allRecs = [];
  
  // Получаем все записи заново
  const dateFrom = elements.dateFrom.value;
  const dateTo = elements.dateTo.value;
  const onlyPending = elements.onlyPending.checked;
  
  let filtered = assignmentsData.filter(a => a.MedAssignmentTypeID === 1);
  
  filtered.forEach(assignment => {
    const drugName = assignment.MedAssignmentName || 
                     (assignment.MedAssignmentDrugs && assignment.MedAssignmentDrugs[0] 
                       ? assignment.MedAssignmentDrugs[0].DrugAssignment?.Name : 'Неизвестно');
    
    const recs = assignment.MedAssignmentRecs || [];
    
    recs.forEach(rec => {
      const appointDate = rec.AppointDateTime ? rec.AppointDateTime.split('T')[0] : '';
      if (dateFrom && appointDate < dateFrom) return;
      if (dateTo && appointDate > dateTo) return;
      
      const isCompleted = rec.MedAssignmentStatusID === 3;
      if (onlyPending && isCompleted) return;
      
      allRecs.push({
        drugName: drugName,
        appointDateTime: rec.AppointDateTime,
        department: rec.ExecuteMedicalPost?.Name || patientData?.department || '',
        beginDate: assignment.BeginAssignmentDateStr,
        endDate: assignment.EndAssignmentDateStr,
        regNumber: assignment.MedAssignmentDrugs?.[0]?.DrugAssignment?.ID || ''
      });
    });
  });
  
  selectedAssignments = [];
  checkboxes.forEach((checkbox, index) => {
    if (checkbox.checked && allRecs[index]) {
      selectedAssignments.push(allRecs[index]);
    }
  });
  
  // Обновляем превью
  if (selectedAssignments.length > 0) {
    generateOcsPreview();
  }
}

// Активация кнопок экспорта
function enableExportButtons() {
  elements.exportOcsBtn.disabled = false;
  elements.copyBtn.disabled = false;
}

// Генерация OCS содержимого
function generateOcsContent() {
  if (!patientData || selectedAssignments.length === 0) {
    return '';
  }
  
  const lines = selectedAssignments.map(rec => {
    const time = rec.appointDateTime ? 
      new Date(rec.appointDateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 
      '';
    
    // Используем дату конкретного приёма (AppointDateTime), а не даты назначения
    const appointDate = formatDateForOcs(rec.appointDateTime);
    
    // Формат: ФИО||Палата||Отделение||Организация||Тип||DrugID||Препарат||Время||ДатаПриёма||ДатаПриёма||Дозировка||Производитель||...
    return [
      patientData.fullName || '',
      patientData.roomNumber || '',
      rec.department || patientData.department || '',
      patientData.organization || 'НИИ кардиологии',
      '1', // MedAssignmentTypeID
      rec.drugId || '', // DrugID из DamuMed
      rec.drugName || '',
      time,
      appointDate, // Дата конкретного приёма
      appointDate, // Та же дата (для одного приёма начало = конец)
      rec.dosage || '',
      rec.manufacturer || '',
      '', '', '', '', '', '', '', '', '', '', '' // Пустые поля для совместимости
    ].join('||');
  });
  
  return lines.join('\n');
}

// Форматирование даты для OCS (YYYYMMDD)
function formatDateForOcs(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// Генерация превью
function generateOcsPreview() {
  const content = generateOcsContent();
  elements.ocsPreview.value = content;
  elements.previewSection.style.display = content ? 'block' : 'none';
}

// Экспорт в OCS файл
async function exportToOcs() {
  const content = generateOcsContent();
  
  if (!content) {
    showStatus('Нет данных для экспорта', 'error');
    return;
  }
  
  // Формирование имени файла из ФИО пациента
  const patientName = patientData && patientData.fullName 
    ? patientData.fullName.replace(/[\\/:*?"<>|]/g, '_') 
    : 'patient';
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
  const defaultFilename = `${patientName}_${dateStr}.ocs`;
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  
  // Пробуем использовать File System Access API для выбора пути
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [
          {
            description: 'OCS файл',
            accept: { 'text/plain': ['.ocs'] }
          }
        ]
      });
      
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      
      showStatus(`Файл сохранен: ${handle.name}`, 'success');
      return;
    } catch (err) {
      // Пользователь отменил или ошибка - fallback к обычному скачиванию
      if (err.name === 'AbortError') {
        showStatus('Сохранение отменено', 'info');
        return;
      }
      console.log('showSaveFilePicker не сработал, используем fallback:', err);
    }
  }
  
  // Fallback: обычное скачивание
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  a.click();
  URL.revokeObjectURL(url);
  
  showStatus(`Файл ${defaultFilename} сохранен в загрузки`, 'success');
}

// Копирование в буфер обмена
async function copyToClipboard() {
  const content = generateOcsContent();
  
  if (!content) {
    showStatus('Нет данных для копирования', 'error');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(content);
    showStatus('Скопировано в буфер обмена', 'success');
  } catch (error) {
    showStatus('Ошибка копирования', 'error');
  }
}

// ==================== ПРЯМОЙ ВЫЗОВ API ====================
// Загрузка назначений напрямую из API DamuMed с выбранными датами
async function fetchFromApi() {
  const patientRegId = elements.patientRegId.value.trim();
  const dateFrom = elements.dateFrom.value;
  const dateTo = elements.dateTo.value;
  
  if (!patientRegId) {
    showStatus('Введите ID госпитализации (PatientAdmissionRegisterID)', 'error');
    elements.patientRegId.focus();
    return;
  }
  
  if (!dateFrom || !dateTo) {
    showStatus('Выберите диапазон дат', 'error');
    return;
  }
  
  // Форматируем даты для API
  const beginDate = `${dateFrom}T00:00:00`;
  const endDate = `${dateTo}T23:59:59`;
  
  // Показываем статус
  showApiStatus('Загрузка назначений из API...', 'loading');
  elements.fetchApiBtn.disabled = true;
  
  try {
    // Получаем текущую вкладку
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('dmed.kz')) {
      showStatus('Откройте страницу DamuMed для использования API', 'error');
      showApiStatus('', 'hide');
      elements.fetchApiBtn.disabled = false;
      return;
    }
    
    // Выполняем запрос через content script (чтобы использовать куки сессии)
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: callMedAssignmentsApi,
      args: [patientRegId, beginDate, endDate]
    });
    
    if (results && results[0] && results[0].result) {
      const response = results[0].result;
      
      if (response.error) {
        showStatus(`Ошибка API: ${response.error}`, 'error');
        showApiStatus(`Ошибка: ${response.error}`, 'error');
      } else if (response.Data && response.Data.length > 0) {
        // Фильтруем только лекарственные средства
        const drugAssignments = response.Data.filter(a => a.MedAssignmentTypeID === 1);
        
        // Обновляем данные
        assignmentsData = drugAssignments;
        
        // Извлекаем PatientAdmissionRegisterID для будущих запросов
        if (drugAssignments.length > 0 && drugAssignments[0].PatientAdmissionRegisterID) {
          elements.patientRegId.value = drugAssignments[0].PatientAdmissionRegisterID;
        }
        
        // Сохраняем в storage
        const recordID = await getCurrentRecordID();
        const storageKey = `patient_${recordID}`;
        const dataToSave = {};
        dataToSave[storageKey] = {
          assignmentsData: assignmentsData,
          lastUpdate: new Date().toISOString()
        };
        await chrome.storage.local.set(dataToSave);
        
        renderAssignments();
        enableExportButtons();
        
        const totalRecs = drugAssignments.reduce((sum, a) => sum + (a.MedAssignmentRecs?.length || 0), 0);
        showStatus(`Загружено ${drugAssignments.length} препаратов, ${totalRecs} приёмов`, 'success');
        showApiStatus(`✅ Загружено: ${drugAssignments.length} препаратов`, 'success');
      } else {
        showStatus('Назначения не найдены за выбранный период', 'info');
        showApiStatus('Назначения не найдены', 'info');
      }
    } else {
      showStatus('Нет ответа от API', 'error');
      showApiStatus('Нет ответа', 'error');
    }
  } catch (error) {
    console.error('Ошибка вызова API:', error);
    showStatus(`Ошибка: ${error.message}`, 'error');
    showApiStatus(`Ошибка: ${error.message}`, 'error');
  } finally {
    elements.fetchApiBtn.disabled = false;
  }
}

// Показать статус API запроса
function showApiStatus(message, type) {
  if (!elements.apiStatus) return;
  
  if (type === 'hide' || !message) {
    elements.apiStatus.style.display = 'none';
    return;
  }
  
  elements.apiStatus.textContent = message;
  elements.apiStatus.className = `api-status ${type}`;
  elements.apiStatus.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => {
      elements.apiStatus.style.display = 'none';
    }, 5000);
  }
}

// Функция для выполнения в контексте страницы (через executeScript)
function callMedAssignmentsApi(patientRegId, beginDate, endDate) {
  return new Promise((resolve) => {
    const requestBody = {
      listQueryModel: {
        PatientAdmissionRegisterID: patientRegId,
        IncludeMedAssignmentRec: true,
        MedAssignmentTypes: ["1"],
        SourceTypes: ["1", "2"],
        MedAssignmentStatuses: null,
        BeginAppointDate: null,
        EndAppointDate: null,
        BeginAppointRecDate: beginDate,
        EndAppointRecDate: endDate,
        MedAssignmentName: ""
      }
    };
    
    fetch('/medicalAssignment/getMedicalAssignments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'include', // Важно для отправки куки сессии
      body: JSON.stringify(requestBody)
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      resolve(data);
    })
    .catch(error => {
      resolve({ error: error.message });
    });
  });
}
