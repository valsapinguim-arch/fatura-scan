
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

// --- GOOGLE CONFIGURATION (USER MUST FILL THIS) ---
const CONFIG = {
    API_KEY: 'YOUR_API_KEY',       // From Google Cloud Console
    CLIENT_ID: 'YOUR_CLIENT_ID',   // From Google Cloud Console
    APP_ID: 'YOUR_PROJECT_NUMBER', // First part of Client ID (e.g., 123456789)
};

// Scopes
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let selectedSpreadsheetId = localStorage.getItem('faturaScan_sheetId');
let mediaStream = null;
let currentFacingMode = 'environment';

// --- Initialization ---

// Called from index.html scripts if we used callback, but here we manually init
window.onload = () => {
    // Basic service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    }

    // Attempt to load Google libs
    if (typeof gapi !== 'undefined') gapi.load('client', intializeGapiClient);
    if (typeof google !== 'undefined') intializeGisClient();

    // Check if we have a sheet saved
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
        callback: '', // defined at request time
    });
    gisInited = true;
    updateUIState();
}

function updateUIState() {
    // Inject Auth UI if not present
    const authContainer = document.getElementById('auth-container');
    if (!authContainer && document.getElementById('empty-state')) {
        createAuthUI();
    }

    const sheetLabel = document.getElementById('current-sheet-label');
    if (sheetLabel) {
        if (selectedSpreadsheetId) {
            sheetLabel.innerText = "Planilha conectada ✅";
            sheetLabel.className = "text-green-400 text-sm font-medium mb-4";
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

    container.appendChild(sheetInfo);
    container.appendChild(authBtn);
    container.appendChild(pickerBtn);

    // Insert before the capture button in empty state
    const captureBtn = document.querySelector('#empty-state button');
    emptyState.insertBefore(container, captureBtn);

    // Initial check
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
    } else {
        // We can't easily check validity without trying, but let's assume signed out state initially
        // or rely on explicit login.
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error) throw resp;
        checkToken();
        // Auto open picker if no sheet selected
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
        selectedSpreadsheetId = null;

        const btn = document.getElementById('auth-btn');
        btn.innerHTML = `<img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" class="w-5 h-5"/><span>Conectar Google Drive</span>`;
        btn.onclick = handleAuthClick;
        document.getElementById('picker-btn').classList.add('hidden');
        updateUIState();
    }
}

// --- Drive Picker ---

function createPicker() {
    if (!selectedSpreadsheetId && !gapi.client.getToken()) {
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
        const fileName = data.docs[0].name;
        selectedSpreadsheetId = fileId;
        localStorage.setItem('faturaScan_sheetId', fileId);
        updateUIState();
        alert(`Planilha "${fileName}" selecionada!`);
    }
}


// --- Existing Camera & OCR Logic (Preserved) ---

async function startCamera() {
    if (!selectedSpreadsheetId) {
        alert("Por favor, selecione uma planilha onde guardar os dados primeiro.");
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
        console.error("Error accessing camera:", err);
        alert("Erro ao acessar a câmera.");
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

    const dataUrl = canvas.toDataURL('image/png');
    capturedImage.src = dataUrl;
    formView.classList.remove('hidden');
    emptyState.classList.add('hidden');

    processImage(dataUrl);
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
        console.error("OCR Error:", err);
        alert("Falha no OCR.");
    } finally {
        ocrLoading.classList.add('hidden');
    }
}

function extractData(text) {
    const dateRegex = /(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
        const parts = dateMatch[0].split(/[-\/.]/);
        let d = parts[0].padStart(2, '0'), m = parts[1].padStart(2, '0'), y = parts[2];
        if (y.length === 2) y = "20" + y;
        document.getElementById('date').value = `${y}-${m}-${d}`;
    } else {
        document.getElementById('date').valueAsDate = new Date();
    }

    // Improve amounts: find X,XX or X.XX that is not a date
    let max = 0;
    const amountRegex = /\d+[.,]\d{2}/g;
    const matches = text.match(amountRegex);
    if (matches) {
        matches.forEach(m => {
            let v = parseFloat(m.replace(',', '.'));
            // simple heuristic: exclude unlikely large years or small fragments
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

// --- New Submission Logic (Sheets API) ---

async function submitForm(e) {
    e.preventDefault();

    if (CONFIG.API_KEY === 'YOUR_API_KEY') {
        alert("ERRO: Configure as chaves da API no arquivo app.js!");
        return;
    }
    if (!selectedSpreadsheetId) {
        alert("Nenhuma planilha selecionada.");
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
        // Append to Sheet1
        const values = [
            [new Date().toISOString(), date, amount, description]
        ];

        const response = await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: selectedSpreadsheetId,
            range: 'A:D', // Appends to first sheet columns A-D
            valueInputOption: 'USER_ENTERED',
            resource: { values: values }
        });

        if (response.status === 200) {
            alert("Salvo com sucesso!");
            cancelForm();
        } else {
            throw new Error('API Response not 200');
        }

    } catch (err) {
        console.error("Submission error:", err);
        // Handle auth error
        if (err.result && err.result.error && err.result.error.code === 401) {
            alert("Sessão expirada. Faça login novamente.");
            handleSignout();
        } else {
            alert("Erro ao salvar: " + JSON.stringify(err));
        }
    } finally {
        btnText.innerText = originalText;
        submitBtn.disabled = false;
    }
}
