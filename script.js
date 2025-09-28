if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js")
        .then(() => console.log("Service Worker зарегистрирован"))
        .catch((err) => console.error("SW ошибка:", err));
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

const audioPlayer = new Audio();

const visualizer = document.querySelector('.visualizer');

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

function ensureVisualizerInit() {
    if (audioCtx && analyser && sourceNode && dataArray) return true;

    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        analyser = analyser || audioCtx.createAnalyser();
        analyser.fftSize = 2048;
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
        console.warn('Visualizer init failed (continuing without visualizer):', err);
        audioCtx = null;
        analyser = null;
        sourceNode = null;
        dataArray = null;
        return false;
    }
}

function charForLevel(v) {
    if (v < 30) return '.';
    if (v < 60) return '-';
    if (v < 100) return '+';
    if (v < 150) return '%';
    if (v < 200) return '#';
    return '@';
}

function startVisualizer() {
    if (!ensureVisualizerInit()) return;

    if (rafId) cancelAnimationFrame(rafId);

    function draw() {
        if (!analyser || !dataArray) return;
        analyser.getByteFrequencyData(dataArray);

        for (let i = 0; i < dataArray.length; i++) {
            const boost = 1 + (i / dataArray.length) * 1.5;
            dataArray[i] = Math.min(255, dataArray[i] * boost);
        }

        const w = Math.max(10, visualizer.clientWidth);
        const h = Math.max(10, visualizer.clientHeight);
        const style = getComputedStyle(visualizer);
        const fontSize = parseFloat(style.fontSize) || 12;

        const rows = Math.max(3, Math.floor(h / fontSize));

        const approxCharWidth = fontSize * 0.6;
        const maxCols = Math.max(1, Math.floor(w / Math.max(1, approxCharWidth)));

        const srcLen = dataArray.length;
        const step = Math.ceil(srcLen / maxCols);
        const colsVals = [];
        for (let c = 0; c < maxCols; c++) {
            const start = c * step;
            const end = Math.min(start + step, srcLen);
            let sum = 0;
            for (let k = start; k < end; k++) sum += dataArray[k];
            const avg = Math.round(sum / Math.max(1, end - start));
            colsVals.push(avg);
        }

        let out = '';
        for (let r = 0; r < rows; r++) {
            let line = '';
            for (let c = 0; c < colsVals.length; c++) {
                const v = colsVals[c];
                const barHeight = Math.round((v / 255) * rows);
                if (rows - r <= barHeight) line += charForLevel(v);
                else line += ' ';
            }
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
        audioCtx.resume().catch(e => console.warn('audioCtx.resume() failed:', e));
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
        console.error("Error loading state:", error);
        localStorage.clear();
    }
}

function enableControls(enabled) {
    playButton.disabled = !enabled;
    nextButton.disabled = !enabled;
    prevButton.disabled = !enabled;
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
        console.error(`Error: File ${targetFilename} not found in the currently selected folder.`);
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
        console.error("Autoplay failed. User interaction required:", e);
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
                console.log(`Playlist restored to track index ${restoreIndex} and time ${formatTime(restoreTime)}.`);
            } else {
                shuffledFilenames = shuffleArray(newFilenames);
                console.log("New folder detected. Shuffling and starting new playlist.");
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
        console.warn("No valid MP3 files found in the selection.");
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

    audioPlayer.addEventListener('timeupdate', () => {
        updateDisplay();
        saveState();
    });

    audioPlayer.addEventListener('loadedmetadata', updateDisplay);

    audioPlayer.addEventListener('ended', nextTrack);

    loadState();
}

init();
