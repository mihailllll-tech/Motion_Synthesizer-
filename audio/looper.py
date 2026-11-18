import time
import threading


class DrumLooper:
    def __init__(self, audio_engine):
        self.audio = audio_engine

        self.bpm = 120
        self.loop_beats = 4  # 4 доли = стандартный такт 4/4
        self.quantize_enabled = True  # выравнивать ли удары по сетке

        # Храним позиции ударов в долях (от 0.0 до loop_beats), а не в секундах.
        # Благодаря этому при смене BPM записанный ритм сам ускорится или замедлится.
        self.recorded_beats = []

        self.is_playing = False
        self._play_thread = None

    def get_beat_duration(self):
        return 60.0 / self.bpm

    def get_loop_duration(self):
        return self.get_beat_duration() * self.loop_beats

    def set_bpm(self, new_bpm):
        if 30 <= new_bpm <= 260:
            self.bpm = new_bpm
            return True
        return False

    def set_loop_beats(self, beats):
        if 1 <= beats <= 32:
            self.loop_beats = beats
            return True
        return False

    def record_loop(self):
        beat_sec = self.get_beat_duration()
        self.audio.start_recording()

        # Отсчитываем доли в консоль, чтобы было проще попадать в темп при записи
        for beat_num in range(self.loop_beats):
            print(f"Доля {beat_num + 1}/{self.loop_beats}...")
            time.sleep(beat_sec)

        raw_seconds = self.audio.stop_recording()
        self.recorded_beats = []

        for t in raw_seconds:
            beat_pos = t / beat_sec
            if self.quantize_enabled:
                # Притягиваем к ближайшей 1/4 доли (шестнадцатой), чтобы убрать мелкую кривизну
                beat_pos = round(beat_pos * 4) / 4

            # Если удар примагнитился к самому концу такта, заворачиваем его в 0.0
            beat_pos = beat_pos % self.loop_beats
            self.recorded_beats.append(beat_pos)

        self.recorded_beats = sorted(list(set(self.recorded_beats)))
        return self.recorded_beats

    def _playback_worker(self):
        loop_start = time.time()
        triggered_indices = set()

        while self.is_playing:
            beat_sec = self.get_beat_duration()
            loop_sec = self.get_loop_duration()
            elapsed = time.time() - loop_start

            # Дошли до конца цикла — сбрасываем таймер на новый круг
            if elapsed >= loop_sec:
                loop_start = time.time()
                elapsed = 0.0
                triggered_indices.clear()
                print("--- новый круг ---")

            current_beat = elapsed / beat_sec

            for idx, beat_pos in enumerate(self.recorded_beats):
                if idx not in triggered_indices and current_beat >= beat_pos:
                    triggered_indices.add(idx)
                    self.audio.trigger_drum()
                    print(f"[PLAY] Удар на доле {beat_pos:.2f}/{self.loop_beats} ({self.bpm} BPM)")

            # Небольшой сон, чтобы цикл не грузил ядро процессора впустую
            time.sleep(0.005)

    def start_playback(self):
        if not self.recorded_beats or self.is_playing:
            return False

        self.is_playing = True
        self._play_thread = threading.Thread(target=self._playback_worker, daemon=True)
        self._play_thread.start()
        return True

    def stop_playback(self):
        self.is_playing = False
        if self._play_thread:
            self._play_thread.join(timeout=0.5)
            self._play_thread = None