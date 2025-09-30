if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js")
        .then(() => console.log("Service Worker Registred"))
        .catch((err) => console.error("SW error:", err));
}

const LS_KEY_PLAYLIST = 'mp3_player_playlist';
const LS_KEY_INDEX = 'mp3_player_index';
const LS_KEY_TIME = 'mp3_player_time';

const folderInput = document.getElementById('folderInput');
const titleDisplay = document.getElementById('title');
const timeDisplay = document.getElementById('time');
const playButton = document.getElementById('PlayBtn');
const pauseButton = document.getElementById('PauseBtn');
const nextButton = document.getElementById('NextBtn');
const prevButton = document.getElementById('PrevBtn');
const rewindButton = document.getElementById('RewindBtn');
const forwardButton = document.getElementById('ForwardBtn');
const visualizer = document.querySelector('.visualizer');
const dec_res = document.getElementById('dec-res')
const inc_res = document.getElementById('inc-res')
const visRes_text = document.getElementById('visRes-text');

const audioPlayer = new Audio();

let audioCtx = null;
let analyser = null;
let sourceNode = null;
let dataArray = null;
let rafId = null;
let prevObjectURL = null;

let trackList = [];
let shuffledFilenames = [];
let currentTrackIndex = 0;
let isReadyToPlay = false;

const FONT_STEP = 2;
const FFT_SIZES = [8192, 4096, 2048, 1024, 512, 256, 128, 64];
let currentFftIndex = 3;

function ensureVisualizerInit() {
    if (audioCtx && analyser && sourceNode && dataArray) return true;

    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        analyser = analyser || audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZES[currentFftIndex];
        analyser.smoothingTimeConstant = 0.6;

        const bufferLen = analyser.frequencyBinCount;
        dataArray = dataArray || new Uint8Array(bufferLen);

        if (!sourceNode) {
            sourceNode = audioCtx.createMediaElementSource(audioPlayer);
            sourceNode.connect(analyser);
            analyser.connect(audioCtx.destination);
        }

        return true;
    } catch (err) {
        audioCtx = null;
        analyser = null;
        sourceNode = null;
        dataArray = null;
        return false;
    }
}

function charForLevel(v) {

    if (v < 10) return '.';
    if (v < 20) return '-';
    if (v < 30) return ':';
    if (v < 40) return '"';
    if (v < 50) return ';';
    if (v < 60) return '|';
    if (v < 70) return '/';
    if (v < 80) return '>';
    if (v < 90) return '<';
    if (v < 100) return '+';
    if (v < 110) return '(';
    if (v < 120) return ']';
    if (v < 130) return '[';
    if (v < 140) return '}';
    if (v < 150) return '{';
    if (v < 160) return ')';
    if (v < 170) return '=';
    if (v < 180) return 'o';
    if (v < 190) return '*';
    if (v < 200) return '&';
    if (v < 210) return '?';
    if (v < 220) return '%';
    if (v < 230) return '$';
    if (v < 240) return 'a';
    if (v < 250) return 'g';
    return '@';
}


function startVisualizer() {
    if (!ensureVisualizerInit()) return;

    if (rafId) cancelAnimationFrame(rafId);

    function draw() {
        if (!analyser || !dataArray) return;
        analyser.getByteFrequencyData(dataArray);

        const w = Math.max(10, visualizer.clientWidth);
        const h = Math.max(10, visualizer.clientHeight);
        const style = getComputedStyle(visualizer);
        const fontSize = parseFloat(style.fontSize) || 12;

        const rows = Math.max(3, Math.floor(h / fontSize));
        const approxCharWidth = fontSize * 0.5;
        const maxCols = Math.max(1, Math.floor(w / Math.max(1, approxCharWidth)));

        const srcLen = dataArray.length;
        const halfLen = Math.ceil(srcLen / 2);
        const colsVals = [];

        const actualCols = maxCols % 2 === 0 ? maxCols - 1 : maxCols;
        const halfCols = Math.floor(actualCols / 2);

        const step = Math.ceil(halfLen / halfCols);

        for (let c = 0; c < halfCols; c++) {
            const start = c * step;
            const end = Math.min(start + step, halfLen);
            let sum = 0;
            for (let k = start; k < end; k++) sum += dataArray[k];
            const avg = Math.round(sum / Math.max(1, end - start));
            colsVals.push(avg);
        }

        const centerVal = colsVals[0];

        let out = '';

        const reverseCols = [...colsVals].reverse();

        const fullCols = [...reverseCols, centerVal, ...colsVals];

        const leftPadding = Math.floor((maxCols - fullCols.length) / 2);

        for (let r = 0; r < rows; r++) {
            let line = ' '.repeat(leftPadding);

            for (let c = 0; c < fullCols.length; c++) {
                const v = fullCols[c];
                const barHeight = Math.round((v / 255) * rows);

                if (rows - r <= barHeight) line += charForLevel(v);
                else line += ' ';
            }
            line += ' '.repeat(maxCols - line.length);
            out += line + '\n';
        }

        visualizer.textContent = out;
        rafId = requestAnimationFrame(draw);
    }

    draw();
}

