export class SynthController {
    constructor(audioEngine, timingSystem, loopManager, options = {}) {
        this.audioEngine = audioEngine;
        this.timingSystem = timingSystem;
        this.loopManager = loopManager;

        // Настройки синтезатора
        this.instrument = options.instrument ?? "piano";
        this.startingNote = options.startingNote ?? "C4";
        this.volume = 0.8;

        // Аккорды: ID жеста левой руки -> интервалы
        this.chordMap = options.chordMap ?? {
            5: [0, 4, 7] // C major
        };

        // Обращения: ID жеста правой руки -> номер обращения
        this.inversionMap = options.inversionMap ?? {
            1: 0,
            2: 1,
            3: 2
        };

        // Текущее состояние
        this.currentChord = null;
        this.currentInversion = 0;

        // Последние обработанные жесты
        this.lastLeftGestureId = null;
        this.lastRightGestureId = null;

        this.isPlaying = false;
    }

    // Обработка данных от Gesture Recognition
    handleGesture(data) {
        if (!data) {
            return;
        }

        const {
            leftGestureId,
            rightGestureId,
            volume
        } = data;

        // Обновляем громкость
        if (volume !== undefined && volume !== null) {
            this.setVolume(volume);
        }

        let chordChanged = false;

        // Проверяем изменение жеста левой руки
        if (leftGestureId !== this.lastLeftGestureId) {
            this.lastLeftGestureId = leftGestureId;

            if (leftGestureId === null) {
                this.currentChord = null;
                this.stopChord();
                return;
            }

            const chord = this.chordMap[leftGestureId];

            if (chord) {
                this.currentChord = chord;
                chordChanged = true;
            }
        }

        // Проверяем изменение жеста правой руки
        if (rightGestureId !== this.lastRightGestureId) {
            this.lastRightGestureId = rightGestureId;

            if (rightGestureId === null) {
                this.currentInversion = 0;
            } else {
                const inversion = this.inversionMap[rightGestureId];

                if (inversion !== undefined) {
                    this.currentInversion = inversion;
                    chordChanged = true;
                }
            }
        }

        // Планируем новый аккорд только при изменении жеста
        if (chordChanged && this.currentChord) {
            this.scheduleCurrentChord();
        }
    }

    // Планирование воспроизведения текущего аккорда
    scheduleCurrentChord() {
        if (!this.currentChord) {
            return;
        }

        const notes = this.createChordNotes(
            this.currentChord,
            this.currentInversion
        );

        // Получаем время ближайшей следующей доли
        const time = this.timingSystem.getNextBeatTime();

        const event = {
            notes,
            instrument: this.instrument,
            volume: this.volume,
            time
        };

        // Передаём команду в Audio Engine
        this.audioEngine.scheduleChord(notes, {
            time,
            instrument: this.instrument,
            volume: this.volume
        });

        // Передаём событие в Loop Manager
        this.loopManager.recordEvent("synth", event);

        this.isPlaying = true;
    }

    // Создание нот аккорда с учётом обращения
    createChordNotes(intervals, inversion) {
        const rootMidi = this.noteToMidi(this.startingNote);

        const notes = intervals.map(
            interval => rootMidi + interval
        );

        // Переносим нижние ноты на октаву вверх
        for (let i = 0; i < inversion; i++) {
            const note = notes.shift();
            notes.push(note + 12);
        }

        return notes.map(note => this.midiToNote(note));
    }

    // Преобразование названия ноты в MIDI-номер
    noteToMidi(note) {
        const match = note.match(/^([A-G])(#|b)?(-?\d+)$/);

        if (!match) {
            throw new Error("Invalid note: " + note);
        }

        const noteValues = {
            C: 0,
            D: 2,
            E: 4,
            F: 5,
            G: 7,
            A: 9,
            B: 11
        };

        const accidental = match[2] === "#" ? 1 :
            match[2] === "b" ? -1 : 0;

        const octave = Number(match[3]);

        return (octave + 1) * 12 +
            noteValues[match[1]] + accidental;
    }

    // Преобразование MIDI-номера в название ноты
    midiToNote(midi) {
        const noteNames = [
            "C", "C#", "D", "D#", "E", "F",
            "F#", "G", "G#", "A", "A#", "B"
        ];

        const noteName = noteNames[midi % 12];
        const octave = Math.floor(midi / 12) - 1;

        return noteName + octave;
    }

    // Изменение громкости
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
    }

    // Остановка звучания
    stopChord() {
        if (!this.isPlaying) {
            return;
        }

        this.audioEngine.stopChord();
        this.isPlaying = false;
    }

    // Изменение инструмента
    setInstrument(instrument) {
        this.instrument = instrument;
    }

    // Изменение начальной ноты
    setStartingNote(note) {
        this.noteToMidi(note);
        this.startingNote = note;
    }

    // Изменение карты аккордов
    setChordMap(chordMap) {
        this.chordMap = chordMap;
    }

    // Изменение карты обращений
    setInversionMap(inversionMap) {
        this.inversionMap = inversionMap;
    }
}
