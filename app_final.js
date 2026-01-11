
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

// --- CONFIGURATION ---
const CONFIG = {
    // Google Drive/Sheets Keys
    API_KEY: 'AIzaSyD5yY3UDK7tHYExgW0JKs2UEx3Y5Yeum4o',
    CLIENT_ID: '1023385440722-8i7vd1vlvfa8bniddojojlgadtsnrtod.apps.googleusercontent.com',
    APP_ID: '1023385440722',

    APP_ID: '1023385440722'
};

// Scopes
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

let tokenClient;
let gapiInited = false;
let gisInited = false;

// Saved State
let selectedSpreadsheetId = localStorage.getItem('faturaScan_sheetId');
let selectedSheetName = localStorage.getItem('faturaScan_sheetName') || 'Sheet1';

let mediaStream = null;
let currentFacingMode = 'environment';

// --- Initialization ---

window.onload = () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    }

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
        if (selectedSpreadsheetId) loadSheets(selectedSpreadsheetId);
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

function createPicker() {
    if (!gapi.client.getToken()) {
        alert("Login necessário.");
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
        loadSheets(fileId);
        alert("Planilha selecionada!");
    }
}

async function loadSheets(fileId) {
    try {
        const response = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: fileId });
        const sheets = response.result.sheets;
        const select = document.getElementById('tab-selector');
        select.innerHTML = '';
        sheets.forEach(sheet => {
            const title = sheet.properties.title;
            const option = document.createElement('option');
            option.value = title;
            option.innerText = title;
            if (title === selectedSheetName) option.selected = true;
            select.appendChild(option);
        });
        select.classList.remove('hidden');
        if (!sheets.some(s => s.properties.title === selectedSheetName)) {
            selectedSheetName = sheets[0].properties.title;
            localStorage.setItem('faturaScan_sheetName', selectedSheetName);
            select.value = selectedSheetName;
        }
        updateUIState();
    } catch (err) {
        console.error("Erro ao carregar abas:", err);
        const select = document.getElementById('tab-selector');
        if (select) {
            select.innerHTML = '<option>Erro ao carregar abas</option>';
            select.classList.remove('hidden');
        }
    }
}

// --- Camera ---

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
        alert("Erro na câmara.");
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

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // JPEG is better for AI upload size
    capturedImage.src = dataUrl;
    formView.classList.remove('hidden');
    emptyState.classList.add('hidden');

    analyzeWithOCR(dataUrl);
}

// --- LOCAL OCR INTEGRATION (No AI) ---

async function analyzeWithOCR(base64Image) {
    ocrLoading.classList.remove('hidden');
    const loadText = ocrLoading.querySelector('p');
    loadText.innerText = "A inicializar OCR local...";

    try {
        // Initialize Tesseract worker
        const worker = await Tesseract.createWorker('por'); // Using Portuguese

        loadText.innerText = "A ler imagem (Processamento local)...";
        const { data: { text } } = await worker.recognize(base64Image);
        console.log("OCR Raw Text:", text);

        loadText.innerText = "A extrair dados...";

        // --- 1. Extract Date ---
        // Regex for DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
        const dateRegex = /(\d{2}[\/\-]\d{2}[\/\-]\d{4})|(\d{4}[\/\-]\d{2}[\/\-]\d{2})/;
        const dateMatch = text.match(dateRegex);
        if (dateMatch) {
            let foundDate = dateMatch[0].replace(/\//g, '-');
            // If DD-MM-YYYY, convert to YYYY-MM-DD for the input type="date"
            if (foundDate.indexOf('-') === 2) {
                const parts = foundDate.split('-');
                foundDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            document.getElementById('date').value = foundDate;
        } else {
            // Default to today
            document.getElementById('date').valueAsDate = new Date();
        }

        // --- 2. Extract Total Amount ---
        const lines = text.split('\n');
        let foundAmount = "";

        const totalKeywords = ['TOTAL', 'EUR', '€', 'VALOR', 'LIQUIDO', 'PAGAR', 'MONTANTE'];

        for (let line of lines) {
            const upperLine = line.toUpperCase();
            if (totalKeywords.some(key => upperLine.includes(key))) {
                // Matches numbers like 1.234,56 or 1234.56 or 1234,56
                const priceMatch = line.match(/\d+[\.,]\s?\d{2}/g);
                if (priceMatch) {
                    let priceStr = priceMatch[priceMatch.length - 1];
                    priceStr = priceStr.replace(/\s/g, '').replace(',', '.');
                    foundAmount = priceStr;
                    break;
                }
            }
        }

        if (foundAmount) {
            document.getElementById('amount').value = foundAmount;
        }

        const firstLine = lines.find(l => l.trim().length > 3);
        if (firstLine) {
            document.getElementById('description').value = firstLine.trim().substring(0, 30);
        }

        let foundValue = !!foundAmount;
        let foundDateUI = !!dateMatch;

        if (!foundValue && !foundDateUI) {
            alert("⚠️ Não conseguimos ler os dados automaticamente.\nPor favor, garanta que a foto está nítida ou preencha manualmente.");
        } else if (!foundAmount) {
            alert("⚠️ Não encontramos o valor total. Por favor, preencha manualmente.");
        }

        await worker.terminate();
        submitBtn.focus();

    } catch (err) {
        console.error("OCR Error:", err);
        alert("Erro no processamento local: " + err.message);
    } finally {
        ocrLoading.classList.add('hidden');
        loadText.innerText = "A analisar texto...";
    }
}


// --- Submission ---

async function submitForm(e) {
    e.preventDefault();
    if (!selectedSpreadsheetId) { alert("Selecione planilha."); return; }

    const date = document.getElementById('date').value;
    const amount = document.getElementById('amount').value;
    const description = document.getElementById('description').value;

    const btnText = submitBtn.querySelector('span');
    const originalText = btnText.innerText;
    btnText.innerText = "A Enviar...";
    submitBtn.disabled = true;

    try {
        const range = `'${selectedSheetName}'!A:D`;
        // Order: Desc, Amount, Date
        const values = [[description, amount, date]];

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
            throw new Error('API Error');
        }

    } catch (err) {
        console.error(err);
        if (err.result?.error?.code === 401) {
            alert("Faça login novamente.");
            handleSignout();
        } else {
            alert("Erro ao salvar.");
        }
    } finally {
        btnText.innerText = originalText;
        submitBtn.disabled = false;
    }
}

function cancelForm() {
    formView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    document.getElementById('invoice-form').reset();
}

// --- Debug ---
window.debugModels = async function () {
    alert("OCR Local Ativo (v6.0). AI Desativada.");
};