function stopVisualizer() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

audioPlayer.addEventListener('play', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    } else {
        ensureVisualizerInit();
    }
    startVisualizer();
});

audioPlayer.addEventListener('pause', () => {
    stopVisualizer();
});

audioPlayer.addEventListener('ended', () => {
    stopVisualizer();
});


function formatTime(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '0:00';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function shuffleArray(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }
    return array;
}

function saveState() {
    if (shuffledFilenames.length > 0) {
        localStorage.setItem(LS_KEY_PLAYLIST, JSON.stringify(shuffledFilenames));
        localStorage.setItem(LS_KEY_INDEX, currentTrackIndex);
        localStorage.setItem(LS_KEY_TIME, audioPlayer.currentTime || 0);
    }
}

function loadState() {
    try {
        const savedPlaylist = localStorage.getItem(LS_KEY_PLAYLIST);
        const savedIndex = localStorage.getItem(LS_KEY_INDEX);
        const savedTime = localStorage.getItem(LS_KEY_TIME);

        if (savedPlaylist) {
            shuffledFilenames = JSON.parse(savedPlaylist);
            currentTrackIndex = parseInt(savedIndex) || 0;

            const targetFilename = shuffledFilenames[currentTrackIndex];

            updateDisplay(`(RE) ${targetFilename}`);
            timeDisplay.textContent = `Time: ${formatTime(parseFloat(savedTime) || 0)}`;

            enableControls(false);
        } else {
            updateDisplay('Please Select Folder...');
        }
    } catch (error) {
        localStorage.clear();
    }
}

function enableControls(enabled) {
    playButton.disabled = !enabled;
    nextButton.disabled = !enabled;
    prevButton.disabled = !enabled;
    rewindButton.disabled = !enabled;
    forwardButton.disabled = !enabled;
    if (!enabled) {
        pauseButton.style.display = 'none';
        playButton.style.display = 'inline';
    }
}

function updateDisplay(overrideTitle) {
    if (overrideTitle) {
        titleDisplay.textContent = overrideTitle;
        return;
    }

    if (trackList.length === 0) {
        titleDisplay.textContent = '----';
        timeDisplay.textContent = '-:-- / -:--';
        return;
    }

    const currentFilename = shuffledFilenames[currentTrackIndex];
    const currentTrack = trackList.find(t => t.name === currentFilename);

    titleDisplay.textContent = currentTrack ? currentTrack.name : 'Unknown Track';

    const currentTime = formatTime(audioPlayer.currentTime);
    const duration = formatTime(audioPlayer.duration);

    timeDisplay.textContent = `${currentTime} / ${duration}`;
}

function loadTrack(shouldSeek = false) {
    if (trackList.length === 0) {
        enableControls(false);
        return;
    }

    currentTrackIndex = (currentTrackIndex + trackList.length) % trackList.length;

    const targetFilename = shuffledFilenames[currentTrackIndex];
    const file = trackList.find(t => t.name === targetFilename);

    if (!file) {
        currentTrackIndex++;
        loadTrack(false);
        return;
    }

    if (prevObjectURL) {
        try { URL.revokeObjectURL(prevObjectURL); } catch (e) {/* ignore */ }
        prevObjectURL = null;
    }

    const fileURL = URL.createObjectURL(file);
    prevObjectURL = fileURL;
    audioPlayer.src = fileURL;


    audioPlayer.load();

    isReadyToPlay = true;
    enableControls(true);
    updateDisplay();
}

function playTrack() {
    if (!isReadyToPlay && trackList.length > 0) {
        loadTrack();
    }
    if (trackList.length === 0 || !isReadyToPlay) return;

    audioPlayer.play().then(() => {
        pauseButton.style.display = 'inline';
        playButton.style.display = 'none';
    }).catch(e => {
        pauseButton.style.display = 'none';
        playButton.style.display = 'inline';
    });
}

function pauseTrack() {
    audioPlayer.pause();
    pauseButton.style.display = 'none';
    playButton.style.display = 'inline';
    saveState();
}

function nextTrack() {
    pauseTrack();
    currentTrackIndex = (currentTrackIndex + 1) % trackList.length;
    loadTrack();
    playTrack();
}

function prevTrack() {
    pauseTrack();
    currentTrackIndex = (currentTrackIndex - 1 + trackList.length) % trackList.length;
    loadTrack();
    playTrack();
}

