
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

// State
let mediaStream = null;
let currentFacingMode = 'environment'; // 'user' or 'environment'
// TODO: User must replace this with their deployed App Script URL
const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_SCRIPT_URL_HERE'; 

// --- Camera Functions ---

async function startCamera() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode }
        });
        videoFeed.srcObject = mediaStream;
        
        // Show camera view
        emptyState.classList.add('hidden');
        formView.classList.add('hidden');
        cameraView.classList.remove('hidden');
    } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Erro ao acessar a câmera. Verifique as permissões.");
    }
}

function closeCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    cameraView.classList.add('hidden');
    if (!formView.classList.contains('hidden')) {
        // Returned from form view (cancelling retake) check logic? 
        // Actually if we close camera we usually go back to start
    } else {
         emptyState.classList.remove('hidden');
    }
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
    
    // Stop camera
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    cameraView.classList.add('hidden');
    
    // Show Preview
    const dataUrl = canvas.toDataURL('image/png');
    capturedImage.src = dataUrl;
    formView.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // Start OCR
    processImage(dataUrl);
}

// --- OCR Functions ---

async function processImage(imageData) {
    ocrLoading.classList.remove('hidden');
    
    try {
        // Tesseract worker
        const worker = await Tesseract.createWorker('por'); // Portuguese language
        
        const { data: { text } } = await worker.recognize(imageData);
        console.log("OCR Result:", text);
        
        await worker.terminate();
        
        extractData(text);
    } catch (err) {
        console.error("OCR Error:", err);
        alert("Falha ao processar imagem.");
    } finally {
        ocrLoading.classList.add('hidden');
    }
}

function extractData(text) {
    // Basic Regex strategies
    
    // Date: looking for dd/mm/yyyy or dd-mm-yyyy
    const dateRegex = /(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/;
    const dateMatch = text.match(dateRegex);
    
    if (dateMatch) {
        // Convert to YYYY-MM-DD for input[type=date]
        const parts = dateMatch[0].split(/[-\/.]/);
        let day = parts[0].padStart(2, '0');
        let month = parts[1].padStart(2, '0');
        let year = parts[2];
        if (year.length === 2) year = "20" + year;
        
        document.getElementById('date').value = `${year}-${month}-${day}`;
    } else {
        // Default to today
        document.getElementById('date').valueAsDate = new Date();
    }

    // Amount: looking for patterns like 10,99 or 10.99
    // Often amounts are at the end or have currency symbols
    const amountRegex = /(\d+[.,]\d{2})\s*€?|€\s*(\d+[.,]\d{2})/;
    // This is simplistic. Real invoices have many numbers. 
    // We try to find the largest number that looks like a total?
    // Or just the first one found that looks like currency.
    
    // Let's try to find all money-like patterns and pick the largest one (usually Total)
    const allAmounts = [...text.matchAll(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/g)];
    // Simplifying: just find simple X.XX or X,XX
    
    let maxAmount = 0;
    const simpleAmountRegex = /\d+[.,]\d{2}/g;
    const matches = text.match(simpleAmountRegex);
    
    if (matches) {
        matches.forEach(m => {
            let val = parseFloat(m.replace(',', '.'));
            if (val > maxAmount) maxAmount = val;
        });
    }
    
    if (maxAmount > 0) {
        document.getElementById('amount').value = maxAmount.toFixed(2);
    }
}

// --- Form Submission ---

function cancelForm() {
    formView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    document.getElementById('invoice-form').reset();
}

async function submitForm(e) {
    e.preventDefault();
    
    if (GOOGLE_SCRIPT_URL === 'YOUR_GOOGLE_SCRIPT_URL_HERE') {
        alert("Configure a URL do Script do Google Sheets no código (app.js) primeiro!");
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
        // Google Apps Script usually needs 'no-cors' for simple POSTs from browser
        // OR return JSONP, but standard fetch has CORS issues unless script handles OPTIONS.
        // Actually, simplest is to use application/x-www-form-urlencoded or text/plain
        // and handle it in GS.
        
        const payload = JSON.stringify({ date, amount, description });
        
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // Important for Google Apps Script Web App
            headers: {
                'Content-Type': 'application/json'
            },
            body: payload
        });
        
        // Since no-cors returns opaque response, we assume success if no network error
        alert("Enviado com sucesso!");
        cancelForm();
        
    } catch (err) {
        console.error("Submission error:", err);
        alert("Erro ao enviar dados.");
    } finally {
        btnText.innerText = originalText;
        submitBtn.disabled = false;
    }
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registado'))
            .catch(err => console.log('SW falhou:', err));
    });
}
