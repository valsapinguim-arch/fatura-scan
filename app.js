
// DOM Elements
const mainContainer = document.getElementById('main-container');
const emptyState = document.getElementById('empty-state');
const cameraView = document.getElementById('camera-view');
const formView = document.getElementById('form-view');
const videoFeed = document.getElementById('video-feed');
const capturedImage = document.getElementById('captured-image');
const ocrLoading = document.getElementById('ocr-loading');
const invoiceForm = document.getElementById('invoice-form');
const submitBtn = document.getElementById('submit-btn');

// --- GOOGLE CONFIGURATION ---
const CONFIG = {
    API_KEY: 'AIzaSyD5yY3UDK7tHYExgW0JKs2UEx3Y5Yeum4o',
    CLIENT_ID: '1023385440722-8i7vd1vlvfa8bniddojojlgadtsnrtod.apps.googleusercontent.com',
    APP_ID: '1023385440722',
};

// Scopes
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

let tokenClient;
let gapiInited = false;
let gisInited = false;

// Saved State
let selectedSpreadsheetId = localStorage.getItem('faturaScan_sheetId');
let selectedSheetName = localStorage.getItem('faturaScan_sheetName') || 'Sheet1'; // Default

let mediaStream = null;
let currentFacingMode = 'environment';

// --- Initialization ---

window.onload = () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    }

    // Attempt to load Google libs
    if (typeof gapi !== 'undefined') gapi.load('client:picker', intializeGapiClient);
    if (typeof google !== 'undefined') intializeGisClient();

    updateUIState();
};

async function intializeGapiClient() {
    await gapi.client.init({
        apiKey: CONFIG.API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
    updateUIState();
}

function intializeGisClient() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: SCOPES,
        callback: '',
    });
    gisInited = true;
    updateUIState();
}

function updateUIState() {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer && document.getElementById('empty-state')) {
        createAuthUI();
    }

    const sheetLabel = document.getElementById('current-sheet-label');
    if (sheetLabel) {
        if (selectedSpreadsheetId) {
            // Show file found and current tab
            sheetLabel.innerHTML = `
                <div class="text-green-400 text-sm font-medium mb-1">Conectado ✅</div>
                <div class="text-xs text-slate-400">Aba: <b>${selectedSheetName}</b></div>
            `;
        } else {
            sheetLabel.innerText = "Nenhuma planilha selecionada";
            sheetLabel.className = "text-yellow-500 text-sm font-medium mb-4";
        }
    }
}

function createAuthUI() {
    const container = document.createElement('div');
    container.id = 'auth-container';
    container.className = 'w-full max-w-xs mb-8 flex flex-col gap-3';

    const sheetInfo = document.createElement('div');
    sheetInfo.id = 'current-sheet-label';
    sheetInfo.innerText = "A carregar...";

    const authBtn = document.createElement('button');
    authBtn.id = 'auth-btn';
    authBtn.className = 'w-full py-3 bg-white text-slate-900 rounded-xl font-semibold hover:bg-slate-100 transition flex items-center justify-center gap-2';
    authBtn.innerHTML = `
        <img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" class="w-5 h-5"/>
        <span>Conectar Google Drive</span>
    `;
    authBtn.onclick = handleAuthClick;

    const pickerBtn = document.createElement('button');
    pickerBtn.id = 'picker-btn';
    pickerBtn.className = 'w-full py-3 bg-slate-800 border border-slate-700 text-white rounded-xl font-semibold hover:bg-slate-700 transition hidden';
    pickerBtn.innerHTML = `<i data-lucide="file-spreadsheet" class="w-5 h-5 inline mr-2 h-5 w-5"></i> Selecionar Planilha`;
    pickerBtn.onclick = createPicker;

    // Tab Selector Dropdown (Hidden initially)
    const tabSelector = document.createElement('select');
    tabSelector.id = 'tab-selector';
    tabSelector.className = 'w-full p-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm hidden focus:ring-2 focus:ring-blue-500';
    tabSelector.onchange = (e) => {
        selectedSheetName = e.target.value;
        localStorage.setItem('faturaScan_sheetName', selectedSheetName);
        updateUIState();
    };

    container.appendChild(sheetInfo);
    container.appendChild(authBtn);
    container.appendChild(pickerBtn);
    container.appendChild(tabSelector);

    const captureBtn = document.querySelector('#empty-state button');
    emptyState.insertBefore(container, captureBtn);

    checkToken();
}

function checkToken() {
    const btn = document.getElementById('auth-btn');
    const pBtn = document.getElementById('picker-btn');
    if (!btn) return;

    if (gapi.client.getToken()) {
        btn.innerHTML = `<i data-lucide="log-out" class="w-5 h-5"></i><span>Sair da Conta</span>`;
        btn.onclick = handleSignout;
        pBtn.classList.remove('hidden');

        // If we have a file selected, load its tabs
        if (selectedSpreadsheetId) {
            loadSheets(selectedSpreadsheetId);
        }
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error) throw resp;
        checkToken();
        if (!selectedSpreadsheetId) createPicker();
    };
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

function handleSignout() {
    const token = gapi.client.getToken();
    if (token) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        localStorage.removeItem('faturaScan_sheetId');
        localStorage.removeItem('faturaScan_sheetName');
        selectedSpreadsheetId = null;
        selectedSheetName = 'Sheet1';

        const btn = document.getElementById('auth-btn');
        btn.innerHTML = `<img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" class="w-5 h-5"/><span>Conectar Google Drive</span>`;
        btn.onclick = handleAuthClick;
        document.getElementById('picker-btn').classList.add('hidden');
        document.getElementById('tab-selector').classList.add('hidden');
        updateUIState();
    }
}