function seekTrack(seconds) {
    if (trackList.length === 0 || !isReadyToPlay) return;

    const newTime = audioPlayer.currentTime + seconds;

    if (newTime >= 0) {
        audioPlayer.currentTime = newTime;
    } else {
        audioPlayer.currentTime = 0;
    }

    if (!audioPlayer.paused) {
        audioPlayer.play();
    }

    updateDisplay();
    saveState();
}

function getCurrentFontSize() {
    const VisFontSize = window.getComputedStyle(visualizer);
    const currentSizePx = parseFloat(VisFontSize.fontSize);
    return currentSizePx;
}

function changeFontSize(step) {
    let currentSize = getCurrentFontSize();
    let newSize = currentSize + step;

    if (newSize < 2) newSize = 2;
    if (newSize > 16) newSize = 16;

    visualizer.style.fontSize = `${newSize}px`;
    visRes_text.textContent = `Visualizer Res: ${newSize}pt`
}

function updateFft(direction) {
    let newIndex = currentFftIndex + direction;

    if (newIndex < 0) {
        newIndex = 0;
    } else if (newIndex >= FFT_SIZES.indexOf(512)) {
        newIndex = FFT_SIZES.indexOf(512);
    }

    if (newIndex === currentFftIndex) return;

    currentFftIndex = newIndex;
    const newFftSize = FFT_SIZES[currentFftIndex];

    if (analyser) {
        analyser.fftSize = newFftSize;

        dataArray = new Uint8Array(analyser.frequencyBinCount);

        if (!audioPlayer.paused) {
            stopVisualizer();
            startVisualizer();
        }
    }
}

function decreaseFftSize() {
    updateFft(-1);
}

function increaseFftSize() {
    updateFft(1);
}

function handleFolderSelect(event) {
    const selectedFiles = event.target.files;

    audioPlayer.pause();
    audioPlayer.src = '';
    trackList = [];
    isReadyToPlay = false;

    let newFilenames = [];
    let mp3FileObjects = [];

    for (const file of selectedFiles) {
        if (file.name.toLowerCase().endsWith('.mp3')) {
            mp3FileObjects.push(file);
            newFilenames.push(file.name);
        }
    }

    trackList = mp3FileObjects;

    if (trackList.length > 0) {
        let savedFilenames = localStorage.getItem(LS_KEY_PLAYLIST);
        let restoreIndex = 0;
        let restoreTime = 0;

        if (savedFilenames) {
            savedFilenames = JSON.parse(savedFilenames);

            const isSamePlaylist = savedFilenames.length === newFilenames.length &&
                savedFilenames.every(name => newFilenames.includes(name));

            if (isSamePlaylist) {
                shuffledFilenames = savedFilenames;
                restoreIndex = parseInt(localStorage.getItem(LS_KEY_INDEX)) || 0;
                restoreTime = parseFloat(localStorage.getItem(LS_KEY_TIME)) || 0;

                currentTrackIndex = restoreIndex;
            } else {
                shuffledFilenames = shuffleArray(newFilenames);
            }
        } else {
            shuffledFilenames = shuffleArray(newFilenames);
        }

        loadTrack();

        if (restoreTime > 0) {
            audioPlayer.currentTime = restoreTime;
        }

        playTrack();
        saveState();
    } else {
        updateDisplay('No MP3s loaded');
        enableControls(false);
        localStorage.clear();
    }
}

function init() {
    folderInput.addEventListener('change', handleFolderSelect);
    playButton.addEventListener('click', playTrack);
    pauseButton.addEventListener('click', pauseTrack);
    nextButton.addEventListener('click', nextTrack);
    prevButton.addEventListener('click', prevTrack);
    rewindButton.addEventListener('click', () => seekTrack(-10));
    forwardButton.addEventListener('click', () => seekTrack(10));
    inc_res.addEventListener('click', () => {
        if (!audioPlayer.paused) {
            changeFontSize(FONT_STEP);
            increaseFftSize()
        } else {
            changeFontSize(0);
        }
    });
    dec_res.addEventListener('click', () => {
        if (!audioPlayer.paused) {
            changeFontSize(-FONT_STEP);
            decreaseFftSize()
        } else {
            changeFontSize(0);
        }
    });

    document.addEventListener('keyup', (event) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'BUTTON') return;

        if (event.code === 'Space') {
            event.preventDefault();
            if (audioPlayer.paused) {
                playTrack();
            } else {
                pauseTrack();
            }
        }
    });

    audioPlayer.addEventListener('timeupdate', () => {
        updateDisplay();
        saveState();
    });

    audioPlayer.addEventListener('loadedmetadata', updateDisplay);

    audioPlayer.addEventListener('ended', nextTrack);

    loadState();
}

init();