// --- Drive Picker ---

function createPicker() {
    if (!gapi.client.getToken()) {
        alert("Precisa de fazer login primeiro.");
        return;
    }

    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setMimeTypes('application/vnd.google-apps.spreadsheet')
        .setSelectFolderEnabled(false);

    const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(CONFIG.APP_ID)
        .setOAuthToken(gapi.client.getToken().access_token)
        .addView(view)
        .setCallback(pickerCallback)
        .build();
    picker.setVisible(true);
}

function pickerCallback(data) {
    if (data.action === google.picker.Action.PICKED) {
        const fileId = data.docs[0].id;
        selectedSpreadsheetId = fileId;
        localStorage.setItem('faturaScan_sheetId', fileId);

        // Load Tabs for this sheet
        loadSheets(fileId);

        alert("Planilha selecionada! Carregando abas...");
    }
}

async function loadSheets(fileId) {
    try {
        const response = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: fileId
        });

        const sheets = response.result.sheets;
        const select = document.getElementById('tab-selector');
        select.innerHTML = ''; // clear

        sheets.forEach(sheet => {
            const title = sheet.properties.title;
            const option = document.createElement('option');
            option.value = title;
            option.innerText = title;
            if (title === selectedSheetName) option.selected = true;
            select.appendChild(option);
        });

        select.classList.remove('hidden');

        // Ensure selected sheet name exists, else pick first
        if (!sheets.some(s => s.properties.title === selectedSheetName)) {
            selectedSheetName = sheets[0].properties.title;
            localStorage.setItem('faturaScan_sheetName', selectedSheetName);
            select.value = selectedSheetName;
        }

        updateUIState();

    } catch (err) {
        console.error("Error loading sheets:", err);
        alert("Erro ao carregar abas da planilha.");
    }
}


// --- Main App Logic ---

async function startCamera() {
    if (!selectedSpreadsheetId) {
        alert("Selecione uma planilha primeiro!");
        return;
    }

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode }
        });
        videoFeed.srcObject = mediaStream;
        emptyState.classList.add('hidden');
        formView.classList.add('hidden');
        cameraView.classList.remove('hidden');
    } catch (err) {
        console.error("Camera error:", err);
        alert("Erro ao aceder à câmara.");
    }
}

function closeCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    cameraView.classList.add('hidden');
    emptyState.classList.remove('hidden');
}

async function switchCamera() {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    closeCamera();
    await startCamera();
}

function capturePhoto() {
    const canvas = document.createElement('canvas');
    canvas.width = videoFeed.videoWidth;
    canvas.height = videoFeed.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoFeed, 0, 0, canvas.width, canvas.height);

    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    cameraView.classList.add('hidden');

    capturedImage.src = canvas.toDataURL('image/png');
    formView.classList.remove('hidden');
    emptyState.classList.add('hidden');

    processImage(capturedImage.src);
}

async function processImage(imageData) {
    ocrLoading.classList.remove('hidden');
    try {
        const worker = await Tesseract.createWorker('por');
        const { data: { text } } = await worker.recognize(imageData);
        console.log("OCR:", text);
        await worker.terminate();
        extractData(text);
    } catch (err) {
        console.error(err);
        alert("Erro no OCR.");
    } finally {
        ocrLoading.classList.add('hidden');
    }
}

function extractData(text) {
    // Regex Date (dd/mm/yyyy or yyyy-mm-dd)
    const dateRegex = /(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
        const parts = dateMatch[0].split(/[-\/.]/);
        // Naive date parsing, assuming Day first for PORTUGAL
        let d = parts[0].padStart(2, '0'), m = parts[1].padStart(2, '0'), y = parts[2];
        // If year is first...
        if (parts[0].length === 4) { y = parts[0]; m = parts[1]; d = parts[2]; }
        if (y.length === 2) y = "20" + y;
        document.getElementById('date').value = `${y}-${m}-${d}`;
    } else {
        document.getElementById('date').valueAsDate = new Date();
    }

    // Amounts
    let max = 0;
    const matches = text.match(/\d+[.,]\d{2}/g);
    if (matches) {
        matches.forEach(m => {
            let v = parseFloat(m.replace(',', '.'));
            if (v > max && v < 100000) max = v;
        });
    }
    if (max > 0) document.getElementById('amount').value = max.toFixed(2);
}

function cancelForm() {
    formView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    document.getElementById('invoice-form').reset();
}

async function submitForm(e) {
    e.preventDefault();

    // Safety check just in case
    if (CONFIG.API_KEY.includes('YOUR_API_KEY')) {
        alert("Erro: API Key não configurada.");
        return;
    }

    const date = document.getElementById('date').value;
    const amount = document.getElementById('amount').value;
    const description = document.getElementById('description').value;

    const btnText = submitBtn.querySelector('span');
    const originalText = btnText.innerText;
    btnText.innerText = "A Enviar...";
    submitBtn.disabled = true;

    try {
        // USE SELECTED SHEET NAME
        const range = `'${selectedSheetName}'!A:D`;

        const values = [[new Date().toISOString(), date, amount, description]];

        const response = await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: selectedSpreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: { values: values }
        });

        if (response.status === 200) {
            alert("Salvo com sucesso!");
            cancelForm();
        } else {
            console.error(response);
            throw new Error('API Response Error');
        }

    } catch (err) {
        console.error("Submit error:", err);
        if (err.result && err.result.error && err.result.error.code === 401) {
            alert("Sessão expirada. Faça login novamente.");
            handleSignout();
        } else {
            alert("Erro ao salvar. Verifique se a Aba existe.");
        }
    } finally {
        btnText.innerText = originalText;
        submitBtn.disabled = false;
    }
}
